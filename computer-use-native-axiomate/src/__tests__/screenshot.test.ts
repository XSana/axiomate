import { describe, it, expect } from 'vitest'
import { listDisplays, getDisplaySize, captureDisplay, captureRegion } from '../screenshot.js'
import { isNativeDisplayAvailable } from '../detect-display.js'

describe.skipIf(!isNativeDisplayAvailable())('screenshot', () => {
  it('listDisplays returns at least one monitor', () => {
    const displays = listDisplays()
    expect(displays.length).toBeGreaterThanOrEqual(1)
    for (const d of displays) {
      expect(d.width).toBeGreaterThan(0)          // logical
      expect(d.height).toBeGreaterThan(0)         // logical
      expect(d.physicalWidth).toBeGreaterThan(0)  // physical
      expect(d.physicalHeight).toBeGreaterThan(0) // physical
      expect(d.scaleFactor).toBeGreaterThan(0)
      expect(d.physicalWidth).toBeGreaterThanOrEqual(d.width)
      expect(typeof d.displayId).toBe('number')
      expect(typeof d.isPrimary).toBe('boolean')
    }
  })

  it('getDisplaySize returns valid logical and physical dimensions', () => {
    const d = getDisplaySize()
    expect(d.width).toBeGreaterThan(0)
    expect(d.height).toBeGreaterThan(0)
    // physical = logical * scaleFactor
    expect(d.physicalWidth).toBe(d.width * d.scaleFactor)
    expect(d.physicalHeight).toBe(d.height * d.scaleFactor)
  })

  it('captureDisplay returns image in physical pixel dimensions', async () => {
    const display = getDisplaySize()
    const result = await captureDisplay()
    expect(result.base64.length).toBeGreaterThan(100)
    // Image dimensions should match physical pixels
    expect(result.width).toBe(display.physicalWidth)
    expect(result.height).toBe(display.physicalHeight)
  })

  it('captureRegion returns cropped image (screenshot-relative pixel coordinates)', async () => {
    // captureRegion takes coordinates relative to the display's screenshot image
    // (0,0) = top-left of that display's screenshot, not global coordinates
    const result = await captureRegion(
      10,  // 10px from left of this display's screenshot
      10,  // 10px from top
      100,
      100,
    )
    expect(result.base64.length).toBeGreaterThan(0)
    expect(result.width).toBe(100)
    expect(result.height).toBe(100)
  })
})
