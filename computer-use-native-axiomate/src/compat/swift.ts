/**
 * Compatibility layer: wraps our cross-platform screenshot/apps functions
 * into the @ant/computer-use-swift interface that agent code expects.
 *
 * Agent loads this via: require('computer-use-native-axiomate') as ComputerUseAPI
 * The original is a macOS-only Swift NAPI module. We provide cross-platform
 * equivalents where possible and no-ops for macOS-specific features.
 */

import {
  listDisplays,
  getDisplaySize,
  captureDisplay,
  captureRegion,
  type DisplayInfo,
  type CaptureResult,
} from '../screenshot.js'
import {
  listRunningApps,
  listInstalledApps,
  openApp,
} from '../platforms/apps.js'
import type { ComputerUseAPI } from '../index.js'

export function createComputerUseSwift(): ComputerUseAPI {
  return {
    hotkey: {
      register(_callback: () => void): void {
        // macOS CGEventTap — no cross-platform equivalent
      },
      registerEscape(_callback: () => void): any {
        // macOS-specific escape key monitoring
        return false
      },
      unregister(): void {},
      notifyExpectedEscape(): void {},
    },

    apps: {
      async listInstalled(): Promise<any[]> {
        return listInstalledApps()
      },
      async listRunning(): Promise<any[]> {
        return listRunningApps()
      },
      async prepareDisplay(..._args: any[]): Promise<any> {
        // macOS-specific: hide/activate apps before screenshot
        return { hidden: [], activated: [] }
      },
      async previewHideSet(..._args: any[]): Promise<any> {
        return []
      },
      async findWindowDisplays(..._args: any[]): Promise<any> {
        return []
      },
      async appUnderPoint(_x: number, _y: number): Promise<any> {
        return null
      },
      async iconDataUrl(_bundleId: string): Promise<any> {
        return null
      },
      async open(bundleId: string): Promise<void> {
        await openApp(bundleId)
      },
      async unhide(..._args: any[]): Promise<void> {
        // macOS-specific: NSRunningApplication.unhide
      },
    },

    display: {
      async captureExcluding(...args: any[]): Promise<any> {
        // Original takes (bundleIds[], quality, w, h, displayId?)
        // We ignore bundle filtering and quality, just capture the display.
        // Return the {base64, width, height} object — toolCalls.ts reads
        // shot.base64 to compute decodedByteLength. Returning a raw Buffer
        // here makes shot.base64 undefined → "endsWith of undefined" crash.
        const displayId = args[4] ?? args[0]
        return captureDisplay(typeof displayId === 'number' ? displayId : undefined)
      },
      async captureRegion(...args: any[]): Promise<any> {
        const [x, y, w, h] = args
        return captureRegion(x, y, w, h)
      },
      getSize(displayId?: number): any {
        return getDisplaySize(displayId)
      },
      listAll(): any {
        return listDisplays()
      },
    },

    screenshot: {
      async capture(...args: any[]): Promise<any> {
        const displayId = args[0]
        return captureDisplay(typeof displayId === 'number' ? displayId : undefined)
      },
      async captureExcluding(...args: any[]): Promise<any> {
        const displayId = args[4] ?? undefined
        return captureDisplay(typeof displayId === 'number' ? displayId : undefined)
      },
      async captureRegion(...args: any[]): Promise<any> {
        const [x, y, w, h] = args
        return captureRegion(x, y, w, h)
      },
    },

    tcc: {
      checkScreenRecording(): boolean {
        // Assume permission granted on non-macOS, or that user has granted it
        return true
      },
      checkAccessibility(): boolean {
        return true
      },
      requestScreenRecording(): void {
        // macOS-specific TCC prompt
      },
    },

    // Top-level aliases (agent's executor.ts calls these directly)
    async captureExcluding(...args: any[]): Promise<any> {
      const displayId = args[4] ?? undefined
      return captureDisplay(typeof displayId === 'number' ? displayId : undefined)
    },
    async captureRegion(...args: any[]): Promise<any> {
      const [x, y, w, h] = args
      return captureRegion(x, y, w, h)
    },
    async resolvePrepareCapture(..._args: any[]): Promise<any> {
      // macOS-specific display preparation
      return {}
    },
    _drainMainRunLoop(): void {
      // macOS-specific: pump CFRunLoop main queue for Swift async
      // No equivalent needed on other platforms
    },
  }
}
