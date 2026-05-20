import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { isInBundledMode } from './bundledMode.js'
import { logForDebugging } from './debug.js'

const RTK_TIMEOUT_MS = 250
const RTK_BINARY = process.platform === 'win32' ? 'rtk.exe' : 'rtk'

export type RtkConfig = {
  path: string
}

export type RtkRewriteResult =
  | { kind: 'rewrite'; cmd: string }
  | { kind: 'ask'; cmd: string }
  | { kind: 'passthrough' }
  | { kind: 'deny' }
  | { kind: 'error' }

/**
 * Find the bundled rtk binary. Two layouts, mirroring findBundledRipgrep
 * in utils/ripgrep.ts:
 *
 *   1. Packaged Bun-compiled exe (`isInBundledMode()` true): rtk[.exe]
 *      sits next to axiomate.exe — package-{win,mac,linux}.ts copy it
 *      there. Resolve via dirname(process.execPath). MUST come first
 *      because the require() fallback below fails inside Bun-compiled
 *      exes (their virtual fs has no node_modules).
 *
 *   2. Bun-runtime / pnpm install: process.execPath is bun.exe or
 *      node.exe — not useful. Resolve rtk-axiomate as a workspace
 *      package via createRequire(import.meta.url). The package's
 *      index.js exports `rtkPath` pointing at its bin/ entry.
 *
 * Both paths are derived from runtime values — no build-machine
 * absolute paths baked into the bundle.
 */
function findRtkBinary(): string | null {
  if (isInBundledMode()) {
    const candidate = join(dirname(process.execPath), RTK_BINARY)
    if (existsSync(candidate)) return candidate
    // Fall through — bundled rtk may be missing from a hand-relocated
    // install. The require() branch below won't help there either, but
    // returning null lets the caller surface a friendlier message.
  }
  try {
    const req = createRequire(import.meta.url)
    const mod = req('rtk-axiomate') as { rtkPath?: string | null }
    if (mod.rtkPath && existsSync(mod.rtkPath)) return mod.rtkPath
  } catch {
    // rtk-axiomate workspace not installed, or we're running from a
    // Bun-compiled exe whose virtual fs has no node_modules. Either
    // way the packaged-exe branch above already covered the case.
  }
  return null
}

/**
 * Resolve the rtk binary fresh on every call.
 *
 * NOT memoized: if rtk goes missing mid-session (rare in production,
 * common in dev when developers move files around) the resolver must
 * recover when the binary returns. `findRtkBinary` is two cheap
 * `existsSync` probes — ~microseconds — and BashTool.tsx itself
 * gates on settings.rtk?.enabled before calling rtkRewrite, so this
 * isn't on the hot path for users who never enabled the feature.
 *
 * The `[rtk ready] / [rtk not found]` log lines fire on every Bash
 * call; that's intentional — debug traces should reflect the
 * actually-observed state, not a one-shot snapshot.
 */
export function getRtkConfig(): RtkConfig | null {
  const path = findRtkBinary()
  if (!path) {
    logForDebugging(
      'rtk not found — run pnpm bootstrap to fetch the binary, or ensure rtk lives next to axiomate.exe in packaged builds',
    )
    return null
  }
  // No pre-flight execFile probe: it misfired inside Bun-compiled exes
  // (synchronous throw within ~250ms even for a healthy binary). We
  // trust existsSync here; if the binary is actually broken, rtkRewrite's
  // execFile callback logs the real error and BashTool's fail-open path
  // runs the original command.
  logForDebugging(`rtk ready (path=${path})`)
  return { path }
}

