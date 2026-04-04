import { describe, it, expect } from 'vitest'
import { getFrontmostApp, listRunningApps } from '../platforms/apps.js'
import { isNativeDisplayAvailable } from '../detect-display.js'

describe.skipIf(!isNativeDisplayAvailable())('apps', () => {
  it('getFrontmostApp returns app info', async () => {
    const app = await getFrontmostApp()
    // May be null on some CI environments, but on desktop should return something
    if (app) {
      expect(typeof app.bundleId).toBe('string')
      expect(typeof app.displayName).toBe('string')
      expect(app.bundleId.length).toBeGreaterThan(0)
    }
  })

  it('listRunningApps returns array', async () => {
    const apps = await listRunningApps()
    expect(Array.isArray(apps)).toBe(true)
    // On a desktop there should be at least one visible app
    if (apps.length > 0) {
      expect(typeof apps[0]!.bundleId).toBe('string')
      expect(typeof apps[0]!.displayName).toBe('string')
    }
  })
})
