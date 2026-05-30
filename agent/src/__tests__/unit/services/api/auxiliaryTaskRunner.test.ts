import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuxiliaryFailureDisposition } from '../../../../utils/config.js'
import type { ResolvedAuxiliaryTaskPolicy } from '../../../../utils/model/modelRouting.js'
import type { LLMProvider } from '../../../../services/api/provider.js'
import { LLMAPIError } from '../../../../services/api/streamTypes.js'
import {
  auxiliaryAttemptQueryOptions,
  auxiliaryFailureAssistantMessage,
  runAuxiliaryInference,
  runAuxiliaryTask,
} from '../../../../services/api/auxiliaryTaskRunner.js'
import { FallbackTriggeredError } from '../../../../services/api/withRetry.js'

const policy: ResolvedAuxiliaryTaskPolicy = {
  id: 'sessionSearchSummary',
  task: 'sessionSearchSummary',
  primary: 'primary-model',
  fallbackChain: ['fallback-model', 'final-model'],
  recoveryProfile: 'auxiliary-fast',
  allowActions: ['retry_same_model', 'adapt_request', 'switch_model'],
  switchModelOn: ['model_not_found', 'server_error', 'overloaded'],
  failure: 'return_null',
  timeoutMs: 30_000,
  maxOutputTokens: undefined,
}

const providers = new Map<string, LLMProvider>()

vi.mock('../../../../utils/model/model.js', () => ({
  getAuxiliaryTaskPolicy: vi.fn(() => policy),
}))

vi.mock('../../../../services/api/providerRegistry.js', () => ({
  getProviderForModel: vi.fn((model: string) => providers.get(model)),
}))

function makeProvider(
  model: string,
  inference: LLMProvider['inference'],
): LLMProvider {
  return {
    name: 'openai-chat',
    inference,
    wrapError(error: unknown): LLMAPIError {
      if (error instanceof LLMAPIError) return error
      return new LLMAPIError(
        error instanceof Error ? error.message : String(error),
      )
    },
  } as unknown as LLMProvider
}

beforeEach(() => {
  providers.clear()
  policy.failure = 'return_null'
  policy.maxOutputTokens = undefined
})

