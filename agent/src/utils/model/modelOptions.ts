import { getSettings_DEPRECATED } from '../settings/settings.js'
import { isModelAllowed } from './modelAllowlist.js'
import type { ModelSetting } from './model.js'
import { getGlobalConfig } from '../config.js'

export type ModelOption = {
  value: ModelSetting
  label: string
  description: string
  descriptionForModel?: string
}

/**
 * Model options shown in the /model picker. Axiomate is provider-agnostic —
 * the list is populated from the user's config.models in ~/.axiomate.json.
 */
export function getModelOptions(): ModelOption[] {
  const configModels = getGlobalConfig().models
  if (configModels && Object.keys(configModels).length > 0) {
    return Object.entries(configModels).map(([modelId, config]) => ({
      value: modelId,
      label: config.name ?? modelId,
      description:
        config.description ?? `${config.protocol} · ${config.baseUrl}`,
    }))
  }
  return []
}

/**
 * Filter model options by the availableModels allowlist.
 * Always preserves the "Default" option (value: null).
 */
function filterModelOptionsByAllowlist(options: ModelOption[]): ModelOption[] {
  const settings = getSettings_DEPRECATED() || {}
  if (!settings.availableModels) {
    return options
  }
  return options.filter(
    opt =>
      opt.value === null || (opt.value !== null && isModelAllowed(opt.value)),
  )
}

// Re-exported under its old name; callers apply the allowlist filter explicitly.
export { filterModelOptionsByAllowlist }
