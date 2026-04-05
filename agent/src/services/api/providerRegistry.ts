/**
 * Provider registry: selects the appropriate LLMProvider based on model name.
 *
 * Default: all models route to AnthropicProvider (including Bedrock/Vertex/Foundry
 * which are Anthropic SDK variants, not separate providers).
 *
 * Custom providers can be registered via registerProvider() for OpenAI-compatible
 * models. When custom model configuration is implemented (e.g., via
 * ~/.axiomate/custom-models.json), the registry will automatically route
 * matching models to the registered provider.
 */
import type { LLMProvider } from './provider.js'
import { AnthropicProvider } from './providers/anthropicProvider.js'
import { calculateUSDCost } from '../../utils/modelCost.js'
import type { NonNullableUsage } from '../../entrypoints/sdk/sdkUtilityTypes.js'

// ---------------------------------------------------------------------------
// Provider store
// ---------------------------------------------------------------------------

let defaultProvider: AnthropicProvider | undefined

/**
 * Registered providers keyed by provider name (e.g. 'openai').
 * Models are matched against registered patterns to select a provider.
 */
const registeredProviders = new Map<string, {
  provider: LLMProvider
  /** Model name patterns that this provider handles (glob-style, e.g. 'gpt-*'). */
  modelPatterns: string[]
}>()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a custom LLMProvider for specific model patterns.
 * @param name Unique provider name (e.g. 'openai')
 * @param provider The LLMProvider implementation
 * @param modelPatterns Glob-style patterns for model names (e.g. ['gpt-*', 'o1-*'])
 */
export function registerProvider(
  name: string,
  provider: LLMProvider,
  modelPatterns: string[],
): void {
  registeredProviders.set(name, { provider, modelPatterns })
}

/**
 * Remove a registered provider.
 */
export function unregisterProvider(name: string): void {
  registeredProviders.delete(name)
}

/**
 * Get the LLMProvider for the given model.
 *
 * Checks registered providers first (by model pattern match),
 * then falls back to the default AnthropicProvider.
 */
export function getProviderForModel(model: string): LLMProvider {
  // Check registered providers for a matching pattern
  for (const [, entry] of registeredProviders) {
    if (matchesAnyPattern(model, entry.modelPatterns)) {
      return entry.provider
    }
  }

  // Default: Anthropic (covers firstParty, Bedrock, Vertex, Foundry)
  if (!defaultProvider) {
    defaultProvider = new AnthropicProvider({
      calculateUSDCost: (m, usage) =>
        calculateUSDCost(m, usage as NonNullableUsage),
    })
  }
  return defaultProvider
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

/**
 * Simple glob-style matching: '*' matches any substring.
 * Supports patterns like 'gpt-*', 'o1-*', 'claude-*', exact matches.
 */
function matchesPattern(model: string, pattern: string): boolean {
  if (pattern === '*') return true
  if (!pattern.includes('*')) return model === pattern
  const regex = new RegExp(
    '^' + pattern.replace(/\*/g, '.*') + '$',
  )
  return regex.test(model)
}

function matchesAnyPattern(model: string, patterns: string[]): boolean {
  return patterns.some(p => matchesPattern(model, p))
}
