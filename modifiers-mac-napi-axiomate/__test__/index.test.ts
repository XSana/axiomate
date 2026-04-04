import { describe, it, expect } from 'vitest'
import { getModifiers, isModifierPressed, prewarm } from '../index'

describe('modifiers-mac-napi-axiomate', () => {
  describe('prewarm', () => {
    it('does not throw', () => {
      expect(() => prewarm()).not.toThrow()
    })
  })

  describe('getModifiers', () => {
    it('returns an array', () => {
      const result = getModifiers()
      expect(Array.isArray(result)).toBe(true)
    })

    if (process.platform !== 'darwin') {
      it('returns empty array on non-macOS', () => {
        expect(getModifiers()).toEqual([])
      })
    }

    if (process.platform === 'darwin') {
      it('returns array of valid modifier names', () => {
        const valid = ['shift', 'command', 'control', 'option']
        const result = getModifiers()
        for (const mod of result) {
          expect(valid).toContain(mod)
        }
      })
    }
  })

  describe('isModifierPressed', () => {
    it('returns boolean for shift', () => {
      expect(typeof isModifierPressed('shift')).toBe('boolean')
    })

    it('returns boolean for command', () => {
      expect(typeof isModifierPressed('command')).toBe('boolean')
    })

    it('returns false for unknown modifier', () => {
      expect(isModifierPressed('nonexistent')).toBe(false)
    })

    if (process.platform !== 'darwin') {
      it('returns false on non-macOS', () => {
        expect(isModifierPressed('shift')).toBe(false)
        expect(isModifierPressed('command')).toBe(false)
        expect(isModifierPressed('control')).toBe(false)
        expect(isModifierPressed('option')).toBe(false)
      })
    }
  })
})
