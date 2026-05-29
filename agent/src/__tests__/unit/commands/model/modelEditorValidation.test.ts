import { describe, expect, test } from 'vitest'
import type {
  GlobalConfig,
  ModelProviderConfig,
} from '../../../../utils/config.js'
import { validateModelEditConfig } from '../../../../commands/model/modelEditorValidation.js'

const model = (id: string): ModelProviderConfig => ({
  model: id,
  protocol: 'openai-chat',
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-key',
})

describe('model editor final config validation', () => {
  test('accepts a model edit when route and auxiliary references remain valid', () => {
    const current: GlobalConfig = {
      models: {
        main: model('main'),
        backup: model('backup'),
      },
      model: {
        defaultRoute: 'default',
        routes: {
          default: {
            primary: 'main',
            fallbackChain: ['backup'],
          },
        },
      },
      auxiliary: {
        goalJudge: {
          primary: 'backup',
          fallbackChain: ['main'],
        },
      },
    } as unknown as GlobalConfig

    expect(validateModelEditConfig(current, 'backup', model('backup'))).toBeUndefined()
  })

  test('reports existing route and auxiliary broken references before save', () => {
    const current: GlobalConfig = {
      models: {
        main: model('main'),
      },
      model: {
        defaultRoute: 'default',
        routes: {
          default: {
            primary: 'main',
            fallbackChain: ['missing'],
          },
        },
      },
      auxiliary: {
        goalJudge: {
          primary: 'missing',
          fallbackChain: ['main'],
        },
      },
    } as unknown as GlobalConfig

    const error = validateModelEditConfig(current, 'main', model('main'))
    expect(error).toContain('model.routes.default.fallbackChain[0]')
    expect(error).toContain('auxiliary.goalJudge.primary')
  })
})
