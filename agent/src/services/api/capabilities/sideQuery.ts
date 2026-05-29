/**
 * Side query — lightweight non-streaming inference for classifiers, explainers, validation.
 *
 * Routes to provider-specific implementation based on provider.name.
 * Each provider handles its own system prompt conventions, attribution, betas, etc.
 */
import type { LLMProvider } from '../provider.js'
import type {
  ContentBlockParam,
  InferenceResponse,
  InferenceRequest,
  MessageParam,
  NeutralOutputFormat,
  NeutralToolSchema,
  ToolChoice,
} from '../streamTypes.js'
import type { QuerySource } from '../../../constants/querySource.js'
import { anthropicSideQuery } from './anthropic/sideQuery.js'
import type { RecoveryTraceSink } from '../recoveryTrace.js'
import { withAuxiliaryRecovery } from '../auxiliaryRecovery.js'
import type { RetryContext } from '../withRetry.js'
import {
  runAuxiliaryTask,
  type AuxiliaryTaskAttempt,
} from '../auxiliaryTaskRunner.js'
import type { AuxiliaryTaskId } from '../../../utils/model/modelRouting.js'
import {
  downgradeMultimodalToolResultContent,
  stripSlashEnumValuesFromTools,
  stripUnsupportedJsonSchemaKeywordsFromTools,
} from '../requestRecoveryMutations.js'

/**
 * Protocol-neutral side query options.
 * No SDK types — all fields are neutral or primitive.
 */
export type NeutralSideQueryOptions = {
  model: string
  system?: string | ContentBlockParam[]
  messages: MessageParam[]
  tools?: NeutralToolSchema[]
  toolChoice?: ToolChoice
  outputFormat?: NeutralOutputFormat
  maxTokens?: number
  signal?: AbortSignal
  skipSystemPromptPrefix?: boolean
  temperature?: number
  /** Thinking budget (enables thinking), or `false` to send `{ type: 'disabled' }`. */
  thinking?: number | false
  stopSequences?: string[]
  querySource: QuerySource
  onRecoveryTrace?: RecoveryTraceSink
  auxiliaryTask?: AuxiliaryTaskId
}

export type AuxiliarySideQueryOptions = Omit<
  NeutralSideQueryOptions,
  'model' | 'auxiliaryTask'
> & {
  auxiliaryTask: AuxiliaryTaskId
}

/**
 * Execute a side query through the appropriate provider.
 * Routes based on provider.name.
 */
export async function sideQuery(
  provider: LLMProvider,
  options: NeutralSideQueryOptions,
): Promise<InferenceResponse>
export async function sideQuery(
  options: AuxiliarySideQueryOptions,
): Promise<InferenceResponse>
export async function sideQuery(
  providerOrOptions: LLMProvider | AuxiliarySideQueryOptions,
  maybeOptions?: NeutralSideQueryOptions,
): Promise<InferenceResponse> {
  if (maybeOptions === undefined) {
    const options = providerOrOptions as AuxiliarySideQueryOptions
    return runAuxiliaryTask({
      task: options.auxiliaryTask,
      operation: 'side_query',
      querySource: options.querySource,
      signal: options.signal,
      sink: options.onRecoveryTrace,
      execute: attempt =>
        sideQueryAttempt(
          attempt.provider,
          {
            ...options,
            model: attempt.model,
          },
          attempt,
        ),
      onFailure: ({ disposition, error, policy }) => {
        if (disposition === 'return_original' || disposition === 'fail_open') {
          return emptyInferenceResponse(policy.primary)
        }
        if (disposition === 'return_empty' || disposition === 'return_null') {
          return emptyInferenceResponse(policy.primary)
        }
        throw error
      },
    })
  }

  const provider = providerOrOptions as LLMProvider
  const options = maybeOptions
  if (options.auxiliaryTask) {
    return runAuxiliaryTask({
      task: options.auxiliaryTask,
      operation: 'side_query',
      querySource: options.querySource,
      signal: options.signal,
      sink: options.onRecoveryTrace,
      execute: attempt =>
        sideQueryAttempt(
          attempt.provider,
          {
            ...options,
            model: attempt.model,
          },
          attempt,
        ),
      onFailure: ({ disposition, error }) => {
        if (disposition === 'return_original' || disposition === 'fail_open') {
          return emptyInferenceResponse(options.model)
        }
        if (disposition === 'return_empty' || disposition === 'return_null') {
          return emptyInferenceResponse(options.model)
        }
        throw error
      },
    })
  }
  return sideQueryAttempt(provider, options)
}

