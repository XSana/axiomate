import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../services/analytics/index.js', () => ({ logEvent: vi.fn() }))
vi.mock('../../../../services/api/withRetry.js', () => ({
  withRetry: vi.fn(async function* (_getClient: any, operation: any, options: any) {
    const client = await _getClient()
    const result = await operation(client, 1, { model: options.model, thinkingConfig: options.thinkingConfig })
    return result
  }),
  CannotRetryError: class extends Error {},
}))
vi.mock('../../../../utils/diagLogs.js', () => ({ logForDiagnosticsNoPII: vi.fn() }))
vi.mock('../../../../utils/betas.js', () => ({ getModelBetas: vi.fn().mockReturnValue([]) }))
vi.mock('../../../../utils/model/model.js', () => ({
  normalizeModelStringForAPI: vi.fn((m: string) => m),
  resolveModelStringForAPI: vi.fn((m: string) =>
    m === 'alias-model' ? 'provider-fast-model' : m,
  ),
}))
vi.mock('../../../../services/api/llm.js', () => ({
  getExtraBodyParams: vi.fn().mockReturnValue({}),
  adjustParamsForNonStreaming: vi.fn((p: any) => p),
  MAX_NON_STREAMING_TOKENS: 64000,
}))
vi.mock('../../../../utils/log.js', () => ({ logError: vi.fn() }))

import { AnthropicProvider } from '../../../../services/api/providers/anthropicProvider.js'
import { withRetry } from '../../../../services/api/withRetry.js'
import { getModelBetas } from '../../../../utils/betas.js'
import { getExtraBodyParams } from '../../../../services/api/llm.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockClient() {
  return {
      messages: {
        create: vi.fn().mockResolvedValue({ id: 'msg_test', content: [], usage: {} }),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnthropicProvider.verifyConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true on success', async () => {
    const mockClient = createMockClient()
    const provider = new AnthropicProvider({
      getClient: vi.fn().mockResolvedValue(mockClient),
    })

    const result = await provider.verifyConnection({ model: 'provider-fast-model' })
    expect(result).toBe(true)
  })

  it('calls create with correct params (model, max_tokens:1, temperature:1)', async () => {
    const mockClient = createMockClient()
    const provider = new AnthropicProvider({
      getClient: vi.fn().mockResolvedValue(mockClient),
    })

    await provider.verifyConnection({ model: 'provider-fast-model' })

    expect(mockClient.messages.create).toHaveBeenCalledTimes(1)
    const params = mockClient.messages.create.mock.calls[0][0]
    expect(params.model).toBe('provider-fast-model')
    expect(params.max_tokens).toBe(1)
    expect(params.temperature).toBe(1)
    expect(params.messages).toEqual([{ role: 'user', content: 'test' }])
  })

  it('resolves configured model keys before sending verification requests', async () => {
    const mockClient = createMockClient()
    const provider = new AnthropicProvider({
      getClient: vi.fn().mockResolvedValue(mockClient),
    })

    await provider.verifyConnection({ model: 'alias-model' })

    const params = mockClient.messages.create.mock.calls[0][0]
    expect(params.model).toBe('provider-fast-model')
  })

  it('calls getModelBetas', async () => {
    const mockClient = createMockClient()
    const provider = new AnthropicProvider({
      getClient: vi.fn().mockResolvedValue(mockClient),
    })

    await provider.verifyConnection({ model: 'provider-fast-model' })
    expect(getModelBetas).toHaveBeenCalled()
  })

  it('calls getExtraBodyParams', async () => {
    const mockClient = createMockClient()
    const provider = new AnthropicProvider({
      getClient: vi.fn().mockResolvedValue(mockClient),
    })

    await provider.verifyConnection({ model: 'provider-fast-model' })
    expect(getExtraBodyParams).toHaveBeenCalled()
  })

  it('uses semantic retry loop and disables SDK-level retries', async () => {
    const mockClient = createMockClient()
    const getClient = vi.fn().mockResolvedValue(mockClient)
    const provider = new AnthropicProvider({
      getClient,
    })

    await provider.verifyConnection({ model: 'provider-fast-model' })

    const mockWithRetry = vi.mocked(withRetry)
    expect(mockWithRetry).toHaveBeenCalledTimes(1)
    const retryOptions = mockWithRetry.mock.calls[0][2] as unknown as Record<string, unknown>
    expect(retryOptions.maxRetries).toBe(2)
    expect(getClient).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0 }),
    )
  })

  it('passes verification recovery traces through the retry loop', async () => {
    const mockClient = createMockClient()
    const onRecoveryTrace = vi.fn()
    const provider = new AnthropicProvider({
      getClient: vi.fn().mockResolvedValue(mockClient),
    })

    await provider.verifyConnection({
      model: 'provider-fast-model',
      onRecoveryTrace,
    })

    const retryOptions = vi.mocked(withRetry).mock.calls[0][2] as unknown as Record<string, unknown>
    expect(retryOptions).toMatchObject({
      protocol: 'anthropic',
      querySource: 'verify_api_key',
      operation: 'verify_connection',
      onRecoveryTrace,
    })
  })

  it('does not emit a duplicate boundary trace after retry-loop verification failure', async () => {
    const onRecoveryTrace = vi.fn()
    const provider = new AnthropicProvider({
      getClient: vi.fn().mockResolvedValue(createMockClient()),
    })

    vi.mocked(withRetry).mockImplementationOnce(async function* (
      _getClient: any,
      _operation: any,
      options: any,
    ) {
      options.onRecoveryTrace?.({
        timestamp: '2026-05-30T00:00:00.000Z',
        traceId: 'verify-trace',
        protocol: 'anthropic',
        model: options.model,
        attempt: 1,
        maxAttempts: 3,
        reason: 'auth',
        intent: 'fail_unrecoverable',
        action: 'fail_fast',
        outcome: 'failing',
        retryable: false,
        shouldCompress: false,
        shouldFallback: true,
        operation: 'verify_connection',
        querySource: 'verify_api_key',
        final: true,
      })
      throw new Error('verify failed')
    } as any)

    await expect(
      provider.verifyConnection({
        model: 'provider-fast-model',
        onRecoveryTrace,
      }),
    ).rejects.toThrow('verify failed')

    expect(onRecoveryTrace).toHaveBeenCalledTimes(1)
  })
})
