/**
 * Startup cleanup for model references after users hand-edit ~/.axiomate.json.
 *
 * The runtime model contract is route based: concrete model resources live in
 * `models`, main routing lives in `model.routes`, and auxiliary routing lives in
 * `auxiliary`.
 */

import type { AuxiliaryTaskConfig, GlobalConfig, ModelRouteConfig } from '../config.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { jsonStringify } from '../slowOperations.js'
import { getSettingsForSource, updateSettingsForSource } from './settings.js'

export function migrateOrphanModelReferences(): void {
  const config = getGlobalConfig()
  const validIds = new Set(Object.keys(config.models ?? {}))

  const nextConfig = pruneConfigModelReferences(config, validIds)
  if (jsonStringify(nextConfig) !== jsonStringify(config)) {
    saveGlobalConfig(() => nextConfig)
  }

  const settings = getSettingsForSource('userSettings')
  if (!settings) return

  const next: Record<string, unknown> = { ...settings }
  let settingsChanged = false

  if (settings.effortByModel) {
    const cleaned: Record<string, unknown> = {}
    let prunedAny = false
    for (const [id, value] of Object.entries(settings.effortByModel)) {
      if (validIds.has(id)) {
        cleaned[id] = value
      } else {
        prunedAny = true
      }
    }
    if (prunedAny) {
      next.effortByModel = cleaned
      settingsChanged = true
    }
  }

  if (settingsChanged) {
    updateSettingsForSource('userSettings', next as never)
  }
}

function pruneConfigModelReferences(
  config: GlobalConfig,
  validIds: Set<string>,
): GlobalConfig {
  if (validIds.size === 0) {
    return config
  }

  const fallbackPrimary = [...validIds][0]!
  let changed = false

  const routes: Record<string, ModelRouteConfig> = {}
  for (const [routeId, route] of Object.entries(config.model?.routes ?? {})) {
    const nextRoute = pruneRoute(route, validIds, fallbackPrimary)
    routes[routeId] = nextRoute
    changed ||= jsonStringify(nextRoute) !== jsonStringify(route)
  }

  let defaultRoute = config.model?.defaultRoute
  if (defaultRoute && !routes[defaultRoute]) {
    defaultRoute = Object.keys(routes)[0] ?? undefined
    changed = true
  }

  const auxiliary: Record<string, AuxiliaryTaskConfig> = {}
  for (const [task, policy] of Object.entries(config.auxiliary ?? {})) {
    const nextPolicy = pruneRoute(policy, validIds, fallbackPrimary)
    auxiliary[task] = nextPolicy
    changed ||= jsonStringify(nextPolicy) !== jsonStringify(policy)
  }

  if (!changed) {
    return config
  }

  return {
    ...config,
    model: config.model
      ? {
          ...config.model,
          ...(defaultRoute ? { defaultRoute } : {}),
          routes,
        }
      : config.model,
    auxiliary: config.auxiliary ? auxiliary : config.auxiliary,
  }
}

function pruneRoute<T extends ModelRouteConfig>(
  route: T,
  validIds: Set<string>,
  fallbackPrimary: string,
): T {
  const primary = validIds.has(route.primary ?? '')
    ? route.primary
    : fallbackPrimary
  const fallbackChain = (route.fallbackChain ?? []).filter(
    modelId => validIds.has(modelId) && modelId !== primary,
  )
  return {
    ...route,
    primary,
    fallbackChain,
  }
}
