/**
 * Exports the path to the bundled rtk binary, in the same shape as
 * `@vscode/ripgrep` exports `rgPath`.
 *
 * Resolution mirrors load-napi.js's dual-search:
 *
 *   1. `__dirname/bin/<binary>` — bun-runtime / pnpm install path.
 *      Works whenever the user is running through `node` or `bun` and
 *      pnpm has linked this package into node_modules.
 *
 *   2. `dirname(process.execPath)/<binary>` — Bun-compiled exe path.
 *      CRITICAL: in a Bun-compiled exe, `__dirname` is BAKED to the
 *      build-machine path (e.g. `C:\\public\\workspace\\axiomate\\
 *      rtk-axiomate`). The user's machine has no such directory, so
 *      candidate (1) silently fails and we fall through to here.
 *      `process.execPath` is the user's actual axiomate.exe path —
 *      package-{win,mac,linux}.ts copy rtk[.exe] next to it.
 *
 * If neither location has the binary (e.g. bootstrap hasn't run yet
 * and we're not in a packaged build), `rtkPath` is null. Callers
 * fail open — see agent/src/utils/rtk.ts.
 */
const { join, dirname } = require('node:path')
const { existsSync } = require('node:fs')

const RTK_BINARY = process.platform === 'win32' ? 'rtk.exe' : 'rtk'

function findBinary() {
  const candidates = [
    join(__dirname, 'bin', RTK_BINARY),
    join(dirname(process.execPath), RTK_BINARY),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

module.exports.rtkPath = findBinary()
