/**
 * Anthropic LLM Provider.
 *
 * Encapsulates all Anthropic-specific logic: client creation, param building,
 * SDK call, retry, stream adaptation, error classification, cost calculation.
 *
 * External callers only see neutral types (StreamRequest → StreamEvent).
 */
import type Anthropic from '@anthropic-ai/sdk'
import { APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk'
import type {
  BetaMessageCreateParams,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ClientOptions } from '@anthropic-ai/sdk'
import { anthropicStreamAdapter } from '../adapters/anthropicStreamAdapter.js'
import {
  messagesToAnthropic,
  toolsToAnthropic,
  toolChoiceToAnthropic,
  blockParamToAnthropic,
} from '../adapters/anthropicRequestAdapter.js'
import type {
  ErrorClassification,
  LLMProvider,
  ProviderStreamResult,
  StreamRequest,
} from '../provider.js'
import type { StreamEvent, TextBlockParam, Usage } from '../streamTypes.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnthropicProviderConfig {
  /** Function to create the Anthropic SDK client */
  getClient: (options: {
    maxRetries: number
    model?: string
    fetchOverride?: ClientOptions['fetch']
    source?: string
  }) => Promise<Anthropic>

  /** Function to calculate USD cost (wraps existing calculateUSDCost) */
  calculateUSDCost?: (model: string, usage: any) => number

  /** Called with SystemAPIErrorMessage during retries (for UI display) */
  onRetryError?: (message: any) => void
}

// ---------------------------------------------------------------------------
// AnthropicProvider
// ---------------------------------------------------------------------------

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic'

  private config: AnthropicProviderConfig

  constructor(config: AnthropicProviderConfig) {
    this.config = config
  }

  async createStream(request: StreamRequest): Promise<ProviderStreamResult> {
    const {
      model,
      messages,
      systemPrompt,
      tools,
      toolChoice,
      maxTokens,
      temperature,
      providerOptions = {},
      signal,
    } = request

    // --- 1. Create client ---
    const client = await this.config.getClient({
      maxRetries: 0, // Manual retry
      model,
      fetchOverride: providerOptions.fetchOverride as ClientOptions['fetch'],
      source: providerOptions.querySource as string,
    })

    // --- 2. Convert neutral types → Anthropic params ---
    const anthropicMessages = messagesToAnthropic(messages)
    const anthropicTools = tools.length > 0 ? toolsToAnthropic(tools) : undefined
    const anthropicToolChoice = toolChoiceToAnthropic(toolChoice)
    const anthropicSystem = this.convertSystemPrompt(systemPrompt)

    // --- 3. Build Anthropic-specific params ---
    const params: Record<string, unknown> = {
      model,
      messages: anthropicMessages,
      max_tokens: maxTokens,
      stream: true,
    }

    // System prompt
    if (anthropicSystem) {
      params.system = anthropicSystem
    }

    // Tools
    if (anthropicTools && anthropicTools.length > 0) {
      params.tools = anthropicTools
    }
    if (anthropicToolChoice) {
      params.tool_choice = anthropicToolChoice
    }

    // Temperature (omit when thinking is enabled — Anthropic requirement)
    if (temperature != null && !providerOptions.thinkingConfig) {
      params.temperature = temperature
    }

    // Anthropic-specific from providerOptions
    if (providerOptions.betas) {
      params.betas = providerOptions.betas
    }
    if (providerOptions.thinkingConfig) {
      params.thinking = providerOptions.thinkingConfig
    }
    if (providerOptions.metadata) {
      params.metadata = providerOptions.metadata
    }
    if (providerOptions.contextManagement) {
      params.context_management = providerOptions.contextManagement
    }
    if (providerOptions.outputConfig) {
      params.output_config = providerOptions.outputConfig
    }
    if (providerOptions.speed) {
      params.speed = providerOptions.speed
    }

    // Spread any extra body params (e.g. anti_distillation for Bedrock)
    if (providerOptions.extraBodyParams) {
      Object.assign(params, providerOptions.extraBodyParams)
    }

    // --- 4. SDK call ---
    const result = await client.beta.messages
      .create(params as BetaMessageCreateParams & { stream: true }, {
        signal,
        ...(providerOptions.clientRequestId && {
          headers: {
            'x-client-request-id': providerOptions.clientRequestId as string,
          },
        }),
      })
      .withResponse()

    const requestId = result.request_id
    const responseHeaders = result.response?.headers as Headers | undefined
    const rawStream: AsyncIterable<BetaRawMessageStreamEvent> =
      result.data as any

    // --- 5. Adapt raw → neutral ---
    const neutralStream = anthropicStreamAdapter(rawStream)

    return {
      stream: neutralStream,
      requestId,
      responseHeaders,
    }
  }

  classifyError(error: unknown): ErrorClassification {
    if (error instanceof APIUserAbortError) {
      return { retryable: false, type: 'abort' }
    }
    if (error instanceof APIConnectionError) {
      const details = (error as any).cause
      const code = details?.code
      if (code === 'ECONNRESET' || code === 'EPIPE') {
        return { retryable: true, type: 'connection' }
      }
      if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
        return { retryable: true, type: 'timeout' }
      }
      return { retryable: true, type: 'connection' }
    }
    if (error instanceof APIError) {
      const status = error.status
      if (status === 529) {
        return { retryable: true, type: 'overloaded', statusCode: 529 }
      }
      if (status === 429) {
        const retryAfter = (error.headers as any)?.['retry-after']
        return {
          retryable: true,
          type: 'rate_limit',
          statusCode: 429,
          retryAfterMs: retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined,
        }
      }
      if (status === 401 || status === 403) {
        return { retryable: false, type: 'auth', statusCode: status }
      }
      if (status === 500 || status === 502 || status === 503) {
        return { retryable: true, type: 'overloaded', statusCode: status }
      }
      return { retryable: false, type: 'other', statusCode: status }
    }
    return { retryable: false, type: 'other' }
  }

  calculateCost(model: string, usage: Usage): number | null {
    if (!this.config.calculateUSDCost) return null
    // Convert neutral Usage to Anthropic format for existing cost function
    const anthropicUsage = {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_input_tokens: usage.cacheReadTokens ?? 0,
      cache_creation_input_tokens: usage.cacheWriteTokens ?? 0,
    }
    return this.config.calculateUSDCost(model, anthropicUsage)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private convertSystemPrompt(
    systemPrompt: string | TextBlockParam[],
  ): string | Array<{ type: 'text'; text: string }> | undefined {
    if (typeof systemPrompt === 'string') {
      return systemPrompt || undefined
    }
    if (Array.isArray(systemPrompt) && systemPrompt.length > 0) {
      return systemPrompt.map(b => ({ type: 'text' as const, text: b.text }))
    }
    return undefined
  }
}
