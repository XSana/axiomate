/**
 * Detect whether native display modules (node-screenshots, nut.js) are usable.
 *
 * node-screenshots' libwayshot panics (process abort, uncatchable) under WSLg
 * non-deterministically — a subprocess probe can succeed but the next call in
 * the same or another process may panic. The only reliable approach is platform
 * detection with WSL exclusion.
 *
 * Results are cached for the lifetime of the process.
 */

import { readFileSync } from 'node:fs'

let _result: boolean | null = null

function isWSL(): boolean {
  try {
    return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf-8'))
  } catch {
    return false
  }
}

export function isNativeDisplayAvailable(): boolean {
  if (_result !== null) return _result

  if (process.platform === 'win32' || process.platform === 'darwin') {
    _result = true
  } else if (process.platform === 'linux') {
    if (isWSL()) {
      _result = false
    } else {
      _result = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
    }
  } else {
    _result = false
  }

  return _result
}
