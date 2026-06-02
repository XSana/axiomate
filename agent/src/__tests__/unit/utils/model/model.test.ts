import { beforeEach, describe, expect, test } from 'vitest'

import { saveGlobalConfig } from '../../../../utils/config.js'
import {
  getUserSpecifiedModelSetting,
  normalizeModelStringForAPI,
  resolveModelStringForAPI,
} from '../../../../utils/model/model.js'
import type { ModelProviderConfig } from '../../../../utils/config.js'

const model = (id: string): ModelProviderConfig => ({
  model: id,
  protocol: 'openai-chat',
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-key',
})

describe('model resolution', () => {
  beforeEach(() => {
    saveGlobalConfig(current => ({
      ...current,
      models: undefined,
      model: undefined,
      auxiliary: undefined,
    }))
  })

  test('treats an empty first-run config as no selected model', () => {
    expect(getUserSpecifiedModelSetting()).toBeUndefined()
  })

  test('still rejects configured models without an active route', () => {
    saveGlobalConfig(current => ({
      ...current,
      models: {
        main: model('main'),
      },
    }))

    expect(() => getUserSpecifiedModelSetting()).toThrow(
      'No main model route configured',
    )
  })

  test('normalizes model strings without resolving configured keys', () => {
    saveGlobalConfig(current => ({
      ...current,
      models: {
        'micu-02-deepseek-v4-pro': model('deepseek-v4-pro'),
      },
      model: {
        defaultRoute: 'default',
        routes: {
          default: { primary: 'micu-02-deepseek-v4-pro' },
        },
      },
    }))

    expect(normalizeModelStringForAPI('micu-02-deepseek-v4-pro')).toBe(
      'micu-02-deepseek-v4-pro',
    )
    expect(resolveModelStringForAPI('micu-02-deepseek-v4-pro')).toBe(
      'deepseek-v4-pro',
    )
  })

  test('preserves raw provider model ids that are not configured keys', () => {
    expect(resolveModelStringForAPI('deepseek-v4-pro')).toBe(
      'deepseek-v4-pro',
    )
  })
})
