import {
  getGlobalConfig,
  saveGlobalConfig,
  type GlobalConfig,
} from '../../utils/config.js'
import {
  DEFAULT_ROUTE_ID,
  normalizeModelRoutingConfig,
  resolveModelChainFromRoute,
} from '../../utils/model/modelRouting.js'
import type { AuxiliaryTaskId } from '../../utils/model/modelRouting.js'
import {
  buildAddRouteFallback,
  buildRemoveRouteFallback,
  buildSetAuxiliaryPrimary,
  buildSetDefaultRoute,
  buildSetRoutePrimary,
} from '../../utils/model/modelRoutePersistence.js'

export type ModelRouteCommandResult =
  | { handled: false }
  | {
      handled: true
      message: string
      activeModel?: string | null
    }

export function handleModelRouteCommand(
  rawArgs: string,
): ModelRouteCommandResult {
  const args = rawArgs.trim()
  if (!args) {
    return { handled: false }
  }

  const parts = args.split(/\s+/)
  const sub = parts[0]

  try {
    switch (sub) {
      case 'route':
        return handleRouteSubcommand(parts.slice(1))
      case 'use':
        return handleUseSubcommand(parts.slice(1))
      case 'default':
        return handleDefaultSubcommand(parts.slice(1))
      case 'fallback':
        return handleFallbackSubcommand(parts.slice(1))
      case 'aux':
        return handleAuxSubcommand(parts.slice(1))
      default:
        return { handled: false }
    }
  } catch (error) {
    return {
      handled: true,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function handleRouteSubcommand(parts: string[]): ModelRouteCommandResult {
  const routeId = parts[0]
  if (!routeId || routeId === 'list' || routeId === 'ls') {
    return {
      handled: true,
      message: renderRoutes(getGlobalConfig()),
    }
  }

  const next = buildSetDefaultRoute(getGlobalConfig(), routeId)
  saveGlobalConfig(() => next)
  return {
    handled: true,
    message: `Set active model route to ${routeId}`,
    activeModel: getRoutePrimary(next, routeId),
  }
}

function handleUseSubcommand(parts: string[]): ModelRouteCommandResult {
  const modelId = parts.join(' ').trim()
  if (!modelId) {
    return {
      handled: true,
      message: 'Usage: /model use <model-id>',
    }
  }
  const current = getGlobalConfig()
  const routeId = normalizeModelRoutingConfig(current).model?.defaultRoute ??
    DEFAULT_ROUTE_ID
  const next = buildSetRoutePrimary(current, routeId, modelId)
  saveGlobalConfig(() => next)
  return {
    handled: true,
    message: `Set route ${routeId} primary to ${modelId}`,
    activeModel: modelId,
  }
}

function handleDefaultSubcommand(parts: string[]): ModelRouteCommandResult {
  const routeId = parts[0]
  if (!routeId) {
    return {
      handled: true,
      message: 'Usage: /model default <route-id>',
    }
  }
  const next = buildSetDefaultRoute(getGlobalConfig(), routeId)
  saveGlobalConfig(() => next)
  return {
    handled: true,
    message: `Set default model route to ${routeId}`,
    activeModel: getRoutePrimary(next, routeId),
  }
}

function handleFallbackSubcommand(parts: string[]): ModelRouteCommandResult {
  const op = parts[0] ?? 'list'
  const current = getGlobalConfig()
  const normalized = normalizeModelRoutingConfig(current)
  const routeId = normalized.model?.defaultRoute ?? DEFAULT_ROUTE_ID

  if (op === 'list' || op === 'ls') {
    const route = normalized.model?.routes?.[routeId]
    if (!route) {
      return {
        handled: true,
        message: `Route ${routeId} is not defined.`,
      }
    }
    const chain = resolveModelChainFromRoute({
      primary: route.primary,
      fallbackChain: route.fallbackChain,
    })
    return {
      handled: true,
      message: `Route ${routeId} chain:\n${chain.map((model, index) => `  ${index}. ${model}`).join('\n')}`,
    }
  }

  const modelId = parts.slice(1).join(' ').trim()
  if (!modelId || (op !== 'add' && op !== 'remove' && op !== 'rm')) {
    return {
      handled: true,
      message:
        'Usage: /model fallback list | /model fallback add <model-id> | /model fallback remove <model-id>',
    }
  }

  const next =
    op === 'add'
      ? buildAddRouteFallback(current, routeId, modelId)
      : buildRemoveRouteFallback(current, routeId, modelId)
  saveGlobalConfig(() => next)
  return {
    handled: true,
    message:
      op === 'add'
        ? `Added ${modelId} to route ${routeId} fallback chain`
        : `Removed ${modelId} from route ${routeId} fallback chain`,
    activeModel: getRoutePrimary(next, routeId),
  }
}

function handleAuxSubcommand(parts: string[]): ModelRouteCommandResult {
  const op = parts[0] ?? 'list'
  const current = getGlobalConfig()
  const normalized = normalizeModelRoutingConfig(current)

  if (op === 'list' || op === 'ls') {
    const auxiliary = normalized.auxiliary ?? {}
    const lines = Object.entries(auxiliary)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([task, policy]) => {
        const chain = resolveModelChainFromRoute({
          primary: policy.primary,
          fallbackChain: policy.fallbackChain,
        })
        return `  ${task}: ${chain.join(' -> ')}`
      })
    return {
      handled: true,
      message: lines.length
        ? `Auxiliary model routes:\n${lines.join('\n')}`
        : 'No auxiliary routes configured.',
    }
  }

  if (op !== 'set') {
    return {
      handled: true,
      message: 'Usage: /model aux list | /model aux set <task> <model-id>',
    }
  }

  const task = parts[1] as AuxiliaryTaskId | undefined
  const modelId = parts.slice(2).join(' ').trim()
  if (!task || !modelId) {
    return {
      handled: true,
      message: 'Usage: /model aux set <task> <model-id>',
    }
  }
  const next = buildSetAuxiliaryPrimary(current, task, modelId)
  saveGlobalConfig(() => next)
  return {
    handled: true,
    message: `Set auxiliary ${task} primary to ${modelId}`,
  }
}

function renderRoutes(config: GlobalConfig): string {
  const normalized = normalizeModelRoutingConfig(config)
  const defaultRoute = normalized.model?.defaultRoute ?? DEFAULT_ROUTE_ID
  const routes = normalized.model?.routes ?? {}
  const lines = Object.entries(routes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([routeId, route]) => {
      const marker = routeId === defaultRoute ? '*' : ' '
      const chain = resolveModelChainFromRoute({
        primary: route.primary,
        fallbackChain: route.fallbackChain,
      })
      return `${marker} ${routeId}: ${chain.join(' -> ')}`
    })

  return lines.length
    ? `Model routes:\n${lines.join('\n')}`
    : 'No model routes configured.'
}

function getRoutePrimary(config: GlobalConfig, routeId: string): string | null {
  const normalized = normalizeModelRoutingConfig(config)
  return normalized.model?.routes?.[routeId]?.primary ?? null
}
