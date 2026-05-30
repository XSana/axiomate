import { randomUUID } from 'crypto'
import type { QuerySource } from '../../constants/querySource.js'
import {
  auxiliaryAttemptQueryOptions,
  auxiliaryFailureAssistantMessage,
  runAuxiliaryTask,
  type AuxiliaryTaskAttempt,
} from '../../services/api/auxiliaryTaskRunner.js'
import { queryModelWithoutStreaming } from '../../services/api/llm.js'
import type { AssistantMessage } from '../../types/message.js'
import type { Message } from '../../types/message.js'
import { createAbortController } from '../../utils/abortController.js'
import { logError } from '../../utils/log.js'
import { toError } from '../errors.js'
import { extractTextContent } from '../messages.js'
import type { AuxiliaryTaskId } from '../model/modelRouting.js'
import { asSystemPrompt } from '../systemPromptType.js'
import type { REPLHookContext } from './postSamplingHooks.js'

export type ApiQueryHookContext = REPLHookContext & {
  queryMessageCount?: number
}

type ApiQueryHookConfigBase<TResult> = {
  name: QuerySource
  shouldRun: (context: ApiQueryHookContext) => Promise<boolean>

  // Build the complete message list to send to the API
  buildMessages: (context: ApiQueryHookContext) => Message[]

  // Optional: override system prompt (defaults to context.systemPrompt)
  systemPrompt?: string

  // Optional: whether to use tools from context (defaults to true)
  // Set to false to pass empty tools array
  useTools?: boolean

  parseResponse: (content: string, context: ApiQueryHookContext) => TResult
  logResult: (
    result: ApiQueryResult<TResult>,
    context: ApiQueryHookContext,
  ) => void
}

type ApiQueryHookAuxiliaryTaskConfig = {
  // Route/task policy driven path. Model fallback decisions are made by the
  // unified recovery system, using this task policy as available route data.
  auxiliaryTask: AuxiliaryTaskId
  getModel?: never
}

type ApiQueryHookExplicitModelConfig = {
  // Must be a function to ensure lazy loading (config is accessed before allowed)
  // Receives context so callers can inherit the main loop model if desired. This
  // is an explicit model bypass; it does not use auxiliary route fallback.
  getModel: (context: ApiQueryHookContext) => string
  auxiliaryTask?: never
}

export type ApiQueryHookConfig<TResult> = ApiQueryHookConfigBase<TResult> &
  (ApiQueryHookAuxiliaryTaskConfig | ApiQueryHookExplicitModelConfig)

export type ApiQueryResult<TResult> =
  | {
      type: 'success'
      queryName: string
      result: TResult
      messageId: string
      model: string
      uuid: string
    }
  | {
      type: 'error'
      queryName: string
      error: Error
      uuid: string
    }

function getResponseModel(response: AssistantMessage, fallback: string): string {
  return response.message.model || fallback
}

export function createApiQueryHook<TResult>(
  config: ApiQueryHookConfig<TResult>,
) {
  return async (context: ApiQueryHookContext): Promise<void> => {
    try {
      const shouldRun = await config.shouldRun(context)
      if (!shouldRun) {
        return
      }

      const uuid = randomUUID()

      // Build messages using the config's buildMessages function
      const messages = config.buildMessages(context)
      context.queryMessageCount = messages.length

      // Use config's system prompt if provided, otherwise use context's
      const systemPrompt = config.systemPrompt
        ? asSystemPrompt([config.systemPrompt])
        : context.systemPrompt

      // Use config's tools preference (defaults to true = use context tools)
      const useTools = config.useTools ?? true
      const tools = useTools ? context.toolUseContext.options.tools : []
      const signal = createAbortController().signal
      const onRecoveryTrace = context.toolUseContext.onRecoveryTrace
      let lastRequestedModel: string | undefined

      const runHookQuery = (
        model: string,
        attempt?: AuxiliaryTaskAttempt,
      ): Promise<AssistantMessage> => {
        lastRequestedModel = model
        return queryModelWithoutStreaming({
          messages,
          systemPrompt,
          thinkingConfig: { type: 'disabled' as const },
          tools,
          signal,
          options: {
            getToolPermissionContext: async () => {
              const appState = context.toolUseContext.getAppState()
              return appState.toolPermissionContext
            },
            model,
            onRecoveryTrace,
            ...(attempt
              ? {
                  ...auxiliaryAttemptQueryOptions(attempt, config.name),
                  maxOutputTokensOverride: attempt.policy.maxOutputTokens,
                }
              : {}),
            toolChoice: undefined,
            isNonInteractiveSession:
              context.toolUseContext.options.isNonInteractiveSession,
            hasAppendSystemPrompt:
              !!context.toolUseContext.options.appendSystemPrompt,
            temperatureOverride: 0,
            agents: context.toolUseContext.options.agentDefinitions.activeAgents,
            querySource: config.name,
            mcpTools: [],
            agentId: context.toolUseContext.agentId,
          },
        })
      }

      const response = config.auxiliaryTask
        ? await runAuxiliaryTask<AssistantMessage | null>({
            task: config.auxiliaryTask,
            operation: 'inference',
            querySource: config.name,
            signal,
            sink: onRecoveryTrace,
            execute: attempt => runHookQuery(attempt.model, attempt),
            onFailure: auxiliaryFailureAssistantMessage,
          })
        : await runHookQuery(config.getModel(context))

      if (!response) {
        config.logResult(
          {
            type: 'error',
            queryName: config.name,
            error: new Error('Model returned no response'),
            uuid,
          },
          context,
        )
        return
      }

      // Parse response
      const content = extractTextContent(response.message.content).trim()
      const responseModel = getResponseModel(
        response,
        lastRequestedModel ?? 'unknown',
      )

      try {
        const result = config.parseResponse(content, context)
        config.logResult(
          {
            type: 'success',
            queryName: config.name,
            result,
            messageId: response.message.id,
            model: responseModel,
            uuid,
          },
          context,
        )
      } catch (error) {
        config.logResult(
          {
            type: 'error',
            queryName: config.name,
            error: error as Error,
            uuid,
          },
          context,
        )
      }
    } catch (error) {
      logError(toError(error))
    }
  }
}
