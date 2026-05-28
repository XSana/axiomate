import { logForDebugging } from '../../utils/debug.js'
import type { ClassifiedError } from './errorClassifier.js'
import type { RecoveryAction } from './recoveryAction.js'
import type { RecoveryIntent } from './recoveryIntent.js'
import type {
  RecoveryDecisionRepeatPolicy,
  RecoveryProtocol,
} from './recoverySession.js'

export type RecoveryStreamPhase =
  | 'client_init'
  | 'request_build'
  | 'request_sent'
  | 'response_headers'
  | 'first_byte'
  | 'streaming'
  | 'stream_complete'
  | 'fallback'
  | 'non_streaming'

export type RecoveryTraceOperation =
  | 'stream'
  | 'non_streaming_fallback'
  | 'side_query'
  | 'inference'
  | 'verify_connection'
  | 'count_tokens'

export type RecoveryTraceOutcome =
  | 'retrying'
  | 'delegated'
  | 'fallback_triggered'
  | 'failing'
  | 'aborted'

export interface RecoveryTraceEvent {
  timestamp: string
  traceId?: string
  protocol: RecoveryProtocol
  model: string
  attempt: number
  maxAttempts: number
  reason: ClassifiedError['reason']
  intent: RecoveryIntent
  action: RecoveryAction
  outcome: RecoveryTraceOutcome
  ruleId?: string
  repeatPolicy?: RecoveryDecisionRepeatPolicy
  statusCode?: number
  retryable: boolean
  shouldCompress: boolean
  shouldFallback: boolean
  delayMs?: number
  mutation?: string[]
  requestId?: string
  ttfbMs?: number
  elapsedMs?: number
  bytesReceived?: number
  streamPhase?: RecoveryStreamPhase
  innerCause?: string
  safeHeaders?: Record<string, string>
  operation?: RecoveryTraceOperation
  querySource?: string
  recommendedIntent?: RecoveryIntent
  recommendedAction?: RecoveryAction
  observationId?: number
  decisionId?: number
  previousReason?: ClassifiedError['reason']
  previousIntent?: RecoveryIntent
  previousAction?: RecoveryAction
  isFirstFailure?: boolean
  isFirstFailureForReason?: boolean
  consecutiveSameReason?: number
  final?: boolean
}

export type RecoveryTraceSink = (event: RecoveryTraceEvent) => void

export interface RecoveryTraceContext {
  requestId?: string
  ttfbMs?: number
  elapsedMs?: number
  bytesReceived?: number
  streamPhase?: RecoveryStreamPhase
  innerCause?: string
  safeHeaders?: Record<string, string>
}

export function emitRecoveryTrace(
  sink: RecoveryTraceSink | undefined,
  event: Omit<RecoveryTraceEvent, 'timestamp'>,
): RecoveryTraceEvent {
  const trace: RecoveryTraceEvent = {
    timestamp: new Date().toISOString(),
    ...event,
  }

  sink?.(trace)
  logForDebugging(`api_recovery_trace ${JSON.stringify(trace)}`, {
    level: 'info',
  })
  return trace
}
