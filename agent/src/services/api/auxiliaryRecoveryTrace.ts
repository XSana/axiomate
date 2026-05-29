import { classifyError } from './errorClassifier.js'
import { resolveApiTimeoutPolicy } from './apiTimeoutPolicy.js'
import type { LLMProvider } from './provider.js'
import { resolveRecoveryAction } from './recoveryAction.js'
import { intentForAction } from './recoveryIntent.js'
import {
  emitRecoveryTrace,
  type RecoveryTraceOperation,
  type RecoveryTraceSink,
} from './recoveryTrace.js'
import {
  normalizeRecoveryProtocol,
  type RecoveryProtocol,
} from './recoverySession.js'
import { safeRecoveryTraceHeaders } from './recoveryTraceHeaders.js'

export interface AuxiliaryRecoveryTraceInput {
  provider: Pick<LLMProvider, 'name' | 'wrapError'>
  model: string
  operation: RecoveryTraceOperation
  error: unknown
  sink?: RecoveryTraceSink
  querySource?: string
  requestId?: string
}

export function emitAuxiliaryRecoveryTrace(
  input: AuxiliaryRecoveryTraceInput,
): void {
  const wrappedError = input.provider.wrapError(input.error)
  const protocol = normalizeRecoveryProtocol(input.provider.name)
  const classified = classifyError(wrappedError, {
    provider: protocol,
    model: input.model,
  })
  const recommendedAction = resolveRecoveryAction(classified, {
    canFallback: false,
  })
  const recommendedIntent = intentForAction(recommendedAction, classified)
  const action = classified.reason === 'abort' ? 'abort' : 'fail_fast'
  const intent =
    classified.reason === 'abort' ? 'abort_requested' : 'fail_unrecoverable'
  const outcome = classified.reason === 'abort' ? 'aborted' : 'failing'
  const timeoutPolicy =
    classified.reason === 'timeout'
      ? resolveApiTimeoutPolicy({
          protocol,
          operation: input.operation,
          querySource: input.querySource,
        })
      : undefined

  emitRecoveryTrace(input.sink, {
    traceId: `api-${input.operation}-failure`,
    protocol: protocol as RecoveryProtocol,
    model: input.model,
    attempt: 1,
    maxAttempts: 1,
    reason: classified.reason,
    intent,
    action,
    outcome,
    repeatPolicy: 'outer_policy',
    statusCode: classified.statusCode,
    retryable: classified.retryable,
    shouldCompress: classified.shouldCompress,
    shouldFallback: classified.shouldFallback,
    timeoutKind: timeoutPolicy?.timeoutKind,
    timeoutMs: timeoutPolicy?.timeoutMs,
    requestId: input.requestId ?? wrappedError.request_id,
    innerCause: formatAuxiliaryTraceCause(input.error),
    safeHeaders: safeRecoveryTraceHeaders(wrappedError.headers),
    operation: input.operation,
    querySource: input.querySource,
    recommendedIntent,
    recommendedAction,
    final: true,
  })
}

function formatAuxiliaryTraceCause(error: unknown): string | undefined {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 240)
  }
  if (typeof error === 'string') {
    return error.slice(0, 240)
  }
  return undefined
}
