import { describe, expect, it } from 'vitest'
import { ModelProviderConfigSchema } from '../../../utils/modelConfigSchema.js'

const baseModelConfig = {
  model: 'gpt-4o',
  protocol: 'openai-responses',
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'test-key',
}

describe('ModelProviderConfigSchema prompt cache compat fields', () => {
  it('accepts prompt cache and Codex transport compat settings', () => {
    expect(
      ModelProviderConfigSchema.safeParse({
        ...baseModelConfig,
        promptCacheKey: true,
        promptCacheRewriteLimit: 0,
        codexTransportCompat: true,
      }).success,
    ).toBe(true)

    expect(
      ModelProviderConfigSchema.safeParse({
        ...baseModelConfig,
        promptCacheKey: 'axiomate:project:{projectHash}:{providerHash}',
        promptCacheRewriteLimit: 3,
      }).success,
    ).toBe(true)
  })

  it('rejects invalid prompt cache compat settings', () => {
    expect(
      ModelProviderConfigSchema.safeParse({
        ...baseModelConfig,
        promptCacheKey: 1,
      }).success,
    ).toBe(false)

    expect(
      ModelProviderConfigSchema.safeParse({
        ...baseModelConfig,
        promptCacheRewriteLimit: -1,
      }).success,
    ).toBe(false)

    expect(
      ModelProviderConfigSchema.safeParse({
        ...baseModelConfig,
        promptCacheRewriteLimit: 1.5,
      }).success,
    ).toBe(false)
  })
})
