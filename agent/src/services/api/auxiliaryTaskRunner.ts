import type { QuerySource } from '../../constants/querySource.js'
import type { AssistantMessage } from '../../types/message.js'
import type { AuxiliaryFailureDisposition } from '../../utils/config.js'
import {
  createAssistantAPIErrorMessage,
  getAssistantMessageText,
} from '../../utils/messages.js'
import {
  getAuxiliaryTaskPolicy,
} from '../../utils/model/model.js'
import {
  resolveModelChainFromRoute,
  type AuxiliaryTaskId,
  type ResolvedAuxiliaryTaskPolicy,
} from '../../utils/model/modelRouting.js'
import { getProviderForModel } from './providerRegistry.js'
import type { LLMProvider } from './provider.js'
import type {
  InferenceRequest,
  InferenceResponse,
} from './streamTypes.js'
import type {
  RecoveryTraceOperation,
  RecoveryTraceSink,
} from './recoveryTrace.js'
import { withAuxiliaryRecovery } from './auxiliaryRecovery.js'
import type { RetryContext } from './withRetry.js'
import {
  downgradeMultimodalToolResultContent,
  stripSlashEnumValuesFromTools,
  stripUnsupportedJsonSchemaKeywordsFromTools,
} from './requestRecoveryMutations.js'
import { FallbackTriggeredError } from './withRetry.js'

export type AuxiliaryPolicyGate = {
  allowActions: string[]
  switchModelOn: string[]
  actionAllowed: boolean
}

export type AuxiliaryTaskAttempt = {
  task: AuxiliaryTaskId
  policy: ResolvedAuxiliaryTaskPolicy
  model: string
  provider: LLMProvider
  routeId: string
  chainIndex: number
  fallbackModel?: string
  policyGate: AuxiliaryPolicyGate
}

export type AuxiliaryFailureInput = {
  task: AuxiliaryTaskId
  policy: ResolvedAuxiliaryTaskPolicy
  disposition: AuxiliaryFailureDisposition
  error: unknown
}

export type RunAuxiliaryTaskOptions<T> = {
  task: AuxiliaryTaskId
  operation: RecoveryTraceOperation
  querySource?: QuerySource | string
  signal?: AbortSignal
  sink?: RecoveryTraceSink
  execute: (attempt: AuxiliaryTaskAttempt) => Promise<T>
  onFailure?: (input: AuxiliaryFailureInput) => T
}

export async function runAuxiliaryTask<T>(
  options: RunAuxiliaryTaskOptions<T>,
): Promise<T> {
  const policy = getAuxiliaryTaskPolicy(options.task)
  const chain = resolveModelChainFromRoute(policy)
  let lastError: unknown

  for (let chainIndex = 0; chainIndex < chain.length; chainIndex++) {
    const model = chain[chainIndex]!
    const fallbackModel = chain[chainIndex + 1]
    try {
      return await options.execute({
        task: options.task,
        policy,
        model,
        provider: getProviderForModel(model),
        routeId: policy.id,
        chainIndex,
        fallbackModel,
        policyGate: buildAuxiliaryPolicyGate(policy),
      })
    } catch (error) {
      lastError = error
      if (error instanceof FallbackTriggeredError && fallbackModel) {
        continue
      }
      break
    }
  }

  return applyAuxiliaryFailureDisposition({
    task: options.task,
    policy,
    disposition: policy.failure,
    error: lastError,
    onFailure: options.onFailure,
  })
}

export async function runAuxiliaryInference(
  attempt: AuxiliaryTaskAttempt,
  request: Omit<InferenceRequest, 'model'>,
  options: {
    provider?: LLMProvider
    model?: string
    fallbackModel?: string
    operation?: RecoveryTraceOperation
    querySource?: QuerySource | string
    signal?: AbortSignal
    sink?: RecoveryTraceSink
  } = {},
): Promise<InferenceResponse> {
  const provider = options.provider ?? attempt.provider
  const model = options.model ?? attempt.model
  return withAuxiliaryRecovery(
    {
      provider,
      model,
      operation: options.operation ?? 'inference',
      querySource: options.querySource ?? request.querySource,
      signal: options.signal ?? request.signal,
      sink: options.sink ?? request.onRecoveryTrace,
      fallbackModel: options.fallbackModel ?? attempt.fallbackModel,
      routeId: attempt.routeId,
      auxiliaryTask: attempt.task,
      chainIndex: attempt.chainIndex,
      recoveryProfile: attempt.policy.recoveryProfile,
      policyGate: attempt.policyGate,
    },
    async (_retryAttempt, retryContext) =>
      provider.inference({
        ...applyAuxiliaryInferenceRecoveryContext(request, retryContext),
        model,
        signal: retryContext.signal ?? request.signal,
        suppressAuxiliaryRecoveryTrace: true,
      }),
  )
}

