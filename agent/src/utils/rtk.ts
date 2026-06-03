import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { isInBundledMode } from './bundledMode.js'
import { logForDebugging } from './debug.js'

// Per-attempt timeout for rtk rewrite. Observed hot-path P99 in production
// is ~110ms, but cold spawn on Windows + AV scanning regularly exceeds
// 500ms. 1000ms is comfortably above the cold-spawn ceiling without making
// users wait noticeably when rtk is genuinely broken — combined with the
// 3-attempt retry below the worst-case wall-clock is ~3.15s, which beats
// the 2000ms-per-attempt design (~6.15s worst case) on user-perceived UX.
const RTK_TIMEOUT_MS = 1000
const RTK_BINARY = process.platform === 'win32' ? 'rtk.exe' : 'rtk'
const RTK_MAX_ATTEMPTS = 3
const RTK_RETRY_BACKOFF_MS = [50, 100] as const

export type RtkConfig = {
  path: string
}

/**
 * Why an `error` outcome can happen — surfaced so the caller can pick a
 * useful warning message instead of always claiming the binary is missing.
 */
export type RtkErrorReason =
  | 'binary-missing'    // resolver returned null — rtk[.exe] not found
  | 'spawn-failed'      // OS rejected the spawn (ENOENT/EBUSY/EPERM/...)
  | 'timeout'           // hit RTK_TIMEOUT_MS, or upstream abort signal
  | 'unexpected-exit'   // numeric exit code we don't know how to interpret
  | 'empty-output'      // exit 0 but stdout was blank

export type RtkRawFailure = {
  code?: number | string
  signal?: string | null
  stdout: string
  stderr: string
  message: string
}

export type RtkRewriteResult =
  | { kind: 'rewrite'; cmd: string }
  | { kind: 'passthrough' }
  | { kind: 'error'; reason: RtkErrorReason; attempts: number; raw?: RtkRawFailure }

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
  }
  try {
    const req = createRequire(import.meta.url)
    const mod = req('rtk-axiomate') as { rtkPath?: string | null }
    if (mod.rtkPath && existsSync(mod.rtkPath)) return mod.rtkPath
  } catch {
    // rtk-axiomate workspace not installed, or we're running from a
    // Bun-compiled exe whose virtual fs has no node_modules.
  }
  return null
}

/**
 * Resolve the rtk binary fresh on every call. NOT memoized — see commit
 * fdd2d81e for why (mid-session recovery when binary returns).
 */
export function getRtkConfig(): RtkConfig | null {
  const path = findRtkBinary()
  if (!path) {
    logForDebugging(
      `rtk not found — checked dirname(execPath)=${dirname(process.execPath)} and rtk-axiomate package`,
    )
    return null
  }
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

const RTK_SHELL_PREFIXES = new Set(['noglob', 'command', 'builtin', 'exec', 'nocorrect'])

function readShellToken(input: string, start: number): { start: number; end: number; text: string } | null {
  let i = start
  while (i < input.length && /\s/.test(input[i]!)) i++
  if (i >= input.length) return null

  const tokenStart = i
  let quote: "'" | '"' | null = null
  while (i < input.length) {
    const ch = input[i]!
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < input.length) {
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      i++
      continue
    }
    if (ch === '\\' && i + 1 < input.length) {
      i += 2
      continue
    }
    if (/\s/.test(ch) || ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === ')') {
      break
    }
    i++
  }

  return { start: tokenStart, end: i, text: input.slice(tokenStart, i) }
}

function patchRtkAtCommandStart(segment: string, rtkCommand: string): string {
  let cursor = 0

  while (true) {
    const token = readShellToken(segment, cursor)
    if (!token) return segment
    if (token.text === 'rtk') {
      return `${segment.slice(0, token.start)}${rtkCommand}${segment.slice(token.end)}`
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token.text) || RTK_SHELL_PREFIXES.has(token.text)) {
      cursor = token.end
      continue
    }
    return segment
  }
}

function patchRtkCommandPositions(command: string, rtkCommand: string): string {
  let result = ''
  let segmentStart = 0
  let i = 0
  let quote: "'" | '"' | null = null

  while (i < command.length) {
    const ch = command[i]!
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      i++
      continue
    }
    if (ch === '\\' && i + 1 < command.length) {
      i += 2
      continue
    }

    let operatorLength = 0
    if (ch === ';' || ch === '|') {
      operatorLength = command[i + 1] === ch ? 2 : 1
    } else if (ch === '&') {
      operatorLength = command[i + 1] === '&' ? 2 : 1
    } else if ((ch === '(' && command[i - 1] !== '$') || ch === ')') {
      operatorLength = 1
    }

    if (operatorLength > 0) {
      result += patchRtkAtCommandStart(command.slice(segmentStart, i), rtkCommand)
      result += command.slice(i, i + operatorLength)
      i += operatorLength
      segmentStart = i
      continue
    }

    i++
  }

  return result + patchRtkAtCommandStart(command.slice(segmentStart), rtkCommand)
}

