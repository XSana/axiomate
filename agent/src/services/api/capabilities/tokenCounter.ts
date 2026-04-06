/**
 * Token counting — provider-abstracted.
 *
 * Uses provider.countTokens() for server-side counting (Anthropic).
 * Falls back to local estimation when provider returns null (OpenAI, etc.).
 *
 * roughTokenCountEstimation* functions remain unchanged (pure local, no SDK).
 */
import type { LLMProvider } from '../provider.js'
import type { MessageParam, NeutralToolSchema } from '../streamTypes.js'

/**
 * Count tokens for messages + tools via the provider's server-side API.
 * Returns null if the provider doesn't support token counting
 * (callers should fall back to roughTokenCountEstimation).
 */
export async function countTokensForMessages(
  provider: LLMProvider,
  model: string,
  messages: MessageParam[],
  tools?: NeutralToolSchema[],
  thinking?: boolean,
): Promise<number | null> {
  return provider.countTokens({ model, messages, tools, thinking })
}
