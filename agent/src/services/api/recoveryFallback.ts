import type { ClassifiedError } from './errorClassifier.js'
import type { RecoveryTraceEvent } from './recoveryTrace.js'
import type { ModelSwitchReason } from '../../utils/config.js'

export type ModelFallbackDeniedBy =
  | 'no_candidate'
  | 'same_model'
  | 'deferred'
  | 'action_policy'
  | 'reason_policy'

export interface ModelFallbackPolicyInput {
  allowActions?: readonly string[]
  switchModelOn?: readonly string[]
  actionAllowed?: boolean
  reasonAllowed?: boolean
}

export interface ModelFallbackPolicySnapshot {
  allowActions?: string[]
  switchModelOn?: string[]
  actionAllowed: boolean
  reasonAllowed: boolean
}

export interface ModelFallbackAvailability {
  available: boolean
  currentModel: string
  candidateModel?: string
  deniedBy?: ModelFallbackDeniedBy
  policySnapshot?: ModelFallbackPolicySnapshot
}

export function resolveModelFallbackAvailability(input: {
  currentModel: string
  candidateModel?: string
  classified: Pick<ClassifiedError, 'reason'>
  policy?: ModelFallbackPolicyInput
  deferred?: boolean
}): ModelFallbackAvailability {
  const policySnapshot = snapshotModelFallbackPolicy(
    input.policy,
    input.classified.reason,
  )

  if (!input.candidateModel) {
    return {
      available: false,
      currentModel: input.currentModel,
      policySnapshot,
      deniedBy: 'no_candidate',
    }
  }

  if (input.candidateModel === input.currentModel) {
    return {
      available: false,
      currentModel: input.currentModel,
      candidateModel: input.candidateModel,
      policySnapshot,
      deniedBy: 'same_model',
    }
  }

  if (policySnapshot?.actionAllowed === false) {
    return {
      available: false,
      currentModel: input.currentModel,
      candidateModel: input.candidateModel,
      policySnapshot,
      deniedBy: 'action_policy',
    }
  }

  if (policySnapshot?.reasonAllowed === false) {
    return {
      available: false,
      currentModel: input.currentModel,
      candidateModel: input.candidateModel,
      policySnapshot,
      deniedBy: 'reason_policy',
    }
  }

  if (input.deferred) {
    return {
      available: false,
      currentModel: input.currentModel,
      candidateModel: input.candidateModel,
      policySnapshot,
      deniedBy: 'deferred',
    }
  }

  return {
    available: true,
    currentModel: input.currentModel,
    candidateModel: input.candidateModel,
    policySnapshot,
  }
}

export function recoveryTracePolicyGateFromAvailability(
  availability: ModelFallbackAvailability | undefined,
): RecoveryTraceEvent['policyGate'] | undefined {
  return availability?.policySnapshot
}

function snapshotModelFallbackPolicy(
  policy: ModelFallbackPolicyInput | undefined,
  reason: ClassifiedError['reason'],
): ModelFallbackPolicySnapshot | undefined {
  if (!policy) {
    return undefined
  }
  const allowActions = policy.allowActions ? [...policy.allowActions] : undefined
  const switchModelOn = policy.switchModelOn ? [...policy.switchModelOn] : undefined
  return {
    allowActions,
    switchModelOn,
    actionAllowed:
      allowActions?.includes('switch_model') ?? policy.actionAllowed ?? true,
    reasonAllowed:
      switchModelOn?.includes(reason as ModelSwitchReason) ??
      policy.reasonAllowed ??
      true,
  }
}
