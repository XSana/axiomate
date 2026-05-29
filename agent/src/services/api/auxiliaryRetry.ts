import type { QuerySource } from '../../constants/querySource.js'
import type { ModelSwitchReason } from '../../utils/config.js'
import { sleep } from '../../utils/sleep.js'
import {
  resolveApiTimeoutPolicy,
  withApiTimeout,
} from './apiTimeoutPolicy.js'
import { classifyError } from './errorClassifier.js'
import type { LLMProvider } from './provider.js'
import { decideRecovery } from './recoveryDecision.js'
import { resolveRecoveryAction } from './recoveryAction.js'
import { intentForAction } from './recoveryIntent.js'
import {
  emitRecoveryTrace,
  type RecoveryTraceOperation,
  type RecoveryTraceSink,
} from './recoveryTrace.js'
import {
  RecoverySession,
  normalizeRecoveryProtocol,
  type RecoveryDecision,
  type RecoveryObservation,
  type RecoveryProtocol,
} from './recoverySession.js'
import { safeRecoveryTraceHeaders } from './recoveryTraceHeaders.js'
import { LLMAbortError } from './streamTypes.js'
import {
  FallbackTriggeredError,
  getRetryDelay,
  type RetryContext,
} from './withRetry.js'

const FOREGROUND_AUXILIARY_SOURCES = new Set<string>([
  'side_question',
  'model_validation',
  'permission_explainer',
  'verification_agent',
])

export interface AuxiliaryRetryOptions {
  provider: Pick<LLMProvider, 'name' | 'wrapError'>
  model: string
  operation: RecoveryTraceOperation
  querySource?: QuerySource | string
  signal?: AbortSignal
  sink?: RecoveryTraceSink
  maxRetries?: number
  fallbackModel?: string
  routeId?: string
  auxiliaryTask?: string
  chainIndex?: number
  policyGate?: {
    allowActions?: string[]
    switchModelOn?: string[]
    actionAllowed?: boolean
    reasonAllowed?: boolean
  }
}

export async function withAuxiliaryRetry<T>(
  options: AuxiliaryRetryOptions,
  operation: (attempt: number, context: RetryContext) => Promise<T>,
): Promise<T> {
  const maxRetries = shouldRetryAuxiliary(options)
    ? options.maxRetries ?? 1
    : 0
  const protocol = normalizeRecoveryProtocol(options.provider.name)
  const session = new RecoverySession({ protocol })
  const retryContext: RetryContext = {
    model: options.model,
    thinkingConfig: { type: 'enabled', budgetTokens: 1024 },
  }
  const timeoutPolicy = resolveApiTimeoutPolicy({
    protocol,
    operation: options.operation,
    querySource: options.querySource,
  })
  let lastError: unknown

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    if (options.signal?.aborted) {
      throw new LLMAbortError()
    }

    try {
      return await withApiTimeout(timeoutPolicy, options.signal, signal =>
        operation(attempt, { ...retryContext, signal }),
      )
    } catch (error) {
      lastError = error
      const wrapped = options.provider.wrapError(error)
      const classified = classifyError(wrapped, {
        provider: protocol,
        model: options.model,
      })
      const switchModelAvailable =
        canFallbackToModel(options) &&
        isSwitchModelAllowedByPolicy(classified, options)
      const observation = session.observeFailure({
        attempt,
        maxAttempts: maxRetries + 1,
        model: retryContext.model,
        classified,
      })
      const decision = decideRecovery(observation, {
        canFallback: switchModelAvailable,
        foregroundSource: shouldRetryAuxiliary(options),
        maxRetriesExhausted: attempt > maxRetries,
        deferGeneric404StreamFallback: false,
        willRefreshClient: false,
        retryContext,
        history: session.history,
        error: wrapped,
        delayMsForRetryable: () =>
          classified.retryAfterMs ?? getRetryDelay(attempt),
      })
      const previousDecision = session.history.previousDecision
      const recordedDecision = session.recordDecision(decision)

      emitAuxiliaryDecisionTrace({
        options,
        protocol,
        observation,
        decision: recordedDecision,
        previousDecision,
        error,
        wrapped,
      })

      if (recordedDecision.contextPatch) {
        Object.assign(retryContext, recordedDecision.contextPatch)
      }

      switch (recordedDecision.disposition) {
        case 'abort':
        case 'throw_original':
          throw wrapped
        case 'fallback_model':
          throw new FallbackTriggeredError(
            options.model,
            options.fallbackModel!,
          )
        case 'delegate':
        case 'fail':
          throw wrapped
        case 'retry':
          break
      }

      if (recordedDecision.delayMs !== undefined) {
        await sleep(recordedDecision.delayMs, options.signal, {
          abortError: () => new LLMAbortError(),
        })
      }
    }
  }

  throw options.provider.wrapError(lastError)
}