function quoteIfNeeded(p: string): string {
  // Normalize Windows backslashes to forward slashes — bash on Windows
  // (git-bash) treats `\p` `\w` etc as escape sequences inside double
  // quotes, mangling C:\public\...\rtk.exe. Forward slashes are accepted
  // by both bash and cmd.exe on Windows, and unchanged on Unix.
  const normalized = p.replace(/\\/g, '/')
  if (!/[\s"]/.test(normalized)) return normalized
  return `"${normalized.replace(/"/g, '\\"')}"`
}

/**
 * The rewritten command starts with the bare token `rtk`. If our binary lives
 * next to axiomate.exe (bundled mode), the shell can't find it on PATH —
 * substitute the absolute path for the leading token.
 */
function patchRewrittenCommand(rewritten: string, rtkPath: string): string {
  const trimmed = rewritten.trimEnd()
  if (!trimmed.startsWith('rtk')) return trimmed
  const after = trimmed.slice(3)
  if (after.length > 0 && !/\s/.test(after[0]!)) return trimmed
  return `${quoteIfNeeded(rtkPath)}${after}`
}

/**
 * Invoke `rtk rewrite <cmd>` and map the exit-code protocol
 * (see rtk/src/hooks/rewrite_cmd.rs:7-17) to a discriminated result.
 *
 * Fail-open: any error (missing binary, timeout, unexpected exit code,
 * malformed output) returns `error` so the caller can run the original
 * command unchanged.
 */
export async function rtkRewrite(
  cmd: string,
  abortSignal: AbortSignal,
): Promise<RtkRewriteResult> {
  const config = getRtkConfig()
  if (!config) {
    logForDebugging(`[rtk-trace] rtkRewrite: no config (resolver returned null), cmd=${JSON.stringify(cmd).slice(0, 200)}`)
    return { kind: 'error' }
  }
  logForDebugging(`[rtk-trace] rtkRewrite: invoking ${config.path} rewrite <cmd> where cmd=${JSON.stringify(cmd).slice(0, 200)}`)

  return new Promise<RtkRewriteResult>(resolve => {
    let settled = false
    const settle = (result: RtkRewriteResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const child = execFile(
      config.path,
      ['rewrite', cmd],
      {
        timeout: RTK_TIMEOUT_MS,
        signal: abortSignal,
        encoding: 'utf-8',
        maxBuffer: 1_000_000,
        windowsHide: true,
      },
      (error, stdout) => {
        logForDebugging(`[rtk-trace] rtkRewrite callback: error=${error ? JSON.stringify({ code: (error as NodeJS.ErrnoException).code, signal: (error as NodeJS.ErrnoException & {signal?: string|null}).signal, message: error.message }) : 'null'} stdout=${JSON.stringify(stdout).slice(0, 200)}`)
        // execFile surfaces non-zero exits as an error whose `code` is the
        // numeric exit code. Spawn failures use string codes ('ENOENT' etc.),
        // and timeouts/aborts set `error.signal`. Fail open on anything that
        // isn't a clean numeric exit.
        if (error) {
          const err = error as NodeJS.ErrnoException & {
            signal?: string | null
          }
          if (typeof err.code !== 'number') {
            return settle({ kind: 'error' })
          }
          if (err.signal && err.signal !== null) {
            return settle({ kind: 'error' })
          }
          const exitCode = err.code as number
          const rewritten = typeof stdout === 'string' ? stdout.trim() : ''
          switch (exitCode) {
            case 1:
              return settle({ kind: 'passthrough' })
            case 2:
              return settle({ kind: 'deny' })
            case 3:
              if (!rewritten) return settle({ kind: 'error' })
              return settle({
                kind: 'ask',
                cmd: patchRewrittenCommand(rewritten, config.path),
              })
            default:
              return settle({ kind: 'error' })
          }
        }
        // Exit 0: rewrite found, allowed.
        const rewritten = typeof stdout === 'string' ? stdout.trim() : ''
        if (!rewritten) return settle({ kind: 'error' })
        settle({
          kind: 'rewrite',
          cmd: patchRewrittenCommand(rewritten, config.path),
        })
      },
    )

    child.on('error', () => settle({ kind: 'error' }))
  })
}
