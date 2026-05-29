import {
  getGlobalConfig,
  saveGlobalConfig,
  type AuxiliaryTaskConfig,
  type GlobalConfig,
  type ModelRouteConfig,
} from '../config.js'
import {
  DEFAULT_MAIN_ALLOW_ACTIONS,
  DEFAULT_MAIN_SWITCH_MODEL_ON,
  DEFAULT_ROUTE_ID,
  normalizeModelRoutingConfig,
} from './modelRouting.js'
import type { AuxiliaryTaskId } from './modelRouting.js'

export function buildSinglePrimaryMainRoute(
  current: GlobalConfig,
  modelId: string,
): GlobalConfig {
  const normalized = normalizeModelRoutingConfig(current)
  const routeId = normalized.model?.defaultRoute ?? DEFAULT_ROUTE_ID
  const existingRoute = normalized.model?.routes?.[routeId]

  return normalizeModelRoutingConfig({
    ...normalized,
    model: {
      ...normalized.model,
      defaultRoute: routeId,
      routes: {
        ...(normalized.model?.routes ?? {}),
        [routeId]: nextRouteForPrimary(existingRoute, modelId),
      },
    },
  })
}

export function buildSetDefaultRoute(
  current: GlobalConfig,
  routeId: string,
): GlobalConfig {
  const normalized = normalizeModelRoutingConfig(current)
  const existingRoute = normalized.model?.routes?.[routeId]
  if (!existingRoute) {
    throw new Error(`Route "${routeId}" is not defined in model.routes.`)
  }
  return normalizeModelRoutingConfig({
    ...normalized,
    model: {
      ...normalized.model,
      defaultRoute: routeId,
    },
  })
}

export function buildSetRoutePrimary(
  current: GlobalConfig,
  routeId: string,
  modelId: string,
): GlobalConfig {
  assertModelExists(current, modelId)
  const normalized = normalizeModelRoutingConfig(current)
  const existingRoute = normalized.model?.routes?.[routeId]
  return normalizeModelRoutingConfig({
    ...normalized,
    model: {
      ...normalized.model,
      defaultRoute: normalized.model?.defaultRoute ?? routeId,
      routes: {
        ...(normalized.model?.routes ?? {}),
        [routeId]: nextRouteForPrimary(existingRoute, modelId),
      },
    },
  })
}

export function buildAddRouteFallback(
  current: GlobalConfig,
  routeId: string,
  modelId: string,
): GlobalConfig {
  assertModelExists(current, modelId)
  const normalized = normalizeModelRoutingConfig(current)
  const route = normalized.model?.routes?.[routeId]
  if (!route) {
    throw new Error(`Route "${routeId}" is not defined in model.routes.`)
  }
  if (route.primary === modelId) {
    throw new Error(`Model "${modelId}" is already the primary for route "${routeId}".`)
  }
  const fallbackChain = uniqueStrings([
    ...(route.fallbackChain ?? []),
    modelId,
  ]).filter(candidate => candidate !== route.primary)
  return normalizeModelRoutingConfig({
    ...normalized,
    model: {
      ...normalized.model,
      routes: {
        ...(normalized.model?.routes ?? {}),
        [routeId]: {
          ...route,
          fallbackChain,
        },
      },
    },
  })
}

export function buildRemoveRouteFallback(
  current: GlobalConfig,
  routeId: string,
  modelId: string,
): GlobalConfig {
  const normalized = normalizeModelRoutingConfig(current)
  const route = normalized.model?.routes?.[routeId]
  if (!route) {
    throw new Error(`Route "${routeId}" is not defined in model.routes.`)
  }
  return normalizeModelRoutingConfig({
    ...normalized,
    model: {
      ...normalized.model,
      routes: {
        ...(normalized.model?.routes ?? {}),
        [routeId]: {
          ...route,
          fallbackChain: (route.fallbackChain ?? []).filter(
            candidate => candidate !== modelId,
          ),
        },
      },
    },
  })
}

export function buildSetAuxiliaryPrimary(
  current: GlobalConfig,
  task: AuxiliaryTaskId,
  modelId: string,
): GlobalConfig {
  assertModelExists(current, modelId)
  const normalized = normalizeModelRoutingConfig(current)
  const existing = normalized.auxiliary?.[task]
  const nextTask: AuxiliaryTaskConfig = {
    ...existing,
    primary: modelId,
    fallbackChain: (existing?.fallbackChain ?? []).filter(
      candidate => candidate !== modelId,
    ),
  }
  return normalizeModelRoutingConfig({
    ...normalized,
    auxiliary: {
      ...(normalized.auxiliary ?? {}),
      [task]: nextTask,
    },
  })
}

export function persistMainRoutePrimary(modelId: string): void {
  saveGlobalConfig(current => buildSinglePrimaryMainRoute(current, modelId))
}

export function getPersistedMainRoutePrimary(): string | null {
  const normalized = normalizeModelRoutingConfig(getGlobalConfig())
  const routeId = normalized.model?.defaultRoute ?? DEFAULT_ROUTE_ID
  return normalized.model?.routes?.[routeId]?.primary ?? null
}

function nextRouteForPrimary(
  existingRoute: ModelRouteConfig | undefined,
  modelId: string,
): ModelRouteConfig {
  return {
    ...existingRoute,
    primary: modelId,
    fallbackChain: (existingRoute?.fallbackChain ?? []).filter(
      candidate => candidate !== modelId,
    ),
    recoveryProfile: existingRoute?.recoveryProfile ?? 'main-agent',
    allowActions: existingRoute?.allowActions ?? DEFAULT_MAIN_ALLOW_ACTIONS,
    switchModelOn: existingRoute?.switchModelOn ?? DEFAULT_MAIN_SWITCH_MODEL_ON,
  }
}

function assertModelExists(config: GlobalConfig, modelId: string): void {
  if (!config.models?.[modelId]) {
    throw new Error(`Model "${modelId}" is not defined in models.`)
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}
