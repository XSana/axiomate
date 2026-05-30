import type { ThinkingConfig } from '../../utils/thinking.js'
import type { ClassifiedError, ErrorFailoverReason } from './errorClassifier.js'
import type { ImageRecoveryProfile } from './imageRecovery.js'
import type { RecoveryAction } from './recoveryAction.js'
import type { RecoveryIntent } from './recoveryIntent.js'
import type { RecoveryDecisionOutcome } from './recoveryTrace.js'

export type RecoveryProtocol =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic'
  | 'axiomate-generic'

export const RECOVERY_PROTOCOLS: readonly RecoveryProtocol[] = [
  'openai-chat',
  'openai-responses',
  'anthropic',
  'axiomate-generic',
]

export function normalizeRecoveryProtocol(
  protocol: string | undefined,
): RecoveryProtocol {
  if (
    protocol === 'openai-chat' ||
    protocol === 'openai-responses' ||
    protocol === 'anthropic' ||
    protocol === 'axiomate-generic'
  ) {
    return protocol
  }
  return 'axiomate-generic'
}

export type RecoveryRuleRepeatPolicy =
  | 'once'
  | 'repeatable'
  | 'until_reason_changes'
  | 'delegate_once'

export type RecoveryDecisionRepeatPolicy =
  | RecoveryRuleRepeatPolicy
  | 'outer_policy'

export interface RecoveryObservation {
  id: number
  attempt: number
  maxAttempts: number
  protocol: RecoveryProtocol
  model: string
  classified: ClassifiedError
  reason: ClassifiedError['reason']
  statusCode: number | undefined
  retryable: boolean
  shouldCompress: boolean
  shouldFallback: boolean
  message: string
  previousReason: ClassifiedError['reason'] | undefined
  isFirstFailure: boolean
  isFirstFailureForReason: boolean
  consecutiveSameReason: number
}

export interface RecoveryContextPatch {
  maxTokensOverride?: number
  dropMaxTokens?: boolean
  omittedRequestFields?: string[]
  stripReasoningReplay?: boolean
  downgradeMultimodalToolContent?: boolean
  stripJsonSchemaKeywords?: boolean
  stripSlashEnums?: boolean
  disableLongContextBeta?: boolean
  lowerContextTier?: boolean
  rewriteImagePayload?: boolean
  imageRecoveryProfile?: ImageRecoveryProfile
  thinkingConfig?: ThinkingConfig
}

export type RecoveryDecisionDisposition =
  | 'retry'
  | 'fail'
  | 'delegate'
  | 'fallback_model'
  | 'abort'
  | 'throw_original'

export interface RecoveryDecision {
  id?: number
  observationId: number
  intent: RecoveryIntent
  action: RecoveryAction
  outcome: RecoveryDecisionOutcome
  disposition: RecoveryDecisionDisposition
  ruleId?: string
  repeatPolicy?: RecoveryDecisionRepeatPolicy
  delayMs?: number
  mutation?: string[]
  contextPatch?: RecoveryContextPatch
  failureCause?: 'original' | 'repeated_overloaded'
}

export interface RecoverySessionOptions {
  protocol: RecoveryProtocol | string
  initialConsecutiveOverloadedErrors?: number
}

export interface ObserveFailureInput {
  attempt: number
  maxAttempts: number
  model: string
  classified: ClassifiedError
}

export interface RecoveryHistory {
  observations: readonly RecoveryObservation[]
  decisions: readonly RecoveryDecision[]
  previousObservation: RecoveryObservation | undefined
  previousDecision: RecoveryDecision | undefined
  lastDecisionForReason: (
    reason: ErrorFailoverReason,
  ) => RecoveryDecision | undefined
  lastDecisionForRule: (ruleId: string) => RecoveryDecision | undefined
  hasIntent: (intent: RecoveryIntent) => boolean
  countIntent: (intent: RecoveryIntent) => number
  countReason: (reason: ErrorFailoverReason) => number
  countAction: (action: RecoveryAction) => number
  countRule: (ruleId: string) => number
}

export class RecoverySession {
  private readonly observationsInternal: RecoveryObservation[] = []
  private readonly decisionsInternal: RecoveryDecision[] = []
  private readonly protocol: RecoveryProtocol

  constructor(private readonly options: RecoverySessionOptions) {
    this.protocol = normalizeRecoveryProtocol(options.protocol)
  }

  observeFailure(input: ObserveFailureInput): RecoveryObservation {
    const previous = this.observationsInternal.at(-1)
    const previouslySeenSameReason = this.observationsInternal.some(
      observation => observation.reason === input.classified.reason,
    )
    const consecutiveSameReason =
      previous?.reason === input.classified.reason
        ? previous.consecutiveSameReason + 1
        : this.initialConsecutiveCountFor(input.classified.reason) + 1

    const observation: RecoveryObservation = {
      id: this.observationsInternal.length + 1,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      protocol: this.protocol,
      model: input.model,
      classified: input.classified,
      reason: input.classified.reason,
      statusCode: input.classified.statusCode,
      retryable: input.classified.retryable,
      shouldCompress: input.classified.shouldCompress,
      shouldFallback: input.classified.shouldFallback,
      message: input.classified.message,
      previousReason: previous?.reason,
      isFirstFailure: previous === undefined,
      isFirstFailureForReason: !previouslySeenSameReason,
      consecutiveSameReason,
    }

    this.observationsInternal.push(observation)
    return observation
  }

  recordDecision(decision: RecoveryDecision): RecoveryDecision {
    const nextId = this.decisionsInternal.length + 1
    if (decision.id !== undefined && decision.id !== nextId) {
      throw new Error(
        `Recovery decision id ${decision.id} does not match next id ${nextId}`,
      )
    }

    const recorded = { ...decision, id: nextId }
    this.decisionsInternal.push(recorded)
    return recorded
  }

  get observations(): readonly RecoveryObservation[] {
    return this.observationsInternal
  }

  get decisions(): readonly RecoveryDecision[] {
    return this.decisionsInternal
  }

  get history(): RecoveryHistory {
    const observations = this.observationsInternal
    const decisions = this.decisionsInternal

    return {
      observations,
      decisions,
      previousObservation:
        observations.length >= 2
          ? observations[observations.length - 2]
          : undefined,
      previousDecision: decisions.at(-1),
      lastDecisionForReason: reason => {
        for (let i = decisions.length - 1; i >= 0; i--) {
          const decision = decisions[i]
          const observation = observations.find(
            candidate => candidate.id === decision.observationId,
          )
          if (observation?.reason === reason) {
            return decision
          }
        }
        return undefined
      },
      lastDecisionForRule: ruleId => {
        for (let i = decisions.length - 1; i >= 0; i--) {
          const decision = decisions[i]
          if (decision.ruleId === ruleId) {
            return decision
          }
        }
        return undefined
      },
      hasIntent: intent =>
        decisions.some(decision => decision.intent === intent),
      countIntent: intent =>
        decisions.filter(decision => decision.intent === intent).length,
      countReason: reason =>
        observations.filter(observation => observation.reason === reason)
          .length,
      countAction: action =>
        decisions.filter(decision => decision.action === action).length,
      countRule: ruleId =>
        decisions.filter(decision => decision.ruleId === ruleId).length,
    }
  }

  private initialConsecutiveCountFor(
    reason: ClassifiedError['reason'],
  ): number {
    if (this.observationsInternal.length > 0 || reason !== 'overloaded') {
      return 0
    }
    return this.options.initialConsecutiveOverloadedErrors ?? 0
  }
}
