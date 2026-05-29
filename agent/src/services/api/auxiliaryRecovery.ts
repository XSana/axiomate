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
  getRecoveryDelay,
  type RetryContext,
} from './withRetry.js'

const FOREGROUND_AUXILIARY_SOURCES = new Set<string>([
  'side_question',
  'permission_explainer',
  'verification_agent',
])

const VALIDATION_AUXILIARY_SOURCES = new Set<string>(['model_validation'])

const QUALITY_AUXILIARY_PROFILES = new Set<string>([
  'auxiliary-quality',
  'auxiliary-judge',
  'auxiliary-vision',
])

const FAST_AUXILIARY_PROFILES = new Set<string>(['auxiliary-fast'])

const VALIDATION_AUXILIARY_TASKS = new Set<string>(['verifyConnection'])

export interface AuxiliaryRecoveryOptions {
  provider: Pick<LLMProvider, 'name' | 'wrapError'>
  model: string
  operation: RecoveryTraceOperation
  querySource?: QuerySource | string
  signal?: AbortSignal
  sink?: RecoveryTraceSink
  fallbackModel?: string
  routeId?: string
  auxiliaryTask?: string
  chainIndex?: number
  recoveryProfile?: string
  policyGate?: {
    allowActions?: string[]
    switchModelOn?: string[]
    actionAllowed?: boolean
    reasonAllowed?: boolean
  }
}

export type AuxiliaryRecoveryBudget = {
  maxRecoveryRetries: number
  foregroundSource: boolean
  reason:
    | 'background-direct'
    | 'foreground-side-query'
    | 'validation'
    | 'task-fast'
    | 'task-quality'
    | 'task-default'
}

export async function withAuxiliaryRecovery<T>(
  options: AuxiliaryRecoveryOptions,
  operation: (attempt: number, context: RetryContext) => Promise<T>,
): Promise<T> {
  const budget = resolveAuxiliaryRecoveryBudget(options)
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

  for (
    let attempt = 1;
    attempt <= budget.maxRecoveryRetries + 1;
    attempt++
  ) {
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
        maxAttempts: budget.maxRecoveryRetries + 1,
        model: retryContext.model,
        classified,
      })
      const decision = decideRecovery(observation, {
        canFallback: switchModelAvailable,
        foregroundSource: budget.foregroundSource,
        recoveryBudgetExhausted: attempt > budget.maxRecoveryRetries,
        deferGeneric404StreamFallback: false,
        willRefreshClient: false,
        retryContext,
        history: session.history,
        error: wrapped,
        delayMsForRetryable: () => getRecoveryDelay(attempt, classified),
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

function canFallbackToModel(options: AuxiliaryRecoveryOptions): options is
  AuxiliaryRecoveryOptions & { fallbackModel: string } {
  return !!options.fallbackModel && options.fallbackModel !== options.model
}

function isSwitchModelAllowedByPolicy(
  classified: ReturnType<typeof classifyError>,
  options: AuxiliaryRecoveryOptions,
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

export function resolveAuxiliaryRecoveryBudget(
  options: Pick<
    AuxiliaryRecoveryOptions,
    'querySource' | 'auxiliaryTask' | 'recoveryProfile'
  >,
): AuxiliaryRecoveryBudget {
  if (
    (options.querySource !== undefined &&
      VALIDATION_AUXILIARY_SOURCES.has(options.querySource)) ||
    (options.auxiliaryTask !== undefined &&
      VALIDATION_AUXILIARY_TASKS.has(options.auxiliaryTask))
  ) {
    return {
      maxRecoveryRetries: 1,
      foregroundSource: true,
      reason: 'validation',
    }
  }

  if (options.auxiliaryTask !== undefined) {
    if (
      options.recoveryProfile !== undefined &&
      QUALITY_AUXILIARY_PROFILES.has(options.recoveryProfile)
    ) {
      return {
        maxRecoveryRetries: 2,
        foregroundSource: true,
        reason: 'task-quality',
      }
    }
    if (
      options.recoveryProfile !== undefined &&
      FAST_AUXILIARY_PROFILES.has(options.recoveryProfile)
    ) {
      return {
        maxRecoveryRetries: 1,
        foregroundSource: true,
        reason: 'task-fast',
      }
    }
    return {
      maxRecoveryRetries: 1,
      foregroundSource: true,
      reason: 'task-default',
    }
  }

  if (
    options.querySource !== undefined &&
    FOREGROUND_AUXILIARY_SOURCES.has(options.querySource)
  ) {
    return {
      maxRecoveryRetries: 2,
      foregroundSource: true,
      reason: 'foreground-side-query',
    }
  }

  return {
    maxRecoveryRetries: 0,
    foregroundSource: false,
    reason: 'background-direct',
  }
}

function formatAuxiliaryRecoveryCause(error: unknown): string | undefined {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 240)
  }
  if (typeof error === 'string') {
    return error.slice(0, 240)
  }
  return undefined
}

function emitAuxiliaryDecisionTrace(input: {
  options: AuxiliaryRecoveryOptions
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
    traceId: `api-${input.options.operation}-aux-recovery-${input.observation.id}-${input.decision.id ?? 'pending'}`,
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
    innerCause: formatAuxiliaryRecoveryCause(input.error),
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