/**
 * The rewritten command starts with the bare token `rtk`. If our binary lives
 * next to axiomate.exe (bundled mode), the shell can't find it on PATH —
 * substitute the absolute path for command-position `rtk` tokens.
 */
export function patchRewrittenCommand(rewritten: string, rtkPath: string): string {
  const trimmed = rewritten.trimEnd()
  return patchRtkCommandPositions(trimmed, quoteIfNeeded(rtkPath))
}

type AttemptOutcome =
  | { kind: 'rewrite'; cmd: string }
  | { kind: 'passthrough' }
  | { kind: 'error'; reason: RtkErrorReason; transient: boolean; raw?: RtkRawFailure }

export type RtkExecFileForTesting = (
  file: string,
  args: string[],
  options: {
    timeout: number
    signal: AbortSignal
    encoding: BufferEncoding
    maxBuffer: number
    windowsHide: boolean
  },
  callback: (error: Error | null, stdout: string | Buffer | null, stderr: string | Buffer | null) => void,
) => { on: (event: 'error', listener: (error: Error) => void) => unknown }

function execOutputToString(output: unknown): string {
  if (typeof output === 'string') return output
  if (Buffer.isBuffer(output)) return output.toString('utf8')
  if (output == null) return ''
  return String(output)
}

function rawFailure(
  error: NodeJS.ErrnoException & { signal?: string | null },
  stdout: unknown,
  stderr: unknown,
): RtkRawFailure {
  return {
    code: error.code,
    signal: error.signal ?? null,
    stdout: execOutputToString(stdout),
    stderr: execOutputToString(stderr),
    message: error.message,
  }
}

function preview(value: string): string {
  return JSON.stringify(value).slice(0, 500)
}

/**
 * Single attempt at `rtk rewrite <cmd>`.
 *
 * The axiomate RTK branch exposes rewrite as a pure service:
 *   - exit 0 + stdout: rewritten command
 *   - exit 1: no RTK equivalent, run the original command
 *   - any other numeric exit: RTK bug/version mismatch, fail open
 *
 * "transient" classification:
 *   - spawn-failed, timeout, empty-output → likely retryable (AV scan,
 *     cold-cache, transient OS state)
 *   - unexpected-exit → NOT retryable (rtk panicked or hit a bug; same
 *     input + same binary will hit the same path)
 */
function runRtkOnce(
  rtkPath: string,
  cmd: string,
  abortSignal: AbortSignal,
  execFileImpl: RtkExecFileForTesting = execFile as unknown as RtkExecFileForTesting,
): Promise<AttemptOutcome> {
  return new Promise<AttemptOutcome>(resolve => {
    let settled = false
    const settle = (result: AttemptOutcome) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    execFileImpl(
      rtkPath,
      ['rewrite', cmd],
      {
        timeout: RTK_TIMEOUT_MS,
        signal: abortSignal,
        encoding: 'utf-8',
        maxBuffer: 1_000_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const stdoutText = execOutputToString(stdout)
        const stderrText = execOutputToString(stderr)
        if (error) {
          const err = error as NodeJS.ErrnoException & {
            signal?: string | null
          }
          const raw = rawFailure(err, stdout, stderr)
          logForDebugging(
            `[rtk-trace] attempt error: code=${JSON.stringify(err.code)} signal=${JSON.stringify(err.signal ?? null)} message=${preview(err.message)} stdout=${preview(stdoutText)} stderr=${preview(stderrText)}`,
          )
          if (err.signal != null) {
            // Timeout or abort. execFile sets signal on timeout
            // (SIGTERM by default) and on AbortSignal.
            return settle({ kind: 'error', reason: 'timeout', transient: true, raw })
          }
          if (typeof err.code !== 'number') {
            // String code: ENOENT, EBUSY, EPERM, etc. Spawn-side failure.
            return settle({ kind: 'error', reason: 'spawn-failed', transient: true, raw })
          }
          const exitCode = err.code as number
          switch (exitCode) {
            case 1:
              return settle({ kind: 'passthrough' })
            default:
              // rtk shouldn't return other numeric codes; treat as a bug,
              // not a transient hiccup, so we don't waste retries.
              return settle({ kind: 'error', reason: 'unexpected-exit', transient: false, raw })
          }
        }
        // Exit 0: rewrite found, allowed.
        const rewritten = stdoutText.trim()
        if (!rewritten) {
          logForDebugging(`[rtk-trace] attempt exit=0 but stdout empty`)
          return settle({
            kind: 'error',
            reason: 'empty-output',
            transient: true,
            raw: {
              code: 0,
              signal: null,
              stdout: stdoutText,
              stderr: stderrText,
              message: 'rtk rewrite exited 0 with empty stdout',
            },
          })
        }
        settle({
          kind: 'rewrite',
          cmd: patchRewrittenCommand(rewritten, rtkPath),
        })
      },
    )
  })
}