function canFallbackToModel(options: AuxiliaryRetryOptions): options is
  AuxiliaryRetryOptions & { fallbackModel: string } {
  return !!options.fallbackModel && options.fallbackModel !== options.model
}

function isSwitchModelAllowedByPolicy(
  classified: ReturnType<typeof classifyError>,
  options: AuxiliaryRetryOptions,
): boolean {
  const gate = options.policyGate
  if (!gate) {
    return true
  }
  const actionAllowed =
    gate.actionAllowed ??
    gate.allowActions?.includes('switch_model') ??
    true
  const reasonAllowed =
    gate.reasonAllowed ??
    gate.switchModelOn?.includes(classified.reason as ModelSwitchReason) ??
    true
  gate.actionAllowed = actionAllowed
  gate.reasonAllowed = reasonAllowed
  return actionAllowed && reasonAllowed
}

export function shouldRetryAuxiliary(
  options: Pick<AuxiliaryRetryOptions, 'querySource' | 'auxiliaryTask'>,
): boolean {
  return (
    options.querySource !== undefined &&
    FOREGROUND_AUXILIARY_SOURCES.has(options.querySource)
  ) || options.auxiliaryTask !== undefined
}

function formatAuxiliaryRetryCause(error: unknown): string | undefined {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 240)
  }
  if (typeof error === 'string') {
    return error.slice(0, 240)
  }
  return undefined
}

function emitAuxiliaryDecisionTrace(input: {
  options: AuxiliaryRetryOptions
  protocol: RecoveryProtocol
  observation: RecoveryObservation
  decision: RecoveryDecision
  previousDecision: RecoveryDecision | undefined
  error: unknown
  wrapped: ReturnType<LLMProvider['wrapError']>
}): void {
  const recommendedAction = resolveRecoveryAction(input.observation.classified, {
    canFallback:
      canFallbackToModel(input.options) &&
      isSwitchModelAllowedByPolicy(
        input.observation.classified,
        input.options,
      ),
  })
  const recommendedIntent = intentForAction(
    recommendedAction,
    input.observation.classified,
  )
  const timeoutPolicy =
    input.observation.reason === 'timeout'
      ? resolveApiTimeoutPolicy({
          protocol: input.protocol,
          operation: input.options.operation,
          querySource: input.options.querySource,
        })
      : undefined

  emitRecoveryTrace(input.options.sink, {
    traceId: `api-${input.options.operation}-aux-retry-${input.observation.id}-${input.decision.id ?? 'pending'}`,
    protocol: input.protocol,
    model: input.observation.model,
    attempt: input.observation.attempt,
    maxAttempts: input.observation.maxAttempts,
    reason: input.observation.reason,
    intent: input.decision.intent,
    action: input.decision.action,
    outcome: input.decision.outcome,
    ruleId: input.decision.ruleId,
    repeatPolicy: input.decision.repeatPolicy,
    statusCode: input.observation.statusCode,
    retryable: input.observation.retryable,
    shouldCompress: input.observation.shouldCompress,
    shouldFallback: input.observation.shouldFallback,
    delayMs: input.decision.delayMs,
    mutation: input.decision.mutation,
    timeoutKind: timeoutPolicy?.timeoutKind,
    timeoutMs: timeoutPolicy?.timeoutMs,
    requestId: input.wrapped.request_id,
    innerCause: formatAuxiliaryRetryCause(input.error),
    safeHeaders: safeRecoveryTraceHeaders(input.wrapped.headers),
    operation: input.options.operation,
    querySource: input.options.querySource,
    routeId: input.options.routeId,
    fromModel: input.options.model,
    toModel: input.options.fallbackModel,
    chainIndex: input.options.chainIndex,
    policyGate: input.options.policyGate,
    auxiliaryTask: input.options.auxiliaryTask,
    recommendedIntent,
    recommendedAction,
    observationId: input.observation.id,
    decisionId: input.decision.id,
    previousReason: input.observation.previousReason,
    previousIntent: input.previousDecision?.intent,
    previousAction: input.previousDecision?.action,
    isFirstFailure: input.observation.isFirstFailure,
    isFirstFailureForReason: input.observation.isFirstFailureForReason,
    consecutiveSameReason: input.observation.consecutiveSameReason,
    final: input.decision.disposition !== 'retry',
  })
}
