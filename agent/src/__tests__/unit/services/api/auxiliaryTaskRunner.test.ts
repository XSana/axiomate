import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedAuxiliaryTaskPolicy } from '../../../../utils/model/modelRouting.js'
import type { LLMProvider } from '../../../../services/api/provider.js'
import { LLMAPIError } from '../../../../services/api/streamTypes.js'
import {
  runAuxiliaryInference,
  runAuxiliaryTask,
} from '../../../../services/api/auxiliaryTaskRunner.js'

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
