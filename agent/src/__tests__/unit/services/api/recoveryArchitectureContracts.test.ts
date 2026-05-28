import { describe, expect, it } from 'vitest'

import type { ClassifiedError } from '../../../../services/api/errorClassifier.js'
import {
  RECOVERY_RULES,
  validateRecoveryRuleCatalog,
} from '../../../../services/api/recoveryRules.js'
import { RecoverySession } from '../../../../services/api/recoverySession.js'

function classified(
  reason: ClassifiedError['reason'],
  overrides: Partial<ClassifiedError> = {},
): ClassifiedError {
  return {
    reason,
    statusCode: undefined,
    message: reason,
    retryable: true,
    shouldCompress: false,
    shouldFallback: false,
    retryAfterMs: undefined,
    ...overrides,
  }
}

describe('API recovery architecture contracts', () => {
  it('normalizes unknown protocols without treating axiomate as a wildcard', () => {
    const session = new RecoverySession({ protocol: 'axiomate' })
    const observation = session.observeFailure({
      attempt: 1,
      maxAttempts: 2,
      model: 'provider-main-model',
      classified: classified('server_error'),
    })

    expect(observation.protocol).toBe('axiomate-generic')
  })

  it('records observation and decision history for later decisions', () => {
    const session = new RecoverySession({ protocol: 'openai-chat' })
    const first = session.observeFailure({
      attempt: 1,
      maxAttempts: 3,
      model: 'provider-main-model',
      classified: classified('unsupported_parameter'),
    })
    const recordedFirst = session.recordDecision({
      observationId: first.id,
      ruleId: 'omit-unsupported-request-fields',
      repeatPolicy: 'repeatable',
      intent: 'omit_unsupported_request_fields',
      action: 'omit_request_fields',
      outcome: 'retrying',
      disposition: 'retry',
    })

    const second = session.observeFailure({
      attempt: 2,
      maxAttempts: 3,
      model: 'provider-main-model',
      classified: classified('server_error', { statusCode: 502 }),
    })

    expect(recordedFirst.id).toBe(1)
    expect(second.previousReason).toBe('unsupported_parameter')
    expect(session.history.previousDecision).toMatchObject({
      id: 1,
      action: 'omit_request_fields',
    })
    expect(session.history.countReason('unsupported_parameter')).toBe(1)
    expect(session.history.countAction('omit_request_fields')).toBe(1)
    expect(
      session.history.lastDecisionForReason('unsupported_parameter'),
    ).toMatchObject({ id: 1 })
  })

  it('requires semantic rule metadata for every recovery rule', () => {
    expect(() => validateRecoveryRuleCatalog()).not.toThrow()
    for (const rule of RECOVERY_RULES) {
      expect(rule.id).toMatch(/^[a-z0-9-]+$/)
      expect(rule.reasons.length).toBeGreaterThan(0)
      expect(rule.actions.length).toBeGreaterThan(0)
      expect(rule.intent).toBeTruthy()
      expect(rule.repeatPolicy).toBeTruthy()
      expect(rule.protocols).toBeTruthy()
    }
  })
})
