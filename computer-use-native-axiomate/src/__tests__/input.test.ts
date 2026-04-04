import { describe, it, expect } from 'vitest'
import { getCursorPosition, moveMouse } from '../input.js'
import { getDisplaySize } from '../screenshot.js'
import { isNativeDisplayAvailable } from '../detect-display.js'

describe.skipIf(!isNativeDisplayAvailable())('input', () => {
  it('getCursorPosition returns coordinates', async () => {
    const pos = await getCursorPosition()
    expect(typeof pos.x).toBe('number')
    expect(typeof pos.y).toBe('number')
  })

  it('moveMouse changes cursor position', async () => {
    const display = getDisplaySize()
    const before = await getCursorPosition()
    // Use logical coordinates (what nut.js expects)
    // Pick a target in the opposite quadrant of the screen
    const midX = Math.floor(display.width / 2)   // logical width
    const midY = Math.floor(display.height / 2)   // logical height
    const target = {
      x: before.x < midX ? Math.floor(midX * 1.5) : Math.floor(midX * 0.5),
      y: before.y < midY ? Math.floor(midY * 1.5) : Math.floor(midY * 0.5),
    }
    await moveMouse(target.x, target.y)
    await new Promise(r => setTimeout(r, 100))
    const after = await getCursorPosition()
    // nut.js uses logical coordinates; DPI rounding can cause ~15px offset
    expect(Math.abs(after.x - target.x)).toBeLessThan(20)
    expect(Math.abs(after.y - target.y)).toBeLessThan(20)
  })
})
