import { describe, expect, it } from 'vitest'

import {
  CannotRetryError,
  FallbackTriggeredError,
  withRetry,
} from '../../../../../services/api/withRetry.js'
import { LLMAPIError } from '../../../../../services/api/streamTypes.js'
import type { RecoveryTraceEvent } from '../../../../../services/api/recoveryTrace.js'
import { readFixture } from './fixtureUtils.js'

async function consume<T>(gen: AsyncGenerator<unknown, T>): Promise<T> {
  for (;;) {
    const next = await gen.next()
    if (next.done) return next.value
  }
}

function projectTrace(event: RecoveryTraceEvent) {
  return {
    observationId: event.observationId,
    decisionId: event.decisionId,
    protocol: event.protocol,
    reason: event.reason,
    intent: event.intent,
    action: event.action,
    outcome: event.outcome,
    repeatPolicy: event.repeatPolicy,
    ...(event.ruleId ? { ruleId: event.ruleId } : {}),
    ...(event.mutation ? { mutation: event.mutation } : {}),
    ...(event.timeoutKind ? { timeoutKind: event.timeoutKind } : {}),
    ...(event.timeoutMs !== undefined ? { timeoutMs: event.timeoutMs } : {}),
    ...(event.imageRecoveryProfile
      ? { imageRecoveryProfile: event.imageRecoveryProfile }
      : {}),
    final: event.final,
  }
}

describe('API retry trace golden fixtures', () => {
  it('emits stable trace events for fallback and delegated recovery', async () => {
    const traces: RecoveryTraceEvent[] = []

    await expect(
      consume(
        withRetry(
          async () => ({}),
          async () => {
            throw new LLMAPIError('model not found', { status: 404 })
          },
          {
            protocol: 'openai-chat',
            model: 'gpt-4o',
            fallbackModel: 'gpt-4o-mini',
            thinkingConfig: { type: 'disabled' },
            maxRetries: 0,
            onRecoveryTrace: event => traces.push(event),
          },
        ),
      ),
    ).rejects.toBeInstanceOf(FallbackTriggeredError)

    await expect(
      consume(
        withRetry(
          async () => ({}),
          async () => {
            throw new LLMAPIError(
              'Rate limited: extra usage tier required for long context requests',
              { status: 429 },
            )
          },
          {
            protocol: 'anthropic',
            model: 'anthropic-main-model',
            thinkingConfig: { type: 'disabled' },
            maxRetries: 10,
            onRecoveryTrace: event => traces.push(event),
          },
        ),
      ),
    ).rejects.toBeInstanceOf(CannotRetryError)

    await expect(
      consume(
        withRetry(
          async () => ({}),
          async () => {
            throw new LLMAPIError('image exceeds 5 MB maximum', {
              status: 400,
            })
          },
          {
            protocol: 'anthropic',
            model: 'anthropic-main-model',
            thinkingConfig: { type: 'disabled' },
            maxRetries: 10,
            onRecoveryTrace: event => traces.push(event),
          },
        ),
      ),
    ).rejects.toBeInstanceOf(CannotRetryError)

    expect(traces.map(projectTrace)).toEqual(
      readFixture('api-recovery/retry-traces.fallback-delegated.json'),
    )
  })
})
