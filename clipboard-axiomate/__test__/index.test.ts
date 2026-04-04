import { describe, it, expect } from 'vitest'
import {
  hasClipboardImage,
  readClipboardImage,
  hasClipboardImageAsync,
  readClipboardImageAsync,
  readClipboardText,
} from '../index'

describe('clipboard-axiomate', () => {
  // --- Sync API (macOS NAPI only) ---

  describe('hasClipboardImage (sync)', () => {
    it('returns a boolean', () => {
      expect(typeof hasClipboardImage()).toBe('boolean')
    })

    if (process.platform !== 'darwin') {
      it('returns false on non-macOS', () => {
        expect(hasClipboardImage()).toBe(false)
      })
    }
  })

  describe('readClipboardImage (sync)', () => {
    if (process.platform !== 'darwin') {
      it('returns null on non-macOS', () => {
        expect(readClipboardImage(2000, 2000)).toBeNull()
      })
    }

    if (process.platform === 'darwin') {
      it('returns null or valid result', () => {
        const result = readClipboardImage(2000, 2000)
        if (result === null) {
          expect(result).toBeNull()
        } else {
          expect(result.png).toBeInstanceOf(Buffer)
          expect(result.png.length).toBeGreaterThan(0)
          expect(result.width).toBeLessThanOrEqual(2000)
          expect(result.height).toBeLessThanOrEqual(2000)
        }
      })

      it('respects maxWidth/maxHeight constraints', () => {
        const result = readClipboardImage(100, 100)
        if (result !== null) {
          expect(result.width).toBeLessThanOrEqual(100)
          expect(result.height).toBeLessThanOrEqual(100)
        }
      })
    }
  })

  // --- Async API (cross-platform) ---

  describe('hasClipboardImageAsync', () => {
    it('returns a boolean', async () => {
      const result = await hasClipboardImageAsync()
      expect(typeof result).toBe('boolean')
    })
  })

  describe('readClipboardImageAsync', () => {
    it('returns null or valid result', async () => {
      const result = await readClipboardImageAsync(2000, 2000)
      if (result === null) {
        expect(result).toBeNull()
      } else {
        expect(result.png).toBeInstanceOf(Buffer)
        expect(result.png.length).toBeGreaterThan(0)
      }
    })
  })

  describe('readClipboardText', () => {
    it('returns string or null', async () => {
      const result = await readClipboardText()
      expect(result === null || typeof result === 'string').toBe(true)
    })
  })
})
