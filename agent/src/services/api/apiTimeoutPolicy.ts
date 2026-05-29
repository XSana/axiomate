import type { QuerySource } from '../../constants/querySource.js'
import { LLMAbortError, LLMTimeoutError } from './streamTypes.js'
import type {
  RecoveryTraceOperation,
  RecoveryStreamPhase,
} from './recoveryTrace.js'
import type { RecoveryProtocol } from './recoverySession.js'

export type ApiTimeoutKind =
  | 'first_byte_timeout'
  | 'stream_idle_timeout'
  | 'non_streaming_timeout'
  | 'auxiliary_timeout'

export interface ApiTimeoutPolicyInput {
  protocol: RecoveryProtocol
  operation: RecoveryTraceOperation
  querySource?: QuerySource | string
  streamPhase?: RecoveryStreamPhase
  estimatedInputTokens?: number
}

export interface ApiTimeoutPolicy {
  timeoutKind: ApiTimeoutKind
  timeoutMs: number
}

const SHORT_AUXILIARY_TIMEOUT_MS = 30_000
const FOREGROUND_AUXILIARY_TIMEOUT_MS = 60_000
const VALIDATION_TIMEOUT_MS = 45_000
const NON_STREAMING_TIMEOUT_MS = 120_000
const LARGE_NON_STREAMING_TIMEOUT_MS = 180_000
const FIRST_BYTE_TIMEOUT_MS = 45_000
const STREAM_IDLE_TIMEOUT_MS = 90_000

export function resolveApiTimeoutPolicy(
  input: ApiTimeoutPolicyInput,
): ApiTimeoutPolicy {
  if (input.operation === 'stream') {
    if (input.streamPhase === 'first_byte') {
      return {
        timeoutKind: 'first_byte_timeout',
        timeoutMs: FIRST_BYTE_TIMEOUT_MS,
      }
    }
    return {
      timeoutKind: 'stream_idle_timeout',
      timeoutMs: STREAM_IDLE_TIMEOUT_MS,
    }
  }

  if (input.operation === 'non_streaming_fallback') {
    const envTimeoutMs = parseInt(process.env.API_TIMEOUT_MS || '', 10)
    return {
      timeoutKind: 'non_streaming_timeout',
      timeoutMs:
        envTimeoutMs > 0
          ? envTimeoutMs
          : (input.estimatedInputTokens ?? 0) > 50_000
            ? LARGE_NON_STREAMING_TIMEOUT_MS
            : NON_STREAMING_TIMEOUT_MS,
    }
  }

  return {
    timeoutKind: 'auxiliary_timeout',
    timeoutMs: auxiliaryTimeoutMs(input.querySource),
  }
}

export function applyApiTimeoutTraceContext(
  target:
    | {
        timeoutKind?: ApiTimeoutKind
        timeoutMs?: number
      }
    | undefined,
  policy: ApiTimeoutPolicy,
): void {
  if (!target) {
    return
  }
  target.timeoutKind = policy.timeoutKind
  target.timeoutMs = policy.timeoutMs
}

export async function withApiTimeout<T>(
  policy: ApiTimeoutPolicy,
  parentSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  let parentAborted = false
  let parentAbortReject: ((error: LLMAbortError) => void) | undefined
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const parentAbortPromise = new Promise<never>((_, reject) => {
    parentAbortReject = reject
  })
  const abortFromParent = () => {
    parentAborted = true
    controller.abort(parentSignal?.reason)
    parentAbortReject?.(new LLMAbortError(parentSignal?.reason))
  }
  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason)
    throw new LLMAbortError(parentSignal.reason)
  }
  parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort(policy.timeoutKind)
      reject(
        new LLMTimeoutError(
          `${policy.timeoutKind} after ${policy.timeoutMs}ms`,
        ),
      )
    }, policy.timeoutMs)
    timeoutId.unref?.()
  })

  try {
    const operationPromise = Promise.resolve()
      .then(() => operation(controller.signal))
      .catch(error => {
        if (timedOut || controller.signal.reason === policy.timeoutKind) {
          throw new LLMTimeoutError(
            `${policy.timeoutKind} after ${policy.timeoutMs}ms`,
            error,
          )
        }
        if (parentAborted) {
          throw new LLMAbortError(error)
        }
        throw error
      })
    return await Promise.race([
      operationPromise,
      timeoutPromise,
      parentAbortPromise,
    ])
  } catch (error) {
    if (
      error instanceof LLMTimeoutError &&
      error.message === `${policy.timeoutKind} after ${policy.timeoutMs}ms`
    ) {
      throw error
    }
    if (parentAborted && error instanceof LLMAbortError) {
      throw error
    }
    if (timedOut || controller.signal.reason === policy.timeoutKind) {
      throw new LLMTimeoutError(
        `${policy.timeoutKind} after ${policy.timeoutMs}ms`,
        error,
      )
    }
    if (parentAborted) {
      throw new LLMAbortError(error)
    }
    throw error
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
}

function auxiliaryTimeoutMs(
  querySource: QuerySource | string | undefined,
): number {
  switch (querySource) {
    case 'side_question':
    case 'verification_agent':
    case 'session_search':
      return FOREGROUND_AUXILIARY_TIMEOUT_MS
    case 'model_validation':
    case 'permission_explainer':
    case 'verify_api_key':
      return VALIDATION_TIMEOUT_MS
    default:
      return SHORT_AUXILIARY_TIMEOUT_MS
  }
}
