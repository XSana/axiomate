import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mockGetSettings = vi.hoisted(() => vi.fn())
const mockUpdateSettings = vi.hoisted(() => vi.fn())

vi.mock('../settings.js', () => ({
  getSettingsForSource: mockGetSettings,
  updateSettingsForSource: mockUpdateSettings,
}))

import { migrateLegacyEffortLevelField } from '../migrateLegacyEffortField.js'

describe('migrateLegacyEffortLevelField', () => {
  beforeEach(() => {
    mockGetSettings.mockReset()
    mockUpdateSettings.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('removes legacy effortLevel field from userSettings', () => {
    mockGetSettings.mockReturnValue({
      effortLevel: 'high',
      otherField: 'preserved',
    })
    migrateLegacyEffortLevelField()
    expect(mockUpdateSettings).toHaveBeenCalledWith('userSettings', {
      otherField: 'preserved',
    })
  })

  test('no-op when settings has no effortLevel field', () => {
    mockGetSettings.mockReturnValue({ otherField: 'preserved' })
    migrateLegacyEffortLevelField()
    expect(mockUpdateSettings).not.toHaveBeenCalled()
  })

  test('no-op when settings is null/undefined', () => {
    mockGetSettings.mockReturnValue(null)
    migrateLegacyEffortLevelField()
    expect(mockUpdateSettings).not.toHaveBeenCalled()
  })

  test("doesn't touch the new effortByModel field", () => {
    mockGetSettings.mockReturnValue({
      effortLevel: 'medium',
      effortByModel: { 'gpt-4': 'high' },
    })
    migrateLegacyEffortLevelField()
    expect(mockUpdateSettings).toHaveBeenCalledWith('userSettings', {
      effortByModel: { 'gpt-4': 'high' },
    })
  })
})
