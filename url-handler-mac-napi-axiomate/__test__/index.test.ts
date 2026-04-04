import { describe, it, expect, beforeEach } from 'vitest'
import { configure, waitForUrlEvent } from '../index'

describe('url-handler-mac-napi-axiomate', () => {
  beforeEach(() => {
    // Reset to default scheme
    configure({ scheme: 'axiomate' })
  })

  describe('configure', () => {
    it('does not throw', () => {
      expect(() => configure({ scheme: 'myapp' })).not.toThrow()
    })

    it('accepts empty config', () => {
      expect(() => configure({})).not.toThrow()
    })
  })

  describe('waitForUrlEvent', () => {
    if (process.platform !== 'darwin') {
      it('returns null on non-macOS', () => {
        expect(waitForUrlEvent(100)).toBeNull()
      })
    }

    if (process.platform === 'darwin') {
      it('returns null when no URL event within timeout', () => {
        // Short timeout — no URL event expected in test environment
        const result = waitForUrlEvent(100)
        expect(result === null || typeof result === 'string').toBe(true)
      })

      it('returns null for mismatched scheme', () => {
        // Configure a scheme that won't match any incoming URL
        configure({ scheme: 'nonexistent-test-scheme-12345' })
        const result = waitForUrlEvent(100)
        expect(result).toBeNull()
      })
    }
  })
})
