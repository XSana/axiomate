import { describe, expect, it, vi } from 'vitest'

import type {
  ComputerUseHostAdapter,
  ComputerUseOverrides,
} from './types.js'
import { handleToolCall } from './toolCalls.js'
import { buildComputerUseTools } from './tools.js'

function makeAdapter(opts?: {
  visionLocateEnabled?: boolean
  supportsImages?: boolean
}): ComputerUseHostAdapter {
  return {
    serverName: 'computer-use',
    logger: {
      info() {},
      error() {},
      warn() {},
      debug() {},
      silly() {},
    },
    executor: {
      capabilities: { platform: 'win32', screenshotFiltering: 'none' },
      getDisplaySize: vi.fn(),
      listDisplays: vi.fn(),
      findWindowDisplays: vi.fn(),
      screenshot: vi.fn(),
      zoom: vi.fn(),
      resolvePrepareCapture: vi.fn(),
      screenshotWindow: vi.fn(),
      key: vi.fn(),
      holdKey: vi.fn(),
      type: vi.fn(),
      moveMouse: vi.fn(),
      click: vi.fn(),
      mouseDown: vi.fn(),
      mouseUp: vi.fn(),
      getCursorPosition: vi.fn(),
      drag: vi.fn(),
      scroll: vi.fn(),
      getFrontmostApp: vi.fn(),
      appUnderPoint: vi.fn(),
      listInstalledApps: vi.fn(),
      listRunningApps: vi.fn(),
      openApp: vi.fn(),
      readClipboard: vi.fn(),
    },
    ensureOsPermissions: async () => ({ platform: 'win32', granted: true }),
    isDisabled: () => false,
    isVisionLocateEnabled: () => opts?.visionLocateEnabled ?? false,
    currentModelSupportsImages: () => opts?.supportsImages ?? false,
    getAutoUnhideEnabled: () => true,
    getSubGates: () => ({
      clipboardPasteMultiline: true,
      mouseAnimation: true,
      hideBeforeAction: true,
      autoTargetDisplay: true,
      clipboardGuard: true,
    }),
  }
}

const winOverrides: ComputerUseOverrides = {
  platform: 'win32',
  grantFlags: {
    clipboardRead: true,
    clipboardWrite: true,
    systemKeyCombos: true,
  },
  coordinateMode: 'pixels',
}

describe('vision_locate gates', () => {
  it('returns disabled guidance when globally disabled', async () => {
    const result = await handleToolCall(
      makeAdapter({ visionLocateEnabled: false, supportsImages: true }),
      'vision_locate',
      { description: 'Send button' },
      winOverrides,
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      type: 'text',
    })
    const text = (result.content[0] as any).text as string
    expect(text).toContain('zoom')
    expect(text).toContain('screenshot_window')
    expect(text).toContain('mark_id')
    expect(text).not.toContain('enable')
  })

  it('returns no-image guidance when model lacks image input', async () => {
    const result = await handleToolCall(
      makeAdapter({ visionLocateEnabled: true, supportsImages: false }),
      'vision_locate',
      { description: 'Send button' },
      winOverrides,
    )

    expect(result.isError).toBe(true)
    const text = (result.content[0] as any).text as string
    expect(text).toContain('requires image input')
    expect(text).toContain('zoom')
    expect(text).toContain('screenshot_window')
    expect(text).toContain('mark_id')
    expect(text).not.toContain('switch')
    expect(text).not.toContain('enable')
  })
})

