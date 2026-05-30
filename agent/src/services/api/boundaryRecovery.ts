import { resolveApiTimeoutPolicy } from './apiTimeoutPolicy.js'
import { classifyError } from './errorClassifier.js'
import type { RecoveryDecisionContext } from './recoveryDecision.js'
import { decideRecovery } from './recoveryDecision.js'
import {
  recoveryTracePolicyGateFromAvailability,
  type ModelFallbackAvailability,
} from './recoveryFallback.js'
import { resolveRecoveryAction } from './recoveryAction.js'
import { intentForAction } from './recoveryIntent.js'
import {
  emitRecoveryTrace,
  type RecoveryTraceContext,
  type RecoveryTraceOperation,
  type RecoveryTraceSink,
} from './recoveryTrace.js'
import {
  RecoverySession,
  normalizeRecoveryProtocol,
  type RecoveryDecision,
  type RecoveryProtocol,
} from './recoverySession.js'
import { safeRecoveryTraceHeaders } from './recoveryTraceHeaders.js'
import { LLMAPIError } from './streamTypes.js'

export interface BoundaryRecoveryDecisionTraceInput {
  traceId: string
  sink?: RecoveryTraceSink
  protocol: string
  model: string
  attempt: number
  maxAttempts: number
  error: unknown
  wrappedError?: LLMAPIError
  context?: RecoveryTraceContext
  operation?: RecoveryTraceOperation
  querySource?: string
  requestId?: string
  final?: boolean
  canFallback?: boolean
  fallbackAvailability?: ModelFallbackAvailability
  foregroundSource?: boolean
  recoveryBudgetExhausted?: boolean
  deferGeneric404StreamFallback?: boolean
  canUseNonStreamingFallback?: boolean
  canSalvageCompletedStream?: boolean
  willRefreshClient?: boolean
  delayMsForRetryable?: () => number
  recommendedCanFallback?: boolean
}

export function emitBoundaryRecoveryDecisionTrace(
  input: BoundaryRecoveryDecisionTraceInput,
): RecoveryDecision {
  const protocol = normalizeRecoveryProtocol(input.protocol)
  const wrappedError = input.wrappedError ?? wrapBoundaryError(input.error)
  const classified = classifyError(wrappedError, {
    provider: protocol,
    model: input.model,
  })
  const session = new RecoverySession({ protocol })
  const canSwitchModel =
    input.fallbackAvailability?.available ?? input.canFallback ?? false
  const observation = session.observeFailure({
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    model: input.model,
    classified,
  })
  const decision = session.recordDecision(
    decideRecovery(observation, {
      fallbackAvailability: input.fallbackAvailability,
      canFallback: canSwitchModel,
      foregroundSource: input.foregroundSource ?? true,
      recoveryBudgetExhausted: input.recoveryBudgetExhausted ?? false,
      deferGeneric404StreamFallback:
        input.deferGeneric404StreamFallback ?? false,
      canUseNonStreamingFallback: input.canUseNonStreamingFallback ?? false,
      canSalvageCompletedStream: input.canSalvageCompletedStream ?? false,
      willRefreshClient: input.willRefreshClient ?? false,
      retryContext: {
        thinkingConfig: { type: 'disabled' },
      },
      history: session.history,
      error: wrappedError,
      delayMsForRetryable: input.delayMsForRetryable ?? (() => 0),
    } satisfies RecoveryDecisionContext),
  )
  const timeoutPolicy =
    observation.reason === 'timeout' && input.operation
      ? resolveApiTimeoutPolicy({
          protocol,
          operation: input.operation,
          querySource: input.querySource,
        })
      : undefined
  const recommendedAction = resolveRecoveryAction(classified, {
    canFallback: input.recommendedCanFallback ?? canSwitchModel,
    recoveryBudgetExhausted: input.recoveryBudgetExhausted ?? false,
    willRefreshClient: input.willRefreshClient ?? false,
  })
  const recommendedIntent = intentForAction(recommendedAction, classified)

  emitRecoveryTrace(input.sink, {
    traceId: input.traceId,
    protocol: protocol as RecoveryProtocol,
    model: input.model,
    attempt: observation.attempt,
    maxAttempts: observation.maxAttempts,
    reason: observation.reason,
    intent: decision.intent,
    action: decision.action,
    outcome: decision.outcome,
    ruleId: decision.ruleId,
    repeatPolicy: decision.repeatPolicy,
    statusCode: observation.statusCode,
    retryable: observation.retryable,
    shouldCompress: observation.shouldCompress,
    shouldFallback: observation.shouldFallback,
    delayMs: decision.delayMs,
    mutation: decision.mutation,
    imageRecoveryProfile: decision.contextPatch?.imageRecoveryProfile,
    requestId:
      input.requestId ??
      input.context?.requestId ??
      wrappedError.request_id ??
      (classified as { requestId?: string }).requestId,
    ttfbMs: input.context?.ttfbMs,
    elapsedMs: input.context?.elapsedMs,
    bytesReceived: input.context?.bytesReceived,
    streamPhase: input.context?.streamPhase,
    timeoutKind: input.context?.timeoutKind ?? timeoutPolicy?.timeoutKind,
    timeoutMs: input.context?.timeoutMs ?? timeoutPolicy?.timeoutMs,
    innerCause:
      input.context?.innerCause ?? formatBoundaryRecoveryCause(input.error),
    safeHeaders:
      input.context?.safeHeaders ??
      safeRecoveryTraceHeaders(wrappedError.headers),
    operation: input.operation,
    querySource: input.querySource,
    routeId: input.context?.routeId,
    fromModel: input.context?.fromModel,
    toModel: input.context?.toModel,
    chainIndex: input.context?.chainIndex,
    policyGate:
      recoveryTracePolicyGateFromAvailability(input.fallbackAvailability) ??
      input.context?.policyGate,
    auxiliaryTask: input.context?.auxiliaryTask,
    recommendedIntent,
    recommendedAction,
    observationId: observation.id,
    decisionId: decision.id,
    previousReason: observation.previousReason,
    isFirstFailure: observation.isFirstFailure,
    isFirstFailureForReason: observation.isFirstFailureForReason,
    consecutiveSameReason: observation.consecutiveSameReason,
    final: input.final ?? decision.disposition !== 'retry',
  })

  return decision
}

export function formatBoundaryRecoveryCause(error: unknown): string | undefined {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 240)
  }
  if (typeof error === 'string') {
    return error.slice(0, 240)
  }
  return undefined
}

function wrapBoundaryError(error: unknown): LLMAPIError {
  if (error instanceof LLMAPIError) {
    return error
  }
  return new LLMAPIError(
    error instanceof Error ? error.message : String(error),
    { cause: error },
  )
}
