import { logForDebugging } from '../../utils/debug.js'
import type { ClassifiedError } from './errorClassifier.js'
import type { ImageRecoveryProfile } from './imageRecovery.js'
import type { ApiTimeoutKind } from './apiTimeoutPolicy.js'
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
  | 'salvaged'
  | 'recovered'
  | 'fallback_triggered'
  | 'failing'
  | 'aborted'

export type RecoveryDecisionOutcome = Exclude<
  RecoveryTraceOutcome,
  'recovered'
>

export interface RecoveryTraceEvent {
  timestamp: string
  sequence?: number
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
  imageRecoveryProfile?: ImageRecoveryProfile
  requestId?: string
  ttfbMs?: number
  elapsedMs?: number
  bytesReceived?: number
  streamPhase?: RecoveryStreamPhase
  timeoutKind?: ApiTimeoutKind
  timeoutMs?: number
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
  routeId?: string
  fromModel?: string
  toModel?: string
  chainIndex?: number
  policyGate?: {
    allowActions?: string[]
    switchModelOn?: string[]
    actionAllowed?: boolean
    reasonAllowed?: boolean
  }
  auxiliaryTask?: string
  foregroundSource?: boolean
}

export type RecoveryTraceSink = (event: RecoveryTraceEvent) => void

let nextRecoveryTraceSequence = 1
let nextRecoveryTraceEventSequence = 1

export function createRecoveryTraceId(prefix = 'api-recovery'): string {
  const sequence = nextRecoveryTraceSequence++
  if (nextRecoveryTraceSequence > Number.MAX_SAFE_INTEGER) {
    nextRecoveryTraceSequence = 1
  }
  return `${prefix}-${sequence}`
}

export interface RecoveryTraceContext {
  requestId?: string
  ttfbMs?: number
  elapsedMs?: number
  bytesReceived?: number
  streamPhase?: RecoveryStreamPhase
  timeoutKind?: ApiTimeoutKind
  timeoutMs?: number
  innerCause?: string
  safeHeaders?: Record<string, string>
  routeId?: string
  fromModel?: string
  toModel?: string
  chainIndex?: number
  policyGate?: RecoveryTraceEvent['policyGate']
  auxiliaryTask?: string
  foregroundSource?: boolean
}

export function emitRecoveryTrace(
  sink: RecoveryTraceSink | undefined,
  event: Omit<RecoveryTraceEvent, 'timestamp' | 'sequence'>,
): RecoveryTraceEvent {
  const sequence = nextRecoveryTraceEventSequence++
  if (nextRecoveryTraceEventSequence > Number.MAX_SAFE_INTEGER) {
    nextRecoveryTraceEventSequence = 1
  }
  const trace: RecoveryTraceEvent = {
    timestamp: new Date().toISOString(),
    sequence,
    ...event,
    mutation: event.mutation ? [...event.mutation] : undefined,
    safeHeaders: event.safeHeaders ? { ...event.safeHeaders } : undefined,
    policyGate: snapshotPolicyGate(event.policyGate),
  }

  sink?.(trace)
  logForDebugging(`api_recovery_trace ${JSON.stringify(trace)}`, {
    level: 'info',
  })
  return trace
}

function snapshotPolicyGate(
  policyGate: RecoveryTraceEvent['policyGate'],
): RecoveryTraceEvent['policyGate'] | undefined {
  if (!policyGate) {
    return undefined
  }
  return {
    allowActions: policyGate.allowActions
      ? [...policyGate.allowActions]
      : undefined,
    switchModelOn: policyGate.switchModelOn
      ? [...policyGate.switchModelOn]
      : undefined,
    actionAllowed: policyGate.actionAllowed,
    reasonAllowed: policyGate.reasonAllowed,
  }
}
