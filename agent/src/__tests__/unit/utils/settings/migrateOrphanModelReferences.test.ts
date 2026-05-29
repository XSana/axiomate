import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mockGetGlobalConfig = vi.hoisted(() => vi.fn())
const mockSaveGlobalConfig = vi.hoisted(() => vi.fn())
const mockGetSettings = vi.hoisted(() => vi.fn())
const mockUpdateSettings = vi.hoisted(() => vi.fn())

vi.mock('../../../../utils/config.js', () => ({
  getGlobalConfig: mockGetGlobalConfig,
  saveGlobalConfig: mockSaveGlobalConfig,
}))
vi.mock('../../../../utils/settings/settings.js', () => ({
  getSettingsForSource: mockGetSettings,
  updateSettingsForSource: mockUpdateSettings,
}))

import { migrateOrphanModelReferences } from '../../../../utils/settings/migrateOrphanModelReferences.js'

describe('migrateOrphanModelReferences', () => {
  beforeEach(() => {
    mockGetGlobalConfig.mockReset()
    mockSaveGlobalConfig.mockReset()
    mockGetSettings.mockReset()
    mockUpdateSettings.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('heals dangling route and auxiliary references against models map', () => {
    const current = {
      models: { main: {}, backup: {} },
      model: {
        defaultRoute: 'default',
        routes: {
          default: {
            primary: 'deleted',
            fallbackChain: ['backup', 'missing'],
          },
        },
      },
      auxiliary: {
        goalJudge: {
          primary: 'gone',
          fallbackChain: ['main', 'missing'],
        },
      },
    }
    mockGetGlobalConfig.mockReturnValue(current)
    mockGetSettings.mockReturnValue({})

    migrateOrphanModelReferences()

    expect(mockSaveGlobalConfig).toHaveBeenCalledTimes(1)
    const updater = mockSaveGlobalConfig.mock.calls[0]![0]
    const next = updater(current)
    expect(next.model.routes.default.primary).toBe('main')
    expect(next.model.routes.default.fallbackChain).toEqual(['backup'])
    expect(next.auxiliary.goalJudge.primary).toBe('main')
    expect(next.auxiliary.goalJudge.fallbackChain).toEqual([])
  })

  test('prunes orphan settings.effortByModel entries', () => {
    mockGetGlobalConfig.mockReturnValue({
      models: { main: {} },
      model: {
        defaultRoute: 'default',
        routes: { default: { primary: 'main', fallbackChain: [] } },
      },
    })
    mockGetSettings.mockReturnValue({
      effortByModel: {
        main: 'high',
        deleted: 'max',
      },
    })

    migrateOrphanModelReferences()

    expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
    const [, updated] = mockUpdateSettings.mock.calls[0]!
    expect(updated.effortByModel).toEqual({ main: 'high' })
  })

  test('does not synthesize route config when no routes exist', () => {
    mockGetGlobalConfig.mockReturnValue({
      models: { main: {} },
    })
    mockGetSettings.mockReturnValue({})

    migrateOrphanModelReferences()

    expect(mockSaveGlobalConfig).not.toHaveBeenCalled()
    expect(mockUpdateSettings).not.toHaveBeenCalled()
  })
})
