import { describe, expect, it } from 'vitest'

import { emitBoundaryRecoveryDecisionTrace } from '../../../../services/api/boundaryRecovery.js'
import type { RecoveryTraceEvent } from '../../../../services/api/recoveryTrace.js'
import { LLMAPIError } from '../../../../services/api/streamTypes.js'

describe('emitBoundaryRecoveryDecisionTrace', () => {
  it('uses structured fallback availability when recommending boundary recovery', () => {
    const traces: RecoveryTraceEvent[] = []

    emitBoundaryRecoveryDecisionTrace({
      traceId: 'boundary-1',
      sink: event => traces.push(event),
      protocol: 'openai-chat',
      model: 'provider-main-model',
      attempt: 1,
      maxAttempts: 1,
      error: new LLMAPIError('model not found', { status: 404 }),
      operation: 'verify_connection',
      recoveryBudgetExhausted: true,
      fallbackAvailability: {
        available: false,
        currentModel: 'provider-main-model',
        candidateModel: 'provider-fallback-model',
        deniedBy: 'reason_policy',
        policySnapshot: {
          allowActions: ['retry_same_model', 'switch_model'],
          switchModelOn: ['rate_limit'],
          actionAllowed: true,
          reasonAllowed: false,
        },
      },
      final: true,
    })

    expect(traces[0]).toMatchObject({
      reason: 'model_not_found',
      action: 'fail_fast',
      recommendedAction: 'fail_fast',
      outcome: 'failing',
      policyGate: {
        actionAllowed: true,
        reasonAllowed: false,
      },
      final: true,
    })
  })
})