export function auxiliaryFailureAssistantMessage(
  input: AuxiliaryFailureInput,
): AssistantMessage | null {
  switch (input.disposition) {
    case 'return_null':
    case 'fail_open':
      return null
    case 'return_empty':
    case 'return_original':
      return createAssistantAPIErrorMessage({ content: '' })
    case 'fail_closed':
    case 'propagate_error':
      throw input.error
  }
}

export function auxiliaryFailureText(
  input: AuxiliaryFailureInput,
): string | null {
  const message = auxiliaryFailureAssistantMessage(input)
  return message ? getAssistantMessageText(message) : null
}

function applyAuxiliaryInferenceRecoveryContext(
  request: Omit<InferenceRequest, 'model'>,
  retryContext: RetryContext,
): Omit<InferenceRequest, 'model'> {
  const omittedRequestFields = getAuxiliaryOmittedRequestFields(retryContext)
  return {
    ...request,
    messages: retryContext.downgradeMultimodalToolContent
      ? (downgradeMultimodalToolResultContent(request.messages) as
          InferenceRequest['messages'])
      : request.messages,
    tools: applyAuxiliaryToolMutations(request.tools, retryContext),
    ...(retryContext.dropMaxTokens
      ? { maxTokens: undefined }
      : { maxTokens: retryContext.maxTokensOverride ?? request.maxTokens }),
    thinking:
      retryContext.thinkingConfig.type === 'disabled'
        ? { type: 'disabled' }
        : request.thinking,
    providerHints: omittedRequestFields.length
      ? {
          ...request.providerHints,
          omittedRequestFields,
          ...(retryContext.stripSlashEnums ? { stripSlashEnums: true } : {}),
        }
      : request.providerHints,
    ...(omittedRequestFields.includes('temperature')
      ? { temperature: undefined }
      : {}),
    ...(omittedRequestFields.includes('stop')
      ? { stopSequences: undefined }
      : {}),
    ...(omittedRequestFields.includes('tool_choice')
      ? { toolChoice: undefined }
      : {}),
  }
}

function applyAuxiliaryToolMutations(
  tools: InferenceRequest['tools'],
  retryContext: RetryContext,
): InferenceRequest['tools'] {
  if (!tools) {
    return tools
  }

  let next = tools
  if (retryContext.stripJsonSchemaKeywords) {
    next = stripUnsupportedJsonSchemaKeywordsFromTools(next)
  }
  if (retryContext.stripSlashEnums) {
    next = stripSlashEnumValuesFromTools(next)
  }
  return next
}

function getAuxiliaryOmittedRequestFields(
  retryContext: RetryContext,
): string[] {
  const fields = new Set(retryContext.omittedRequestFields ?? [])
  if (retryContext.dropMaxTokens) {
    fields.add('max_tokens')
    fields.add('max_output_tokens')
  }
  if (retryContext.disableLongContextBeta) {
    fields.add('betas')
  }
  return [...fields]
}

function buildAuxiliaryPolicyGate(
  policy: ResolvedAuxiliaryTaskPolicy,
): AuxiliaryPolicyGate {
  return {
    allowActions: policy.allowActions,
    switchModelOn: policy.switchModelOn,
    actionAllowed: policy.allowActions.includes('switch_model'),
  }
}

function applyAuxiliaryFailureDisposition<T>(input: {
  task: AuxiliaryTaskId
  policy: ResolvedAuxiliaryTaskPolicy
  disposition: AuxiliaryFailureDisposition
  error: unknown
  onFailure?: (failure: AuxiliaryFailureInput) => T
}): T {
  if (input.onFailure) {
    return input.onFailure({
      task: input.task,
      policy: input.policy,
      disposition: input.disposition,
      error: input.error,
    })
  }

  switch (input.disposition) {
    case 'return_null':
    case 'fail_open':
      return null as T
    case 'return_empty':
      return '' as T
    case 'propagate_error':
      throw input.error
    case 'return_original':
    case 'fail_closed':
      throw input.error
  }
}
