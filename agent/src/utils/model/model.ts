/**
 * Model resolution and display utilities.
 */
import { getMainLoopModelOverride } from '../../bootstrap/state.js'
import { getGlobalConfig } from '../config.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { isModelAllowed } from './modelAllowlist.js'
import { type ModelAlias } from './aliases.js'
import {
  getAuxiliaryTaskPolicyFromConfig,
  getDefaultRouteIdFromConfig,
  getMainRouteFromConfig,
  getModelRouteFromConfig,
  normalizeModelRoutingConfig,
  resolveModelChainFromRoute,
  type AuxiliaryTaskId,
  type ResolvedAuxiliaryTaskPolicy,
  type ResolvedModelRoute,
} from './modelRouting.js'

export type ModelShortName = string
export type ModelName = string
export type ModelSetting = ModelName | ModelAlias | null

function isConfiguredModel(model: ModelSetting | undefined): model is ModelName {
  return typeof model === 'string' && !!getGlobalConfig().models?.[model]
}

/**
 * Get the primary model from the active main route.
 */
function getCurrentModel(): ModelName {
  const config = getGlobalConfig()
  const route = getMainRouteFromConfig(config)
  if (!config.models?.[route.primary]) {
    throw new Error(
      `Main route "${route.id}" primary model "${route.primary}" is not defined in config.models.`,
    )
  }
  return route.primary
}

export function getFastModel(): ModelName {
  const config = getGlobalConfig()
  return getAuxiliaryTaskPolicyFromConfig(config, 'sessionTitle').primary
}

/**
 * Get the model from /model command, --model flag, settings, or config.
 *
 * Priority:
 * 1. Model override during session (from /model command)
 * 2. Model override at startup (from --model flag)
 * 3. Settings (from user's saved settings)
 * 4. model.defaultRoute primary (from ~/.axiomate.json)
 *
 * No implicit fallback outside the normalized route config.
 */
export function getUserSpecifiedModelSetting(): ModelSetting | undefined {
  let specifiedModel: ModelSetting | undefined

  const modelOverride = getMainLoopModelOverride()
  if (isConfiguredModel(modelOverride) || modelOverride === null) {
    specifiedModel = modelOverride
  } else {
    const settings = getSettings_DEPRECATED() || {}
    specifiedModel = isConfiguredModel(settings.model)
      ? settings.model
      : undefined
  }

  if (!specifiedModel) {
    specifiedModel = getDefaultMainLoopModelSetting()
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
  return getAuxiliaryTaskPolicyFromConfig(config, 'goalJudge').primary
}

/**
 * Resolve the model for a non-main-loop "auxiliary" role (e.g. goal judge).
 *
 * `tier` lets the caller decide whether to nudge the user about cost.
 * 'main' = expensive fallback, anything else = OK.
 */
export type AuxiliaryModelTier = 'mid' | 'fast' | 'main'

export function getAuxiliaryModel(_role: 'goalJudge'): {
  model: ModelName
  tier: AuxiliaryModelTier
} {
  const config = getGlobalConfig()
  const policy = getAuxiliaryTaskPolicyFromConfig(config, 'goalJudge')
  const main = getMainRouteFromConfig(config)
  if (policy.primary === main.primary) return { model: policy.primary, tier: 'main' }
  if (policy.recoveryProfile === 'auxiliary-fast') {
    return { model: policy.primary, tier: 'fast' }
  }
  return { model: policy.primary, tier: 'mid' }
}

export function getRuntimeMainLoopModel(params: {
  permissionMode: PermissionMode
  mainLoopModel: string
  exceeds200kTokens?: boolean
}): ModelName {
  return params.mainLoopModel
}

export function getDefaultMainLoopModelSetting(): ModelName | ModelAlias {
  return getMainRouteFromConfig(getGlobalConfig()).primary
}

export function getDefaultMainLoopModel(): ModelName {
  return parseUserSpecifiedModel(getDefaultMainLoopModelSetting())
}

/**
 * Returns the canonical short name for a model ID (lowercased).
 */
export function getCanonicalName(fullModelName: ModelName): ModelShortName {
  return fullModelName.toLowerCase()
}

export function getDefaultModelDescription(): string {
  const config = getGlobalConfig()
  const model = getMainRouteFromConfig(config).primary
  if (!model) return 'unconfigured'
  const name = config.models?.[model]?.name ?? model
  return name
}

export function getDefaultRouteId(): string {
  return getDefaultRouteIdFromConfig(getGlobalConfig())
}

export function getMainRoute(): ResolvedModelRoute {
  return getMainRouteFromConfig(getGlobalConfig())
}

export function getModelRoute(routeId: string): ResolvedModelRoute | undefined {
  return getModelRouteFromConfig(getGlobalConfig(), routeId)
}

export function resolveModelRef(model: ModelName): ModelName {
  const trimmed = parseUserSpecifiedModel(model)
  const config = getGlobalConfig()
  if (!config.models?.[trimmed]) {
    throw new Error(
      `Model "${trimmed}" is not defined in config.models. Add it to ~/.axiomate.json.`,
    )
  }
  return trimmed
}

export function resolveModelChain(route = getMainRoute()): ModelName[] {
  const config = getGlobalConfig()
  return resolveModelChainFromRoute(route).map(model => {
    if (!config.models?.[model]) {
      throw new Error(
        `Model "${model}" is not defined in config.models. Add it to ~/.axiomate.json.`,
      )
    }
    return model
  })
}

export function getMainModelCandidate(index = 0): ModelName {
  const chain = resolveModelChain()
  const model = chain[index]
  if (!model) {
    throw new Error(`No main model candidate exists at index ${index}.`)
  }
  return model
}

export function getAuxiliaryTaskPolicy(
  task: AuxiliaryTaskId,
): ResolvedAuxiliaryTaskPolicy {
  return getAuxiliaryTaskPolicyFromConfig(getGlobalConfig(), task)
}

export function getAuxiliaryTaskModel(task: AuxiliaryTaskId): ModelName {
  return getAuxiliaryTaskPolicy(task).primary
}

export function getNormalizedModelRoutingConfig() {
  return normalizeModelRoutingConfig(getGlobalConfig())
}

export function renderDefaultModelSetting(
  setting: ModelName | ModelAlias,
): string {
  return renderModelName(parseUserSpecifiedModel(setting))
}

export function renderModelSetting(setting: ModelName | ModelAlias): string {
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
 * Parse a user-specified model string. Axiomate has no hardcoded aliases;
 * the input is treated as a config.models key or raw model ID and passed
 * through unchanged (apart from trim).
 */
export function parseUserSpecifiedModel(
  modelInput: ModelName | ModelAlias,
): ModelName {
  return modelInput.trim()
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
