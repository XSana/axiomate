import * as winNapi from 'computer-use-win-napi-axiomate'
import { logForDebugging } from '../debug.js'
import { releasePump, retainPump } from './drainRunLoop.js'
import { requireComputerUseSwift } from './swiftLoader.js'

/**
 * Global Escape → abort. Two independent platform paths:
 *
 *   - **macOS**: CGEventTap via `computer-use-native-axiomate` shim →
 *     `computer-use-mac-napi-axiomate`. Tap's CFRunLoopSource sits in
 *     .defaultMode on CFRunLoopGetMain(), so we hold a drainRunLoop pump
 *     retain for the registration's lifetime — same refcounted setInterval
 *     as the `@MainActor` methods.
 *
 *   - **Windows**: WH_KEYBOARD_LL hook via `computer-use-win-napi-axiomate`
 *     directly (no shim). The win NAPI runs the hook on its own worker
 *     thread + message pump; no Node-side pump retain needed.
 *
 * Both paths consume the ESC keydown system-wide (PI defense — a
 * prompt-injected `key("escape")` can't dismiss confirmation dialogs).
 *
 * Lifecycle: register on fresh lock acquire (`wrapper.tsx` `acquireCuLock`),
 * unregister on lock release (`cleanup.ts`).
 *
 * `notifyExpectedEscape()` punches a 100ms hole for model-synthesized
 * Escapes: the executor's `key("escape")` calls it before posting the
 * synthetic event so our own hook doesn't fire the abort callback for our
 * own turn. Each platform's NAPI implements its own decay timer.
 */

const IS_MAC = process.platform === 'darwin'
const IS_WIN = process.platform === 'win32'

let registered = false

export function registerEscHotkey(onEscape: () => void): boolean {
  if (registered) return true
  if (IS_MAC) {
    const cu = requireComputerUseSwift()
    if (!cu.hotkey.registerEscape(onEscape)) {
      // CGEvent.tapCreate failed — typically missing Accessibility permission.
      // CU still works, just without ESC abort.
      logForDebugging('[cu-esc] mac registerEscape returned false', { level: 'warn' })
      return false
    }
    retainPump()
    registered = true
    logForDebugging('[cu-esc] mac registered')
    return true
  }
  if (IS_WIN) {
    if (!winNapi.registerEscapeHotkey(onEscape)) {
      // SetWindowsHookExW failed — rare (low-integrity desktop, hook count
      // saturated). Same fallback: CU works, no ESC abort.
      logForDebugging('[cu-esc] win registerEscape returned false', { level: 'warn' })
      return false
    }
    registered = true
    logForDebugging('[cu-esc] win registered')
    return true
  }
  return false
}

export function unregisterEscHotkey(): void {
  if (!registered) return
  if (IS_MAC) {
    try {
      requireComputerUseSwift().hotkey.unregister()
    } finally {
      releasePump()
      registered = false
      logForDebugging('[cu-esc] mac unregistered')
    }
    return
  }
  if (IS_WIN) {
    try {
      winNapi.unregisterEscapeHotkey()
    } finally {
      registered = false
      logForDebugging('[cu-esc] win unregistered')
    }
  }
}

export function notifyExpectedEscape(): void {
  if (!registered) return
  if (IS_MAC) {
    requireComputerUseSwift().hotkey.notifyExpectedEscape()
    return
  }
  if (IS_WIN) {
    winNapi.notifyExpectedEscape()
  }
}
