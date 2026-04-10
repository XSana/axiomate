import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchProviderError } from '../searchProvider.js'

const mockGlobalConfig = vi.fn()

vi.mock('../../../utils/config.js', () => ({
  getGlobalConfig: () => mockGlobalConfig(),
}))

import {
  getSearchProviderForModel,
  hasSearchProviderForModel,
} from '../searchProviderRegistry.js'

describe('searchProviderRegistry', () => {
  beforeEach(() => {
    mockGlobalConfig.mockReset()
  })

  it('returns the configured provider for a model', () => {
    mockGlobalConfig.mockReturnValue({
      searchProviders: {
        google: {
          type: 'google-cse',
          apiKey: 'api-key',
          cx: 'search-engine-id',
        },
      },
      models: {
        'qwen/qwen3': {
          model: 'qwen/qwen3',
          protocol: 'openai',
          baseUrl: 'https://example.com/v1',
          apiKey: 'sk-test',
          searchProvider: 'google',
        },
      },
    })

    const provider = getSearchProviderForModel('qwen/qwen3')
    expect(provider.name).toBe('google')
    expect(provider.type).toBe('google-cse')
    expect(provider.capabilities).toEqual({
      allowedDomains: 'adapter',
      blockedDomains: 'adapter',
      snippets: 'native',
    })
    expect(hasSearchProviderForModel('qwen/qwen3')).toBe(true)
  })

  it('throws when the model does not define a searchProvider', () => {
    mockGlobalConfig.mockReturnValue({
      models: {
        'qwen/qwen3': {
          model: 'qwen/qwen3',
          protocol: 'openai',
          baseUrl: 'https://example.com/v1',
          apiKey: 'sk-test',
        },
      },
    })

    expect(() => getSearchProviderForModel('qwen/qwen3')).toThrowError(
      SearchProviderError,
    )
    expect(() => getSearchProviderForModel('qwen/qwen3')).toThrow(
      /does not define a searchProvider/,
    )
    expect(hasSearchProviderForModel('qwen/qwen3')).toBe(false)
  })

  it('throws when the referenced provider is missing', () => {
    mockGlobalConfig.mockReturnValue({
      searchProviders: {},
      models: {
        'qwen/qwen3': {
          model: 'qwen/qwen3',
          protocol: 'openai',
          baseUrl: 'https://example.com/v1',
          apiKey: 'sk-test',
          searchProvider: 'google',
        },
      },
    })

    expect(() => getSearchProviderForModel('qwen/qwen3')).toThrow(
      /was not found/,
    )
  })
})
