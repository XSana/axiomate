import type { LLMProvider } from './provider.js'
import {
  emitBoundaryRecoveryDecisionTrace,
  type BoundaryRecoveryDecisionTraceInput,
} from './boundaryRecovery.js'
import type {
  RecoveryTraceOperation,
  RecoveryTraceSink,
} from './recoveryTrace.js'
import { createRecoveryTraceId } from './recoveryTrace.js'

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
  const traceInput: BoundaryRecoveryDecisionTraceInput = {
    traceId: createRecoveryTraceId(`api-${input.operation}-failure`),
    sink: input.sink,
    protocol: input.provider.name,
    model: input.model,
    attempt: 1,
    maxAttempts: 1,
    error: input.error,
    wrappedError,
    operation: input.operation,
    querySource: input.querySource,
    requestId: input.requestId,
    recoveryBudgetExhausted: true,
    foregroundSource: false,
    canFallback: false,
    recommendedCanFallback: false,
    final: true,
  }

  emitBoundaryRecoveryDecisionTrace(traceInput)
}
