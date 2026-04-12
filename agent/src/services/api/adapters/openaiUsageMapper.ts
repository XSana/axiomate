import type { ModelProviderUsageMapping } from '../../../utils/config.js'
import type { Usage } from '../streamTypes.js'

const DEFAULT_USAGE_MAPPING: Required<ModelProviderUsageMapping> = {
  promptTokens: 'usage.prompt_tokens',
  completionTokens: 'usage.completion_tokens',
  cacheReadTokens: [
    'usage.prompt_cache_hit_tokens',
    'usage.prompt_tokens_details.cached_tokens',
  ],
  cacheWriteTokens: [
    'usage.prompt_tokens_details.cache_creation.cache_creation_input_tokens',
    'usage.prompt_tokens_details.cache_creation.ephemeral_5m_input_tokens',
  ],
  cacheMissTokens: 'usage.prompt_cache_miss_tokens',
}

function pathsFor(
  mapping: ModelProviderUsageMapping | undefined,
  key: keyof ModelProviderUsageMapping,
): string[] {
  const configured = mapping?.[key] ?? DEFAULT_USAGE_MAPPING[key]
  return Array.isArray(configured) ? configured : [configured]
}

function getByPath(source: unknown, path: string): unknown {
  let current = source
  for (const segment of path.split('.')) {
    if (
      current === null ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function readNumber(
  source: unknown,
  mapping: ModelProviderUsageMapping | undefined,
  key: keyof ModelProviderUsageMapping,
): number | undefined {
  for (const path of pathsFor(mapping, key)) {
    const value = asFiniteNumber(getByPath(source, path))
    if (value !== undefined) {
      return value
    }

    // Convenience: allow paths relative to the usage object as well as paths
    // rooted at the full response/chunk.
    if (!path.startsWith('usage.')) {
      const usageRelativeValue = asFiniteNumber(
        getByPath(getByPath(source, 'usage'), path),
      )
      if (usageRelativeValue !== undefined) {
        return usageRelativeValue
      }
    }
  }
  return undefined
}

export function mapOpenAIUsage(
  source: unknown,
  mapping?: ModelProviderUsageMapping,
): Usage {
  const promptTokens = readNumber(source, mapping, 'promptTokens') ?? 0
  const outputTokens = readNumber(source, mapping, 'completionTokens') ?? 0
  const cacheReadTokens = readNumber(source, mapping, 'cacheReadTokens') ?? 0
  const cacheWriteTokens = readNumber(source, mapping, 'cacheWriteTokens') ?? 0
  const cacheMissTokens = readNumber(source, mapping, 'cacheMissTokens')

  const inputTokens =
    cacheMissTokens ??
    Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens)

  return {
    inputTokens,
    outputTokens,
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
  }
}