describe('zoom window prioritization', () => {
  it('runs the bulk-pull pipeline on the largest visible window and restores host windows', async () => {
    const adapter = makeAdapter()
    const executor = adapter.executor as any
    executor.getDisplaySize = vi.fn(async () => ({
      displayId: 1,
      width: 1000,
      height: 800,
      originX: 0,
      originY: 0,
    }))
    executor.listDisplays = vi.fn(async () => [{
      displayId: 1,
      width: 1000,
      height: 800,
      originX: 0,
      originY: 0,
    }])
    executor.captureForegroundRestoreToken = vi.fn(async () => ({
      appIdentifier: 'axiomate-host',
      hwnd: 10,
      centerX: 5,
      centerY: 5,
      isHost: true,
    }))
    executor.hideSelf = vi.fn(async () => true)
    executor.showSelf = vi.fn(async () => {})
    executor.listVisibleWindows = vi.fn(async () => [
      {
        appIdentifier: 'axiomate-host',
        displayName: 'axiomate-host',
        hwnd: 10,
        rect: { x: 0, y: 0, w: 50, h: 50 },
        zRank: 2,
        isForeground: false,
        isHost: true,
      },
      {
        appIdentifier: 'big-app',
        displayName: 'big-app',
        hwnd: 101,
        rect: { x: 0, y: 0, w: 400, h: 400 },
        zRank: 1,
        isForeground: true,
        isHost: false,
      },
      {
        appIdentifier: 'small-app',
        displayName: 'small-app',
        hwnd: 202,
        rect: { x: 50, y: 50, w: 120, h: 120 },
        zRank: 0,
        isForeground: false,
        isHost: false,
      },
    ])
    executor.focusNonHostWindowAtPoint = vi.fn(async () => true)
    // Phase 1.5 bulk-pull API replaces the legacy
    // enumerateVisibleElementsForWindowDetailed; mock it per hwnd. Element
    // bbox is in physical screen coords (pipeline converts to virtual).
    executor.enumerateUiElementsBulkForWindow = vi.fn(async (hwnd: number) => ({
      elements: hwnd === 101
        ? [{
            bbox: { x: 220, y: 220, w: 40, h: 20 },
            name: 'Primary',
            role: 'Button',
            controlTypeId: 0,
            className: '',
            automationId: 'primary-btn',
            frameworkId: '',
            localizedControlType: '',
            isOffscreen: false,
            nativeWindowHandle: hwnd,
            parentIndex: -1,
            depth: 0,
          }]
        : [{
            bbox: { x: 70, y: 70, w: 20, h: 20 },
            name: 'Secondary',
            role: 'Button',
            controlTypeId: 0,
            className: '',
            automationId: 'secondary-btn',
            frameworkId: '',
            localizedControlType: '',
            isOffscreen: false,
            nativeWindowHandle: hwnd,
            parentIndex: -1,
            depth: 0,
          }],
      browserViewportBboxes: [],
      elapsedMs: 1,
      truncatedByWalltime: false,
    }))
    executor.zoom = vi.fn(async () => ({ base64: 'aGVsbG8=', width: 200, height: 200 }))
    // Cursor in big-app's exposed L-shape area (outside small-app's
    // overlay rect). The scorer applies a cursor-proximity bonus, but
    // the dominant signal for "which window's mark wins" is the
    // foreground bonus (+50) on big-app.
    executor.getCursorPosition = vi.fn(async () => ({ x: 200, y: 200 }))

    let lastMarks: any[] = []
    const overrides: ComputerUseOverrides = {
      ...winOverrides,
      onLocateMarksUpdated(marks) {
        lastMarks = marks
      },
      getLastZoomMarks() {
        return lastMarks as any
      },
    }

    const result = await handleToolCall(
      adapter,
      'zoom',
      { center: [150, 150], size: 200 },
      overrides,
    )

    expect(result.isError).toBeUndefined()
    expect(executor.hideSelf).toHaveBeenCalledWith(10)
    expect(executor.showSelf).toHaveBeenCalledTimes(1)
    expect(executor.enumerateUiElementsBulkForWindow).toHaveBeenCalled()
    const calledHwnds = executor.enumerateUiElementsBulkForWindow.mock.calls.map(
      (c: any[]) => c[0],
    )
    expect(calledHwnds).toContain(101)
    expect(lastMarks[0]?.name).toBe('Primary')
  })
})

describe('buildComputerUseTools', () => {
  it('always loads request_access so missing macOS permissions can recover directly', () => {
    const tools = buildComputerUseTools(
      { platform: 'darwin', screenshotFiltering: 'none' },
      'pixels',
    )
    const requestAccess = tools.find(tool => tool.name === 'request_access')

    expect(requestAccess?._meta?.['anthropic/alwaysLoad']).toBe(true)
  })
})

describe('macOS TCC gate', () => {
  const flags = {
    clipboardRead: false,
    clipboardWrite: false,
    systemKeyCombos: false,
  }

  function makeMacAdapter(grantedAfterPanel: boolean): ComputerUseHostAdapter {
    const base = makeAdapter()
    const missing = {
      platform: 'darwin' as const,
      granted: false as const,
      accessibility: false,
      screenRecording: true,
    }
    return {
      ...base,
      executor: {
        ...base.executor,
        capabilities: { platform: 'darwin', screenshotFiltering: 'none' },
      },
      ensureOsPermissions: vi
        .fn()
        .mockResolvedValueOnce(missing)
        .mockResolvedValueOnce(
          grantedAfterPanel
            ? { platform: 'darwin', granted: true }
            : missing,
        ),
    }
  }

  function makeMacOverrides(onPermissionRequest: ReturnType<typeof vi.fn>): ComputerUseOverrides {
    return {
      platform: 'darwin',
      allowedApps: [],
      userDeniedAppIdentifiers: [],
      grantFlags: flags,
      coordinateMode: 'pixels',
      onPermissionRequest,
    }
  }

  it('automatically shows the permission panel for ordinary tools', async () => {
    const adapter = makeMacAdapter(false)
    const onPermissionRequest = vi.fn(async () => ({
      granted: [],
      denied: [],
      flags,
    }))

    const result = await handleToolCall(
      adapter,
      'screenshot',
      {},
      makeMacOverrides(onPermissionRequest),
    )

    expect(onPermissionRequest).toHaveBeenCalledTimes(1)
    expect(onPermissionRequest.mock.calls[0]?.[0]).toMatchObject({
      apps: [],
      tccState: { accessibility: false, screenRecording: true },
    })
    expect(onPermissionRequest.mock.calls[0]?.[0].reason).toContain('screenshot')
    expect((result.content[0] as any).text).toContain('permission panel has been shown')
    expect((result.content[0] as any).text).toContain('retry screenshot')
    expect(adapter.executor.screenshot).not.toHaveBeenCalled()
  })

  it('tells the model to retry the original tool when permission is granted', async () => {
    const adapter = makeMacAdapter(true)
    const onPermissionRequest = vi.fn(async () => ({
      granted: [],
      denied: [],
      flags,
    }))

    const result = await handleToolCall(
      adapter,
      'screenshot',
      {},
      makeMacOverrides(onPermissionRequest),
    )

    expect((result.content[0] as any).text).toContain(
      'Accessibility and Screen Recording are now both granted',
    )
    expect((result.content[0] as any).text).toContain('Retry screenshot now')
    expect(adapter.executor.screenshot).not.toHaveBeenCalled()
  })
})
