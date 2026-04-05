/**
 * Provider registry: selects the appropriate LLMProvider based on model name.
 *
 * Currently only Anthropic is registered. When OpenAI-compatible custom models
 * are configured (via ~/.claude/custom-models.json), the registry will route
 * those models to OpenAIProvider.
 */
import type { LLMProvider } from './provider.js'
import { AnthropicProvider } from './providers/anthropicProvider.js'
import { calculateUSDCost } from '../../utils/modelCost.js'
import type { NonNullableUsage } from '../../entrypoints/sdk/sdkUtilityTypes.js'

let defaultProvider: AnthropicProvider | undefined

/**
 * Get the LLMProvider for the given model.
 *
 * Extensibility: when custom model configuration is implemented,
 * this function will inspect the model name against registered
 * OpenAI-compatible providers and return the matching Provider.
 */
export function getProviderForModel(_model: string): LLMProvider {
  if (!defaultProvider) {
    defaultProvider = new AnthropicProvider({
      calculateUSDCost: (model, usage) =>
        calculateUSDCost(model, usage as NonNullableUsage),
    })
  }
  return defaultProvider
}
