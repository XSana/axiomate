import { describe, expect, test } from 'vitest'

import type { GlobalConfig, ModelProviderConfig } from '../../../../utils/config.js'
import {
  getAuxiliaryTaskPolicyFromConfig,
  getMainRouteFromConfig,
  normalizeModelRoutingConfig,
  resolveModelChainFromRoute,
  validateModelRoutingConfig,
} from '../../../../utils/model/modelRouting.js'

const model = (
  id: string,
  overrides: Partial<ModelProviderConfig> = {},
): ModelProviderConfig => ({
  model: id,
  protocol: 'openai-chat',
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-key',
  ...overrides,
})

const config = (input: Partial<GlobalConfig>): GlobalConfig =>
  input as unknown as GlobalConfig

describe('modelRouting', () => {
  test('normalizes legacy current/mid/fast fields into main route and auxiliary policies', () => {
    const legacyConfig = config({
      models: {
        main: model('main'),
        mid: model('mid'),
        fast: model('fast'),
      },
      currentModel: 'main',
      midModel: 'mid',
      fastModel: 'fast',
    })

    const normalized = normalizeModelRoutingConfig(legacyConfig)

    expect(normalized.model?.defaultRoute).toBe('default')
    expect(normalized.model?.routes?.default).toMatchObject({
      primary: 'main',
      fallbackChain: ['mid', 'fast'],
      recoveryProfile: 'main-agent',
      allowActions: ['retry_same_model', 'adapt_request', 'switch_model'],
    })
    expect(normalized.model?.routes?.default.switchModelOn).toContain(
      'rate_limit',
    )

    expect(normalized.auxiliary?.goalJudge).toMatchObject({
      primary: 'mid',
      fallbackChain: ['fast', 'main'],
      recoveryProfile: 'auxiliary-judge',
      failure: 'fail_open',
    })
    expect(normalized.auxiliary?.sessionTitle).toMatchObject({
      primary: 'fast',
      fallbackChain: ['mid', 'main'],
      recoveryProfile: 'auxiliary-fast',
      failure: 'return_null',
    })
  })

  test('uses explicit route and auxiliary policies ahead of legacy fields', () => {
    const explicitConfig = config({
      models: {
        main: model('main'),
        backup: model('backup'),
        aux: model('aux'),
        legacy: model('legacy'),
      },
      currentModel: 'legacy',
      fastModel: 'legacy',
      midModel: 'legacy',
      model: {
        defaultRoute: 'quality',
        routes: {
          quality: {
            primary: 'main',
            fallbackChain: ['backup'],
            recoveryProfile: 'main-agent',
            allowActions: ['switch_model'],
            switchModelOn: ['rate_limit'],
          },
        },
      },
      auxiliary: {
        goalJudge: {
          primary: 'aux',
          fallbackChain: ['backup'],
          recoveryProfile: 'auxiliary-judge',
          allowActions: ['retry_same_model'],
          switchModelOn: ['timeout'],
          failure: 'fail_closed',
        },
      },
    })

    const mainRoute = getMainRouteFromConfig(explicitConfig)
    const goalJudge = getAuxiliaryTaskPolicyFromConfig(explicitConfig, 'goalJudge')

    expect(mainRoute).toMatchObject({
      id: 'quality',
      primary: 'main',
      fallbackChain: ['backup'],
      allowActions: ['switch_model'],
      switchModelOn: ['rate_limit'],
    })
    expect(goalJudge).toMatchObject({
      task: 'goalJudge',
      primary: 'aux',
      fallbackChain: ['backup'],
      allowActions: ['retry_same_model'],
      switchModelOn: ['timeout'],
      failure: 'fail_closed',
    })
  })

  test('validates route primary and fallback references against models map', () => {
    const issues = validateModelRoutingConfig(config({
      models: {
        main: model('main'),
      },
      model: {
        defaultRoute: 'default',
        routes: {
          default: {
            primary: 'missing',
            fallbackChain: ['main', 'main', 'also-missing'],
          },
        },
      },
      auxiliary: {
        goalJudge: {
          primary: 'main',
          fallbackChain: ['main'],
        },
      },
    }))

    expect(issues.map(issue => issue.path)).toEqual([
      'model.routes.default.primary',
      'model.routes.default.fallbackChain[1]',
      'model.routes.default.fallbackChain[2]',
      'auxiliary.goalJudge.fallbackChain[0]',
    ])
  })

  test('validates policy action, switch reason, and auxiliary failure values', () => {
    const issues = validateModelRoutingConfig(config({
      models: {
        main: model('main'),
      },
      model: {
        defaultRoute: 'default',
        routes: {
          default: {
            primary: 'main',
            allowActions: ['switch_model', 'fallback_now'],
            switchModelOn: ['rate_limit', 'bad_reason'],
          } as never,
        },
      },
      auxiliary: {
        goalJudge: {
          primary: 'main',
          failure: 'explode',
        } as never,
      },
    }))

    expect(issues.map(issue => issue.path)).toEqual([
      'model.routes.default.allowActions[1]',
      'model.routes.default.switchModelOn[1]',
      'auxiliary.goalJudge.failure',
    ])
  })

  test('resolves model chain as primary followed by ordered unique fallback models', () => {
    expect(
      resolveModelChainFromRoute({
        primary: 'main',
        fallbackChain: ['backup', 'main', 'backup', 'fast'],
      }),
    ).toEqual(['main', 'backup', 'fast'])
  })
})