async function sideQueryAttempt(
  provider: LLMProvider,
  options: NeutralSideQueryOptions,
  attempt?: AuxiliaryTaskAttempt,
): Promise<InferenceResponse> {
  return withAuxiliaryRecovery(
    {
      provider,
      model: options.model,
      operation: 'side_query',
      querySource: options.querySource,
      signal: options.signal,
      sink: options.onRecoveryTrace,
      fallbackModel: attempt?.fallbackModel,
      routeId: attempt?.routeId,
      auxiliaryTask: attempt?.task,
      chainIndex: attempt?.chainIndex,
      recoveryProfile: attempt?.policy.recoveryProfile,
      policyGate: attempt?.policyGate,
    },
    async (_attempt, retryContext) => {
      switch (provider.name) {
        case 'anthropic': {
          return anthropicSideQuery(
            provider,
            applyAuxiliaryRecoveryContext(options, retryContext),
            auxiliaryInferenceRequestPatch(retryContext),
          )
        }
        case 'openai-chat':
        case 'openai-responses': {
          // Both OpenAI-family providers expose the same neutral inference()
          // contract; no provider-specific wrapping needed.
          const recoveredOptions = applyAuxiliaryRecoveryContext(
            options,
            retryContext,
          )
          return provider.inference({
            ...recoveredOptions,
            ...auxiliaryInferenceRequestPatch(retryContext),
            model: options.model,
            thinking: retryContext.thinkingConfig.type === 'disabled'
              ? { type: 'disabled' }
              : recoveredOptions.thinking === false
                ? { type: 'disabled' }
                : recoveredOptions.thinking
                  ? {
                      type: 'enabled',
                      budgetTokens: recoveredOptions.thinking,
                    }
                  : undefined,
          })
        }
        default:
          throw new Error(`sideQuery: unsupported provider '${provider.name}'`)
      }
    },
  )
}

function emptyInferenceResponse(model: string): InferenceResponse {
  return {
    id: 'auxiliary-empty',
    content: [{ type: 'text', text: '' }],
    model,
    stopReason: 'end_turn',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  }
}

function applyAuxiliaryRecoveryContext(
  options: NeutralSideQueryOptions,
  retryContext: RetryContext,
): NeutralSideQueryOptions {
  return {
    ...options,
    signal: retryContext.signal ?? options.signal,
    messages: retryContext.downgradeMultimodalToolContent
      ? (downgradeMultimodalToolResultContent(
          options.messages,
        ) as NeutralSideQueryOptions['messages'])
      : options.messages,
    tools: applyAuxiliaryToolMutations(options.tools, retryContext),
    ...(retryContext.dropMaxTokens
      ? { maxTokens: undefined }
      : { maxTokens: retryContext.maxTokensOverride ?? options.maxTokens }),
    thinking:
      retryContext.thinkingConfig.type === 'disabled'
        ? false
        : options.thinking,
  }
}

function applyAuxiliaryToolMutations(
  tools: NeutralSideQueryOptions['tools'],
  retryContext: RetryContext,
): NeutralSideQueryOptions['tools'] {
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

function auxiliaryInferenceRequestPatch(
  retryContext: RetryContext,
): Pick<
  InferenceRequest,
  | 'suppressAuxiliaryRecoveryTrace'
  | 'tools'
  | 'maxTokens'
  | 'temperature'
  | 'stopSequences'
  | 'toolChoice'
  | 'providerHints'
> {
  const omittedRequestFields = getAuxiliaryOmittedRequestFields(retryContext)
  const patch: Pick<
    InferenceRequest,
    | 'suppressAuxiliaryRecoveryTrace'
    | 'tools'
    | 'maxTokens'
    | 'temperature'
    | 'stopSequences'
    | 'toolChoice'
    | 'providerHints'
  > = {
    suppressAuxiliaryRecoveryTrace: true,
  }

  if (retryContext.dropMaxTokens) {
    patch.maxTokens = undefined
  }

  if (omittedRequestFields.length) {
    patch.providerHints = {
      omittedRequestFields,
    }
    if (omittedRequestFields.includes('temperature')) {
      patch.temperature = undefined
    }
    if (omittedRequestFields.includes('stop')) {
      patch.stopSequences = undefined
    }
    if (omittedRequestFields.includes('tool_choice')) {
      patch.toolChoice = undefined
    }
  }
  if (retryContext.stripSlashEnums) {
    patch.providerHints = {
      ...patch.providerHints,
      stripSlashEnums: true,
    }
  }

  if (
    !retryContext.dropMaxTokens &&
    retryContext.maxTokensOverride !== undefined
  ) {
    patch.maxTokens = retryContext.maxTokensOverride
  }

  return patch
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
