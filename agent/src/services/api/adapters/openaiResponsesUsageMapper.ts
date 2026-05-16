import type { ResponseUsage } from 'openai/resources/responses/responses'
import type { Usage } from '../streamTypes.js'

/**
 * Map an OpenAI Responses API `ResponseUsage` to the neutral Usage shape.
 *
 * Responses API usage fields differ from Chat Completions:
 *   input_tokens / output_tokens (not prompt_tokens / completion_tokens),
 *   input_tokens_details.cached_tokens for prompt cache hits,
 *   output_tokens_details.reasoning_tokens for reasoning consumption (rolled
 *   into outputTokens, not exposed as a separate neutral field).
 */
export function mapOpenAIResponsesUsage(
  usage: ResponseUsage | undefined,
): Usage {
  if (!usage) {
    return { inputTokens: 0, outputTokens: 0 }
  }

  const cacheReadTokens = usage.input_tokens_details?.cached_tokens ?? 0
  const promptTokens = usage.input_tokens ?? 0
  const inputTokens = Math.max(0, promptTokens - cacheReadTokens)
  const outputTokens = usage.output_tokens ?? 0

  return {
    inputTokens,
    outputTokens,
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
  }
}
