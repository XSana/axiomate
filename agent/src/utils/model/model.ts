/**
 * Model resolution and display utilities.
 */
import { getMainLoopModelOverride } from '../../bootstrap/state.js'
import { getGlobalConfig } from '../config.js'
import {
  has1mContext,
} from '../context.js'
import { resolveOverriddenModel } from './modelStrings.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { isModelAllowed } from './modelAllowlist.js'
import { type ModelAlias, isModelAlias } from './aliases.js'
import { capitalize } from '../stringUtils.js'

export type ModelShortName = string
export type ModelName = string
export type ModelSetting = ModelName | ModelAlias | null

/**
 * Get the user's current model. This is the primary model configured in ~/.axiomate.json.
 * Throws if no models are configured at all.
 */
function getCurrentModel(): ModelName {
  const config = getGlobalConfig()
  if (config.currentModel && config.models?.[config.currentModel]) return config.currentModel
  const firstModel = Object.keys(config.models ?? {})[0]
  if (firstModel) return firstModel
  throw new Error('No models configured. Add models to ~/.axiomate.json')
}

export function getFastModel(): ModelName {
  const config = getGlobalConfig()
  if (config.fastModel && config.models?.[config.fastModel]) return config.fastModel
  return getCurrentModel()
}

/** Always returns false — axiomate uses user-configured models only. */
export function isNonCustomOpusModel(_model: ModelName): boolean {
  return false
}

/**
 * Get the model from /model command, --model flag, settings, or config.
 *
 * Priority:
 * 1. Model override during session (from /model command)
 * 2. Model override at startup (from --model flag)
 * 3. Settings (from user's saved settings)
 * 4. config.currentModel (from ~/.axiomate.json)
 * 5. First model in config.models
 */
export function getUserSpecifiedModelSetting(): ModelSetting | undefined {
  let specifiedModel: ModelSetting | undefined

  const modelOverride = getMainLoopModelOverride()
  if (modelOverride !== undefined) {
    specifiedModel = modelOverride
  } else {
    const settings = getSettings_DEPRECATED() || {}
    specifiedModel = settings.model || undefined
  }

  if (!specifiedModel) {
    const config = getGlobalConfig()
    specifiedModel = config.currentModel ?? undefined
    if (!specifiedModel && config.models) {
      const firstModelId = Object.keys(config.models)[0]
      if (firstModelId) {
        specifiedModel = firstModelId
      }
    }
  }

  if (specifiedModel && !isModelAllowed(specifiedModel)) {
    return undefined
  }

  return specifiedModel
}

export function getMainLoopModel(): ModelName {
  const model = getUserSpecifiedModelSetting()
  if (model !== undefined && model !== null) {
    return parseUserSpecifiedModel(model)
  }
  return getDefaultMainLoopModel()
}

export function getBestModel(): ModelName {
  return getDefaultMainLoopModel()
}

export function getMidModel(): ModelName {
  const config = getGlobalConfig()
  if (config.midModel && config.models?.[config.midModel]) return config.midModel
  return getCurrentModel()
}

export function getRuntimeMainLoopModel(params: {
  permissionMode: PermissionMode
  mainLoopModel: string
  exceeds200kTokens?: boolean
}): ModelName {
  return params.mainLoopModel
}

export function getDefaultMainLoopModelSetting(): ModelName | ModelAlias {
  return getCurrentModel()
}

export function getDefaultMainLoopModel(): ModelName {
  return parseUserSpecifiedModel(getDefaultMainLoopModelSetting())
}

/**
 * Returns the canonical short name for a model ID.
 * For user-configured models, just returns the model ID as-is.
 */
export function firstPartyNameToCanonical(name: ModelName): ModelShortName {
  return name.toLowerCase()
}

export function getCanonicalName(fullModelName: ModelName): ModelShortName {
  return firstPartyNameToCanonical(resolveOverriddenModel(fullModelName))
}

export function getClaudeAiUserDefaultModelDescription(): string {
  const config = getGlobalConfig()
  const model = config.currentModel ?? Object.keys(config.models ?? {})[0] ?? 'unknown'
  const name = config.models?.[model]?.name ?? model
  return name
}

export function renderDefaultModelSetting(
  setting: ModelName | ModelAlias,
): string {
  return renderModelName(parseUserSpecifiedModel(setting))
}

export function getOpus46PricingSuffix(): string {
  return ''
}

export function isOpus1mMergeEnabled(): boolean {
  return false
}

export function renderModelSetting(setting: ModelName | ModelAlias): string {
  if (isModelAlias(setting)) {
    return capitalize(setting)
  }
  return renderModelName(setting)
}

export function getPublicModelDisplayName(model: ModelName): string | null {
  const userConfig = getGlobalConfig().models?.[model]
  if (userConfig?.name) {
    return userConfig.name
  }
  return null
}

export function renderModelName(model: ModelName): string {
  const publicName = getPublicModelDisplayName(model)
  if (publicName) {
    return publicName
  }
  return model
}

export function getPublicModelName(model: ModelName): string {
  const publicName = getPublicModelDisplayName(model)
  return publicName ?? model
}

/**
 * Resolve model input. Model aliases (sonnet, opus, haiku, best) map
 * to the user's configured currentModel/midModel/fastModel.
 */
export function parseUserSpecifiedModel(
  modelInput: ModelName | ModelAlias,
): ModelName {
  const modelInputTrimmed = modelInput.trim()
  const normalizedModel = modelInputTrimmed.toLowerCase()

  const has1mTag = has1mContext(normalizedModel)
  const modelString = has1mTag
    ? normalizedModel.replace(/\[1m]$/i, '').trim()
    : normalizedModel

  if (isModelAlias(modelString)) {
    switch (modelString) {
      case 'sonnet':
      case 'opusplan':
        return getMidModel() + (has1mTag ? '[1m]' : '')
      case 'haiku':
        return getFastModel() + (has1mTag ? '[1m]' : '')
      case 'opus':
        return getDefaultMainLoopModel() + (has1mTag ? '[1m]' : '')
      case 'best':
        return getBestModel()
      default:
    }
  }

  if (has1mTag) {
    return modelInputTrimmed.replace(/\[1m\]$/i, '').trim() + '[1m]'
  }
  return modelInputTrimmed
}

export function resolveSkillModelOverride(
  skillModel: string,
  _currentModel: string,
): string {
  return skillModel
}

export function isLegacyModelRemapEnabled(): boolean {
  return false
}

export function modelDisplayString(model: ModelSetting): string {
  if (model === null) {
    return `Default (${getDefaultMainLoopModel()})`
  }
  const resolvedModel = parseUserSpecifiedModel(model)
  return model === resolvedModel ? resolvedModel : `${model} (${resolvedModel})`
}

export function getMarketingNameForModel(modelId: string): string | undefined {
  return getGlobalConfig().models?.[modelId]?.name ?? undefined
}

export function normalizeModelStringForAPI(model: string): string {
  return model.replace(/\[(1|2)m\]/gi, '')
}
