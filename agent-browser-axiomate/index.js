/**
 * Exports the path to the bundled agent-browser binary, in the same shape as
 * rtk-axiomate's `rtkPath` / `@vscode/ripgrep`'s `rgPath`.
 *
 * Resolution mirrors rtk-axiomate/index.js's dual-search:
 *
 *   1. `__dirname/bin/<binary>` — bun-runtime / pnpm install path.
 *      Works whenever the user is running through `node` or `bun` and
 *      pnpm has linked this package into node_modules.
 *
 *   2. `dirname(process.execPath)/<binary>` — Bun-compiled exe path.
 *      CRITICAL: in a Bun-compiled exe, `__dirname` is BAKED to the
 *      build-machine path (e.g. `C:\\public\\workspace\\axiomate\\
 *      agent-browser-axiomate`). The user's machine has no such directory,
 *      so candidate (1) silently fails and we fall through to here.
 *      `process.execPath` is the user's actual axiomate.exe path —
 *      package-{win,mac,linux}.ts copy agent-browser[.exe] next to it.
 *
 * Both paths are derived from runtime values — no build-machine absolute
 * paths baked into the bundle. If neither location has the binary (e.g.
 * bootstrap hasn't run yet and we're not in a packaged build), `agentBrowserPath`
 * is null and callers fail open (browser-bridge reports the feature unavailable).
 *
 * The on-disk binary is normalized to a stable, platform-suffix-free name
 * (`agent-browser` / `agent-browser.exe`) by scripts/fetch.mjs, so this
 * resolver never has to know the release's per-platform asset naming.
 */
const { join, dirname } = require('node:path')
const { existsSync } = require('node:fs')

const AGENT_BROWSER_BINARY =
  process.platform === 'win32' ? 'agent-browser.exe' : 'agent-browser'

function findBinary() {
  const candidates = [
    join(__dirname, 'bin', AGENT_BROWSER_BINARY),
    join(dirname(process.execPath), AGENT_BROWSER_BINARY),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

module.exports.agentBrowserPath = findBinary()
module.exports.AGENT_BROWSER_BINARY = AGENT_BROWSER_BINARY
