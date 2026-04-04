/**
 * Screenshot implementation using node-screenshots.
 * Cross-platform: macOS, Windows, Linux.
 *
 * node-screenshots is loaded lazily because it panics on import in environments
 * without a display server (WSL without WSLg, headless Linux).
 */

import { createRequire } from 'node:module'
import { isNativeDisplayAvailable } from './detect-display.js'

type MonitorType = import('node-screenshots').Monitor
type MonitorClass = typeof import('node-screenshots').Monitor

let _MonitorClass: MonitorClass | null = null
let _loadError: string | null = null

function getMonitorClass(): MonitorClass {
  if (_loadError) throw new Error(_loadError)
  if (_MonitorClass) return _MonitorClass

  // Guard: subprocess probe determines if native module can load safely.
  // node-screenshots panics (abort) on incompatible Wayland or headless — uncatchable.
  if (!isNativeDisplayAvailable()) {
    _loadError = 'node-screenshots unavailable: no compatible display server detected'
    throw new Error(_loadError)
  }

  try {
    // Use createRequire for ESM compatibility; native .node files can't be import()'d
    const req = createRequire(import.meta.url)
    const mod = req('node-screenshots')
    _MonitorClass = mod.Monitor
    return _MonitorClass!
  } catch (e: any) {
    _loadError = `node-screenshots failed to load: ${e.message}`
    throw new Error(_loadError)
  }
}

export interface DisplayInfo {
  displayId: number
  /** Physical pixel width. */
  physicalWidth: number
  /** Physical pixel height. */
  physicalHeight: number
  /** Logical width (physicalWidth / scaleFactor). Used by nut.js and OS coordinates. */
  width: number
  /** Logical height (physicalHeight / scaleFactor). Used by nut.js and OS coordinates. */
  height: number
  scaleFactor: number
  /** Logical origin X. */
  originX: number
  /** Logical origin Y. */
  originY: number
  isPrimary: boolean
  label: string
}

export interface CaptureResult {
  base64: string
  width: number
  height: number
}

/**
 * Derive the logical origin of a monitor.
 *
 * node-screenshots returns physical pixel values for x()/y()/width()/height(),
 * but Monitor.fromPoint() and nut.js use the Windows virtual desktop logical
 * coordinate system. We derive logical origin by scanning fromPoint along the
 * monitor's physical extent to find where it actually starts in logical space.
 *
 * For the primary monitor (physical origin 0,0), logical origin is always (0,0).
 * For other monitors, logical origin = physical origin / scaleFactor.
 * This holds because Windows' virtual desktop coordinates are DPI-normalized.
 */
function monitorToDisplayInfo(m: MonitorType): DisplayInfo {
  const scale = m.scaleFactor()
  const physW = m.width()
  const physH = m.height()
  const logW = Math.round(physW / scale)
  const logH = Math.round(physH / scale)
  // Windows virtual desktop logical coordinates = physical / scale
  const logOriginX = Math.round(m.x() / scale)
  const logOriginY = Math.round(m.y() / scale)
  return {
    displayId: m.id(),
    physicalWidth: physW,
    physicalHeight: physH,
    width: logW,
    height: logH,
    scaleFactor: scale,
    originX: logOriginX,
    originY: logOriginY,
    isPrimary: m.isPrimary(),
    label: m.name() || `Display ${m.id()}`,
  }
}

export function listDisplays(): DisplayInfo[] {
  return getMonitorClass().all().map(monitorToDisplayInfo)
}

export function getDisplaySize(displayId?: number): DisplayInfo {
  const monitors = getMonitorClass().all()
  if (displayId !== undefined) {
    const m = monitors.find(m => m.id() === displayId)
    if (m) return monitorToDisplayInfo(m)
  }
  const primary = monitors.find(m => m.isPrimary()) ?? monitors[0]
  if (!primary) throw new Error('No displays found')
  return monitorToDisplayInfo(primary)
}

export function findDisplayByPoint(x: number, y: number): DisplayInfo | null {
  const m = getMonitorClass().fromPoint(x, y)
  return m ? monitorToDisplayInfo(m) : null
}

function findMonitor(displayId?: number): MonitorType {
  const monitors = getMonitorClass().all()
  if (displayId !== undefined) {
    const m = monitors.find(m => m.id() === displayId)
    if (m) return m
  }
  const primary = monitors.find(m => m.isPrimary()) ?? monitors[0]
  if (!primary) throw new Error('No displays found')
  return primary
}

export async function captureDisplay(displayId?: number): Promise<CaptureResult> {
  const monitor = findMonitor(displayId)
  const image = await monitor.captureImage()
  // node-screenshots toJpeg returns JPEG buffer (copyOutputData flag, not quality)
  const jpeg = await image.toJpeg()
  const base64 = Buffer.from(jpeg).toString('base64')
  return { base64, width: image.width, height: image.height }
}

/**
 * Capture a region of a display's screenshot.
 * Coordinates are **relative to the display's screenshot image** (0,0 = top-left of that display).
 * This matches what AI sees: screenshot pixel coordinates within a single display.
 */
export async function captureRegion(
  x: number,
  y: number,
  w: number,
  h: number,
  displayId?: number,
): Promise<CaptureResult> {
  const monitor = findMonitor(displayId)
  const image = await monitor.captureImage()
  const cropped = await image.crop(x, y, w, h)
  const jpeg = await cropped.toJpeg()
  const base64 = Buffer.from(jpeg).toString('base64')
  return { base64, width: cropped.width, height: cropped.height }
}
