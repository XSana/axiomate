import { createComputerUseInput, type ComputerUseInputAPI } from './macShim/index.js'

let cached: ComputerUseInputAPI | undefined

/**
 * macShim/inputShim.ts wraps @nut-tree-fork/nut-js into a `ComputerUseInputAPI`
 * with an `isSupported` discriminator — false on platforms / environments
 * where node-screenshots can't load (WSL without WSLg, headless Linux). On
 * darwin/win32 it's always true.
 *
 * key()/keys() dispatch enigo work onto DispatchQueue.main via
 * dispatch2::run_on_main, then block a tokio worker on a channel. Under
 * Electron (CFRunLoop drains the main queue) this works; under libuv
 * (Node/bun) the main queue never drains and the promise hangs. The executor
 * calls these inside drainRunLoop().
 *
 * Phase D2 (commit pending): inlined into agent. Previously required
 * `computer-use-native-axiomate`, which has been deleted.
 */
export function requireComputerUseInput(): ComputerUseInputAPI {
  if (cached) return cached
  const input = createComputerUseInput()
  if (!input.isSupported) {
    throw new Error('macShim createComputerUseInput is not supported on this platform')
  }
  return (cached = input)
}
