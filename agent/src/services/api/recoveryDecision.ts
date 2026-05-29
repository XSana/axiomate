import { resolveRecoveryAction } from './recoveryAction.js'
import { intentForAction } from './recoveryIntent.js'
import {
  buildOuterPolicyDecision,
  parseMaxTokensContextOverflowError,
  resolveRecoveryRuleDecision,
  type RecoveryDecisionContext,
} from './recoveryRules.js'
import type {
  RecoveryDecision,
  RecoveryObservation,
} from './recoverySession.js'

const MAX_OVERLOADED_RETRIES = 3

export type { RecoveryDecisionContext }
export { parseMaxTokensContextOverflowError }

export function decideRecovery(
  observation: RecoveryObservation,
  context: RecoveryDecisionContext,
): RecoveryDecision {
  const classified = observation.classified

  if (classified.reason === 'abort') {
    return buildOuterPolicyDecision(
      observation,
      'abort_requested',
      'abort',
      'aborted',
      'abort',
    )
  }

  if (classified.reason === 'overloaded') {
    if (!context.foregroundSource) {
      return buildOuterPolicyDecision(
        observation,
        'fail_unrecoverable',
        'fail_fast',
        'failing',
        'fail',
      )
    }

    if (observation.consecutiveSameReason >= MAX_OVERLOADED_RETRIES) {
      if (context.canFallback) {
        return buildOuterPolicyDecision(
          observation,
          'switch_to_fallback_model',
          'fallback_model',
          'fallback_triggered',
          'fallback_model',
        )
      }
      return buildOuterPolicyDecision(
        observation,
        'fail_recovery_exhausted',
        'fail_fast',
        'failing',
        'fail',
        {
          failureCause: 'repeated_overloaded',
        },
      )
    }
  }

  if (
    context.deferGeneric404StreamFallback &&
    classified.reason === 'unknown' &&
    observation.statusCode === 404
  ) {
    return buildOuterPolicyDecision(
      observation,
      'switch_to_non_streaming',
      'non_streaming_fallback',
      'delegated',
      'delegate',
    )
  }

  if (context.recoveryBudgetExhausted) {
    if (shouldSwitchModelAfterRetryExhaustion(observation, context)) {
      return buildOuterPolicyDecision(
        observation,
        'switch_to_fallback_model',
        'fallback_model',
        'fallback_triggered',
        'fallback_model',
      )
    }
    return buildOuterPolicyDecision(
      observation,
      'fail_recovery_exhausted',
      'fail_fast',
      'failing',
      'fail',
    )
  }

  const ruleDecision = resolveRecoveryRuleDecision(observation, context)
  if (ruleDecision) {
    return ruleDecision
  }

  if (classified.shouldCompress) {
    return buildOuterPolicyDecision(
      observation,
      'delegate_conversation_compaction',
      'request_compaction',
      'delegated',
      'delegate',
    )
  }

  if (!classified.retryable && classified.shouldFallback && context.canFallback) {
    return buildOuterPolicyDecision(
      observation,
      'switch_to_fallback_model',
      'fallback_model',
      'fallback_triggered',
      'fallback_model',
    )
  }

  if (!classified.retryable) {
    return buildOuterPolicyDecision(
      observation,
      'fail_unrecoverable',
      'fail_fast',
      'failing',
      'fail',
    )
  }

  const delayMs = context.delayMsForRetryable()
  const action = resolveRecoveryAction(classified, {
    canFallback: context.canFallback,
    recoveryBudgetExhausted: context.recoveryBudgetExhausted,
    willRefreshClient: context.willRefreshClient,
  })
  return buildOuterPolicyDecision(
    observation,
    intentForAction(action, classified),
    action,
    'retrying',
    'retry',
    { delayMs },
  )
}

function shouldSwitchModelAfterRetryExhaustion(
  observation: RecoveryObservation,
  context: RecoveryDecisionContext,
): boolean {
  if (!context.canFallback) {
    return false
  }

  const classified = observation.classified
  return classified.shouldFallback || classified.retryable
}
