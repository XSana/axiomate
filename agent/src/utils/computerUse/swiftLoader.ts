import type { ComputerUseAPI } from 'computer-use-native-axiomate'

let cached: ComputerUseAPI | undefined

/**
 * Package's js/index.js reads COMPUTER_USE_SWIFT_NODE_PATH (baked by
 * build-with-plugins.ts on darwin targets, unset otherwise — falls through to
 * the node_modules prebuilds/ path). We cache the loaded native module.
 *
 * The four @MainActor methods (captureExcluding, captureRegion,
 * apps.listInstalled, resolvePrepareCapture) dispatch to DispatchQueue.main
 * and will hang under libuv unless CFRunLoop is pumped — call sites wrap
 * these in drainRunLoop().
 */
export function requireComputerUseSwift(): ComputerUseAPI {
  // Axiomate: cross-platform — no longer macOS-only restriction
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createComputerUseSwift } = require('computer-use-native-axiomate') as typeof import('computer-use-native-axiomate')
  return (cached ??= createComputerUseSwift())
}

export type { ComputerUseAPI }