export function _runRtkOnceForTesting(
  rtkPath: string,
  cmd: string,
  abortSignal: AbortSignal,
  execFileImpl: RtkExecFileForTesting,
): Promise<AttemptOutcome> {
  return runRtkOnce(rtkPath, cmd, abortSignal, execFileImpl)
}

/**
 * Invoke `rtk rewrite <cmd>` with up to RTK_MAX_ATTEMPTS tries.
 *
 * Retries on transient failures only — spawn errors (AV scan races, file
 * lock), timeouts (cold spawn on slow machines), and empty stdout. Does
 * NOT retry on unexpected-exit (rtk panic/version mismatch) or on success/passthrough
 * outcomes, which are all definitive.
 *
 * Fail-open: when all attempts are exhausted, returns `kind: 'error'` so
 * the caller runs the original command unchanged.
 */
export async function rtkRewrite(
  cmd: string,
  abortSignal: AbortSignal,
): Promise<RtkRewriteResult> {
  const config = getRtkConfig()
  if (!config) {
    logForDebugging(
      `[rtk-trace] rtkRewrite: no config (resolver returned null), cmd=${JSON.stringify(cmd).slice(0, 200)}`,
    )
    return { kind: 'error', reason: 'binary-missing', attempts: 0 }
  }
  logForDebugging(
    `[rtk-trace] rtkRewrite: invoking ${config.path} rewrite <cmd> where cmd=${JSON.stringify(cmd).slice(0, 200)}`,
  )

  let lastReason: RtkErrorReason = 'spawn-failed'
  let lastRaw: RtkRawFailure | undefined
  for (let attempt = 1; attempt <= RTK_MAX_ATTEMPTS; attempt++) {
    if (abortSignal.aborted) {
      return { kind: 'error', reason: 'timeout', attempts: attempt - 1 }
    }
    const outcome = await runRtkOnce(config.path, cmd, abortSignal)
    if (outcome.kind !== 'error') {
      if (attempt > 1) {
        logForDebugging(
          `[rtk-trace] rtkRewrite recovered on attempt ${attempt} with kind=${outcome.kind}`,
        )
      }
      return outcome
    }
    lastReason = outcome.reason
    lastRaw = outcome.raw
    if (!outcome.transient) {
      logForDebugging(
        `[rtk-trace] rtkRewrite giving up after attempt ${attempt}: non-transient reason=${outcome.reason}`,
      )
      return { kind: 'error', reason: outcome.reason, attempts: attempt, raw: outcome.raw }
    }
    if (attempt < RTK_MAX_ATTEMPTS) {
      const backoff = RTK_RETRY_BACKOFF_MS[attempt - 1] ?? 100
      logForDebugging(
        `[rtk-trace] rtkRewrite attempt ${attempt} failed (reason=${outcome.reason}), retrying after ${backoff}ms`,
      )
      await new Promise(resolve => setTimeout(resolve, backoff))
    }
  }
  logForDebugging(
    `[rtk-trace] rtkRewrite exhausted ${RTK_MAX_ATTEMPTS} attempts, last reason=${lastReason}`,
  )
  return { kind: 'error', reason: lastReason, attempts: RTK_MAX_ATTEMPTS, raw: lastRaw }
}

/**
 * Human-readable warning text per failure reason. Used by BashTool to
 * surface a yellow ● bullet to the user. Phrased as one short sentence
 * so it fits the SystemTextMessage layout.
 */
export function rtkErrorWarning(reason: RtkErrorReason, attempts: number): string {
  const tries = attempts === 1 ? '1 try' : `${attempts} tries`
  switch (reason) {
    case 'binary-missing':
      return (
        'rtk is enabled in /config but the rtk binary was not found. ' +
        'Shell commands will run unfiltered. Place rtk next to axiomate, ' +
        'or disable the toggle to silence this warning.'
      )
    case 'spawn-failed':
      return (
        `rtk failed to start after ${tries} (likely antivirus or file-lock contention). ` +
        'Shell commands will run unfiltered for this turn.'
      )
    case 'timeout':
      return (
        `rtk timed out (>${RTK_TIMEOUT_MS}ms) on ${tries}. ` +
        'Shell commands will run unfiltered for this turn.'
      )
    case 'unexpected-exit':
      return (
        'rtk exited with an unexpected status — likely a bug. ' +
        'Shell commands will run unfiltered for this turn.'
      )
    case 'empty-output':
      return (
        `rtk returned empty output on ${tries} — possible version mismatch. ` +
        'Shell commands will run unfiltered for this turn.'
      )
  }
}
