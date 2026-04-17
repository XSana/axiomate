import memoize from 'lodash-es/memoize.js'

export type ModelCapabilityOverride =
  | 'effort'
  | 'max_effort'
  | 'thinking'
  | 'adaptive_thinking'
  | 'interleaved_thinking'

const CAPABILITY_OVERRIDES_ENV = 'AXIOMATE_MODEL_CAPABILITY_OVERRIDES'

/**
 * Check whether a model capability override is set.
 *
 * AXIOMATE_MODEL_CAPABILITY_OVERRIDES accepts either:
 * - JSON: {"model-id":["effort","thinking"]}
 * - Inline: model-id=effort,thinking;other-model=adaptive_thinking
 */
export const getModelCapabilityOverride = memoize(
  (model: string, capability: ModelCapabilityOverride): boolean | undefined => {
    const overrides = parseCapabilityOverrides(
      process.env[CAPABILITY_OVERRIDES_ENV],
    )
    if (!overrides) return undefined

    const modelOverride = findModelOverride(overrides, model)
    if (modelOverride === undefined) return undefined

    return overrideHasCapability(modelOverride, capability)
  },
  (model, capability) => `${model.toLowerCase()}:${capability}`,
)

function parseCapabilityOverrides(
  raw: string | undefined,
): Record<string, unknown> | undefined {
  if (!raw?.trim()) return undefined

  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Fall through to the compact inline format.
  }

  const overrides: Record<string, string> = {}
  for (const entry of raw.split(';')) {
    const separator = entry.indexOf('=')
    if (separator === -1) continue
    const model = entry.slice(0, separator).trim()
    const capabilities = entry.slice(separator + 1).trim()
    if (model && capabilities) {
      overrides[model] = capabilities
    }
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined
}

function findModelOverride(
  overrides: Record<string, unknown>,
  model: string,
): unknown {
  const normalized = model.toLowerCase()
  for (const [key, value] of Object.entries(overrides)) {
    if (key.toLowerCase() === normalized) {
      return value
    }
  }
  return undefined
}

function overrideHasCapability(
  override: unknown,
  capability: ModelCapabilityOverride,
): boolean {
  if (Array.isArray(override)) {
    return override.some(
      value =>
        typeof value === 'string' && value.toLowerCase() === capability,
    )
  }

  if (typeof override === 'string') {
    return override
      .toLowerCase()
      .split(',')
      .map(value => value.trim())
      .includes(capability)
  }

  if (override && typeof override === 'object') {
    const capabilityMap = override as Record<string, unknown>
    if (capability in capabilityMap) {
      return capabilityMap[capability] === true
    }
    if ('capabilities' in capabilityMap) {
      return overrideHasCapability(capabilityMap.capabilities, capability)
    }
    return false
  }

  return false
}
