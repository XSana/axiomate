/**
 * Provider registry: selects the appropriate LLMProvider based on model name.
 *
 * Currently only Anthropic is registered. When OpenAI-compatible models are
 * added (via custom model config), the registry will route to OpenAIProvider.
 */
import type { LLMProvider } from './provider.js'
import { AnthropicProvider } from './providers/anthropicProvider.js'
import { calculateUSDCost } from '../../utils/modelCost.js'

let defaultProvider: AnthropicProvider | undefined

/**
 * Get the LLMProvider for the given model.
 *
 * Currently always returns AnthropicProvider. When custom model config
 * is implemented, this will check if the model matches an OpenAI-compatible
 * provider and return the appropriate Provider instance.
 */
export function getProviderForModel(_model: string): LLMProvider {
  // Future: check custom model config here
  // const customModel = resolveCustomModel(model)
  // if (customModel?.protocol === 'openai') {
  //   return new OpenAIProvider(customModel)
  // }

  if (!defaultProvider) {
    defaultProvider = new AnthropicProvider({
      calculateUSDCost: (model, usage) => calculateUSDCost(model, usage as any),
    })
  }
  return defaultProvider
}