describe('auxiliaryTaskRunner', () => {
  it('walks the auxiliary fallback chain and does not treat failed fallback attempts as success', async () => {
    providers.set(
      'primary-model',
      makeProvider(
        'primary-model',
        vi.fn().mockRejectedValue(
          new LLMAPIError('model not found', { status: 404 }),
        ),
      ),
    )
    providers.set(
      'fallback-model',
      makeProvider(
        'fallback-model',
        vi.fn().mockRejectedValue(
          new LLMAPIError('bad gateway', { status: 502 }),
        ),
      ),
    )
    providers.set(
      'final-model',
      makeProvider(
        'final-model',
        vi.fn().mockResolvedValue({
          id: 'resp_final',
          content: [{ type: 'text', text: 'ok' }],
          model: 'final-model',
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      ),
    )

    const result = await runAuxiliaryTask({
      task: 'sessionSearchSummary',
      operation: 'inference',
      querySource: 'session_search',
      execute: attempt =>
        runAuxiliaryInference(attempt, {
          messages: [{ role: 'user', content: 'summarize' }],
          querySource: 'session_search',
        }),
    })

    expect(result.id).toBe('resp_final')
    expect(providers.get('primary-model')!.inference).toHaveBeenCalledTimes(1)
    expect(providers.get('fallback-model')!.inference).toHaveBeenCalledTimes(2)
    expect(providers.get('final-model')!.inference).toHaveBeenCalledTimes(1)
  })

  it('applies auxiliary task maxOutputTokens to inference requests', async () => {
    policy.maxOutputTokens = 128
    const inference = vi.fn().mockResolvedValue({
      id: 'resp_1',
      content: [{ type: 'text', text: 'ok' }],
      model: 'primary-model',
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    providers.set('primary-model', makeProvider('primary-model', inference))

    await runAuxiliaryTask({
      task: 'sessionSearchSummary',
      operation: 'inference',
      querySource: 'session_search',
      execute: attempt =>
        runAuxiliaryInference(attempt, {
          messages: [{ role: 'user', content: 'summarize' }],
          querySource: 'session_search',
          maxTokens: attempt.policy.maxOutputTokens,
        }),
    })

    expect(inference).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 128,
      }),
    )
  })

  it('maps task attempts to full-query recovery options', async () => {
    policy.maxOutputTokens = 128
    const provider = makeProvider('primary-model', vi.fn())
    const attempt = {
      task: 'sessionSearchSummary',
      policy,
      model: 'primary-model',
      provider,
      routeId: 'sessionSearchSummary',
      chainIndex: 0,
      fallbackModel: 'fallback-model',
      policyGate: {
        allowActions: policy.allowActions,
        switchModelOn: policy.switchModelOn,
      },
    } as const

    expect(
      auxiliaryAttemptQueryOptions(attempt, 'session_search'),
    ).toMatchObject({
      model: 'primary-model',
      fallbackModel: 'fallback-model',
      recoveryRouteId: 'sessionSearchSummary',
      recoveryFromModel: 'primary-model',
      recoveryChainIndex: 0,
      recoveryAuxiliaryTask: 'sessionSearchSummary',
      recoveryMaxRetries: 1,
      recoveryTimeoutMs: 30_000,
      recoveryPolicyGate: {
        allowActions: policy.allowActions,
        switchModelOn: policy.switchModelOn,
      },
    })
  })

  it('applies return_null when the fallback chain is exhausted', async () => {
    for (const model of ['primary-model', 'fallback-model', 'final-model']) {
      providers.set(
        model,
        makeProvider(
          model,
          vi.fn().mockRejectedValue(
            new LLMAPIError('model not found', { status: 404 }),
          ),
        ),
      )
    }

    const result = await runAuxiliaryTask({
      task: 'sessionSearchSummary',
      operation: 'inference',
      querySource: 'session_search',
      execute: attempt =>
        runAuxiliaryInference(attempt, {
          messages: [{ role: 'user', content: 'summarize' }],
          querySource: 'session_search',
        }),
    })

    expect(result).toBeNull()
  })

  it.each([
    ['return_null', null],
    ['fail_open', null],
    ['return_empty', ''],
  ] satisfies Array<[AuxiliaryFailureDisposition, string | null]>)(
    'applies built-in %s disposition after route-chain exhaustion',
    async (disposition, expected) => {
      const finalError = new Error('final model failed')
      policy.failure = disposition
      const attempts: string[] = []

      const result = await runAuxiliaryTask<string | null>({
        task: 'sessionSearchSummary',
        operation: 'inference',
        querySource: 'session_search',
        execute: attempt => {
          attempts.push(attempt.model)
          throw attempt.fallbackModel
            ? new FallbackTriggeredError(attempt.model, attempt.fallbackModel)
            : finalError
        },
      })

      expect(attempts).toEqual([
        'primary-model',
        'fallback-model',
        'final-model',
      ])
      expect(result).toBe(expected)
    },
  )

  it.each([
    ['fail_closed'],
    ['return_original'],
    ['propagate_error'],
  ] satisfies Array<[AuxiliaryFailureDisposition]>)(
    'throws the final error for built-in %s disposition without caller recovery',
    async disposition => {
      const finalError = new Error(`final ${disposition}`)
      policy.failure = disposition

      await expect(
        runAuxiliaryTask({
          task: 'sessionSearchSummary',
          operation: 'inference',
          querySource: 'session_search',
          execute: attempt => {
            throw attempt.fallbackModel
              ? new FallbackTriggeredError(attempt.model, attempt.fallbackModel)
              : finalError
          },
        }),
      ).rejects.toBe(finalError)
    },
  )

  it.each([
    ['return_null', null],
    ['fail_open', null],
    ['return_empty', true],
    ['return_original', true],
  ] satisfies Array<[AuxiliaryFailureDisposition, boolean | null]>)(
    'maps %s to assistant-message failure disposition',
    (disposition, expectsMessage) => {
      const result = auxiliaryFailureAssistantMessage({
        task: 'sessionSearchSummary',
        policy,
        disposition,
        error: new Error('failed'),
      })

      if (!expectsMessage) {
        expect(result).toBeNull()
        return
      }
      expect(result).toMatchObject({
        type: 'assistant',
        isApiErrorMessage: true,
      })
    },
  )

  it.each([
    ['fail_closed'],
    ['propagate_error'],
  ] satisfies Array<[AuxiliaryFailureDisposition]>)(
    'throws through assistant-message %s disposition',
    disposition => {
      const error = new Error(`assistant ${disposition}`)
      expect(() =>
        auxiliaryFailureAssistantMessage({
          task: 'sessionSearchSummary',
          policy,
          disposition,
          error,
        }),
      ).toThrow(error)
    },
  )

  it('lets callers define return_original and fail_open semantics through onFailure', async () => {
    policy.failure = 'return_original'
    const result = await runAuxiliaryTask<string>({
      task: 'sessionSearchSummary',
      operation: 'inference',
      querySource: 'session_search',
      execute: attempt => {
        throw attempt.fallbackModel
          ? new FallbackTriggeredError(attempt.model, attempt.fallbackModel)
          : new Error('final failed')
      },
      onFailure: ({ disposition, error }) => {
        expect(disposition).toBe('return_original')
        expect(error).toBeInstanceOf(Error)
        return 'original-content'
      },
    })

    expect(result).toBe('original-content')
  })

  it('emits task and route metadata on fallback traces', async () => {
    const traces: unknown[] = []
    providers.set(
      'primary-model',
      makeProvider(
        'primary-model',
        vi.fn().mockRejectedValue(
          new LLMAPIError('model not found', { status: 404 }),
        ),
      ),
    )
    providers.set(
      'fallback-model',
      makeProvider(
        'fallback-model',
        vi.fn().mockResolvedValue({
          id: 'resp_fallback',
          content: [{ type: 'text', text: 'ok' }],
          model: 'fallback-model',
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      ),
    )

    await runAuxiliaryTask({
      task: 'sessionSearchSummary',
      operation: 'inference',
      querySource: 'session_search',
      sink: event => traces.push(event),
      execute: attempt =>
        runAuxiliaryInference(
          attempt,
          {
            messages: [{ role: 'user', content: 'summarize' }],
            querySource: 'session_search',
          },
          {
            operation: 'inference',
            querySource: 'session_search',
            sink: event => traces.push(event),
          },
        ),
    })

    expect(traces[0]).toMatchObject({
      auxiliaryTask: 'sessionSearchSummary',
      routeId: 'sessionSearchSummary',
      fromModel: 'primary-model',
      toModel: 'fallback-model',
      chainIndex: 0,
      action: 'fallback_model',
      outcome: 'fallback_triggered',
      policyGate: {
        actionAllowed: true,
        reasonAllowed: true,
      },
    })
  })
})
