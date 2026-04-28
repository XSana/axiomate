import { createComputerUseSwift, type ComputerUseAPI } from './macShim/index.js'

let cached: ComputerUseAPI | undefined

/**
 * macShim/swiftShim.ts wraps the optional mac NAPI binding and falls back to
 * node-screenshots / osascript / no-op when the binding isn't loaded.
 *
 * The four @MainActor methods (captureExcluding, captureRegion,
 * apps.listInstalled, resolvePrepareCapture) dispatch to DispatchQueue.main
 * and will hang under libuv unless CFRunLoop is pumped — call sites wrap
 * these in drainRunLoop().
 *
 * Phase D2 (commit pending): inlined the shim into agent. Previously this
 * loader required('computer-use-native-axiomate'), which has been deleted —
 * its mac-relevant TS sources moved to ./macShim/.
 */
export function requireComputerUseSwift(): ComputerUseAPI {
  return (cached ??= createComputerUseSwift())
}

export type { ComputerUseAPI }
