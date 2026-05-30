import { describe, expect, it } from 'vitest'

import { emitAuxiliaryRecoveryTrace } from '../../../../../services/api/auxiliaryRecoveryTrace.js'
import type { LLMProvider } from '../../../../../services/api/provider.js'
import type { RecoveryTraceEvent } from '../../../../../services/api/recoveryTrace.js'
import { LLMAPIError } from '../../../../../services/api/streamTypes.js'
import { readFixture } from './fixtureUtils.js'

function makeProvider(name: LLMProvider['name']): Pick<LLMProvider, 'name' | 'wrapError'> {
  return {
    name,
    wrapError(error: unknown): LLMAPIError {
      if (error instanceof LLMAPIError) return error
      return new LLMAPIError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
      )
    },
  }
}

function projectTrace(event: RecoveryTraceEvent) {
  return {
    protocol: event.protocol,
    model: event.model,
    reason: event.reason,
    intent: event.intent,
    action: event.action,
    outcome: event.outcome,
    repeatPolicy: event.repeatPolicy,
    operation: event.operation,
    querySource: event.querySource,
    statusCode: event.statusCode,
    retryable: event.retryable,
    shouldCompress: event.shouldCompress,
    shouldFallback: event.shouldFallback,
    ...(event.timeoutKind ? { timeoutKind: event.timeoutKind } : {}),
    ...(event.timeoutMs !== undefined ? { timeoutMs: event.timeoutMs } : {}),
    ...(event.requestId ? { requestId: event.requestId } : {}),
    innerCause: event.innerCause,
    ...(event.safeHeaders ? { safeHeaders: event.safeHeaders } : {}),
    recommendedIntent: event.recommendedIntent,
    recommendedAction: event.recommendedAction,
    final: event.final,
  }
}

describe('auxiliary API recovery trace contract', () => {
  it('emits stable classification traces without retry amplification', () => {
    const traces: RecoveryTraceEvent[] = []

    emitAuxiliaryRecoveryTrace({
      provider: makeProvider('openai-chat'),
      model: 'gpt-4o',
      operation: 'side_query',
      querySource: 'side_question',
      error: new LLMAPIError('side query rate limited', {
        status: 429,
        headers: {
          'retry-after': '2',
          'x-request-id': 'req_side_1',
          authorization: 'secret',
        },
        request_id: 'req_side_1',
      }),
      sink: event => traces.push(event),
    })

    emitAuxiliaryRecoveryTrace({
      provider: makeProvider('openai-responses'),
      model: 'gpt-4o',
      operation: 'inference',
      querySource: 'session_search',
      error: new LLMAPIError('Responses API returned empty content', {
        status: 502,
      }),
      sink: event => traces.push(event),
    })

    emitAuxiliaryRecoveryTrace({
      provider: makeProvider('anthropic'),
      model: 'anthropic-main-model',
      operation: 'count_tokens',
      querySource: 'count_tokens',
      error: new LLMAPIError('input length and `max_tokens` exceed context limit', {
        status: 400,
      }),
      sink: event => traces.push(event),
    })

    expect(traces.map(projectTrace)).toEqual(
      readFixture('api-recovery/auxiliary-traces.json'),
    )
  })
})
