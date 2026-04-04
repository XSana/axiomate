import { describe, it, expect } from 'vitest'
import {
  hasClipboardImage,
  readClipboardImage,
  hasClipboardImageAsync,
  readClipboardImageAsync,
  getNativeModule,
} from '../src/index.js'

describe('clipboard integration', () => {
  describe('hasClipboardImage (sync)', () => {
    it('returns boolean', () => {
      expect(typeof hasClipboardImage()).toBe('boolean')
    })
  })

  describe('readClipboardImage (sync)', () => {
    it('returns null or valid result', () => {
      const result = readClipboardImage(2000, 2000)
      if (result !== null) {
        expect(result.png).toBeInstanceOf(Buffer)
        expect(result.png.length).toBeGreaterThan(0)
      }
    })
  })

  describe('hasClipboardImageAsync', () => {
    it('returns boolean', async () => {
      const result = await hasClipboardImageAsync()
      expect(typeof result).toBe('boolean')
    })
  })

  describe('readClipboardImageAsync', () => {
    it('returns null or valid result', async () => {
      const result = await readClipboardImageAsync(2000, 2000)
      if (result !== null) {
        expect(result.png).toBeInstanceOf(Buffer)
        expect(result.png.length).toBeGreaterThan(0)
      }
    })
  })

  describe('getNativeModule', () => {
    it('returns object or null', () => {
      const mod = getNativeModule()
      if (mod !== null) {
        expect(typeof mod.hasClipboardImage).toBe('function')
        expect(typeof mod.readClipboardImage).toBe('function')
      }
    })
  })
})
