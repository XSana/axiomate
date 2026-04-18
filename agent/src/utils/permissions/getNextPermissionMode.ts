import type { ToolPermissionContext } from '../../Tool.js'
import type { PermissionMode } from './PermissionMode.js'
import { transitionPermissionMode } from './permissionSetup.js'

/**
 * Determines the next permission mode when cycling through modes with Shift+Tab.
 */
export function getNextPermissionMode(
  toolPermissionContext: ToolPermissionContext,
  _teamContext?: { leadAgentId: string },
): PermissionMode {
  switch (toolPermissionContext.mode) {
    case 'default':
      return 'acceptEdits'

    case 'acceptEdits':
      return 'plan'

    case 'plan':
      return 'bypassPermissions'

    case 'bypassPermissions':
      return 'default'

    case 'dontAsk':
      // Not exposed in UI cycle yet, but return default if somehow reached
      return 'default'

    default:
      // Covers any future modes — always fall back to default
      return 'default'
  }
}

/**
 * Computes the next permission mode and prepares the context for it.
 */
export function cyclePermissionMode(
  toolPermissionContext: ToolPermissionContext,
  teamContext?: { leadAgentId: string },
): { nextMode: PermissionMode; context: ToolPermissionContext } {
  const nextMode = getNextPermissionMode(toolPermissionContext, teamContext)
  return {
    nextMode,
    context: transitionPermissionMode(
      toolPermissionContext.mode,
      nextMode,
      toolPermissionContext,
    ),
  }
}
