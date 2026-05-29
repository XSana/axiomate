import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockGetGlobalConfig = vi.hoisted(() => vi.fn())
const mockSaveGlobalConfig = vi.hoisted(() => vi.fn())

vi.mock('../../../../utils/config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../utils/config.js')>()
  return {
    ...actual,
    getGlobalConfig: mockGetGlobalConfig,
    saveGlobalConfig: mockSaveGlobalConfig,
  }
})

import type { GlobalConfig, ModelProviderConfig } from '../../../../utils/config.js'
import { handleModelRouteCommand } from '../../../../commands/model/modelRoutes.js'

const model = (id: string): ModelProviderConfig => ({
  model: id,
  protocol: 'openai-chat',
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-key',
})

const baseConfig = (): GlobalConfig =>
  ({
    models: {
      main: model('main'),
      backup: model('backup'),
      fast: model('fast'),
    },
    model: {
      defaultRoute: 'default',
      routes: {
        default: {
          primary: 'main',
          fallbackChain: ['backup'],
        },
        cheap: {
          primary: 'fast',
          fallbackChain: [],
        },
      },
    },
    auxiliary: {
      goalJudge: {
        primary: 'backup',
        fallbackChain: ['main'],
      },
    },
  }) as unknown as GlobalConfig

function savedConfig(): GlobalConfig {
  expect(mockSaveGlobalConfig).toHaveBeenCalledTimes(1)
  return mockSaveGlobalConfig.mock.calls[0]![0](mockGetGlobalConfig())
}

function savedConfigAt(index: number): GlobalConfig {
  return mockSaveGlobalConfig.mock.calls[index]![0](mockGetGlobalConfig())
}

describe('model route commands', () => {
  beforeEach(() => {
    mockGetGlobalConfig.mockReset()
    mockSaveGlobalConfig.mockReset()
    mockGetGlobalConfig.mockReturnValue(baseConfig())
  })

  test('lists routes', () => {
    const result = handleModelRouteCommand('route list')
    expect(result).toMatchObject({ handled: true })
    expect(result.handled && result.message).toContain('* default: main -> backup')
    expect(result.handled && result.message).toContain('  cheap: fast')
    expect(mockSaveGlobalConfig).not.toHaveBeenCalled()
  })

  test('switches active route and reports its primary as active model', () => {
    const result = handleModelRouteCommand('route cheap')
    expect(result).toMatchObject({
      handled: true,
      activeModel: 'fast',
    })
    expect(savedConfig().model?.defaultRoute).toBe('cheap')
  })

  test('sets current default route primary via /model use', () => {
    const result = handleModelRouteCommand('use fast')
    expect(result).toMatchObject({
      handled: true,
      activeModel: 'fast',
    })
    expect(savedConfig().model?.routes?.default.primary).toBe('fast')
  })

  test('adds and removes fallback entries on the active route', () => {
    let result = handleModelRouteCommand('fallback add fast')
    expect(result).toMatchObject({ handled: true, activeModel: 'main' })
    const withFast = savedConfig()
    expect(withFast.model?.routes?.default.fallbackChain).toEqual([
      'backup',
      'fast',
    ])

    mockSaveGlobalConfig.mockReset()
    mockGetGlobalConfig.mockReturnValue(withFast)
    result = handleModelRouteCommand('fallback remove backup')
    expect(result).toMatchObject({ handled: true, activeModel: 'main' })
    expect(savedConfigAt(0).model?.routes?.default.fallbackChain).toEqual([
      'fast',
    ])
  })

  test('sets auxiliary task primary', () => {
    const result = handleModelRouteCommand('aux set goalJudge fast')
    expect(result).toMatchObject({
      handled: true,
      message: 'Set auxiliary goalJudge primary to fast',
    })
    expect(savedConfig().auxiliary?.goalJudge.primary).toBe('fast')
  })

  test('returns handled false for legacy direct model arguments', () => {
    expect(handleModelRouteCommand('main')).toEqual({ handled: false })
  })
})
