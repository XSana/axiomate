import type { ModelName } from './model.js'

// Canonical model ID strings. These are the firstParty Anthropic model IDs
// used as internal identifiers and final fallback values. User-configured
// models from ~/.axiomate.json take precedence over these.

export type ModelConfig = ModelName

export const ALL_MODEL_CONFIGS = {
  haiku35: 'claude-3-5-haiku-20241022',
  haiku45: 'claude-haiku-4-5-20251001',
  sonnet35: 'claude-3-5-sonnet-20241022',
  sonnet37: 'claude-3-7-sonnet-20250219',
  sonnet40: 'claude-sonnet-4-20250514',
  sonnet45: 'claude-sonnet-4-5-20250929',
  sonnet46: 'claude-sonnet-4-6',
  opus40: 'claude-opus-4-20250514',
  opus41: 'claude-opus-4-1-20250805',
  opus45: 'claude-opus-4-5-20251101',
  opus46: 'claude-opus-4-6',
} as const satisfies Record<string, ModelConfig>

export type ModelKey = keyof typeof ALL_MODEL_CONFIGS

/** Union of all canonical model IDs */
export type CanonicalModelId = (typeof ALL_MODEL_CONFIGS)[ModelKey]

/** Runtime list of canonical model IDs — used by comprehensiveness tests. */
export const CANONICAL_MODEL_IDS = Object.values(ALL_MODEL_CONFIGS) as [CanonicalModelId, ...CanonicalModelId[]]

/** Map canonical ID → internal short key. Used to apply settings-based modelOverrides. */
export const CANONICAL_ID_TO_KEY: Record<CanonicalModelId, ModelKey> =
  Object.fromEntries(
    (Object.entries(ALL_MODEL_CONFIGS) as [ModelKey, ModelConfig][]).map(
      ([key, cfg]) => [cfg, key],
    ),
  ) as Record<CanonicalModelId, ModelKey>
