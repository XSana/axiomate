import { describe, expect, test, vi } from 'vitest'

import { ExitPlanModeV2Tool } from '../../../../tools/ExitPlanModeTool/ExitPlanModeV2Tool.js'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../../../../Tool.js'
import type { AppState } from '../../../../state/AppStateStore.js'

vi.mock('../../../../utils/plans.js', () => ({
  getPlan: () => 'Test plan',
  getPlanFilePath: () => 'C:/tmp/plan.md',
}))

vi.mock('../../../../utils/teammate.js', () => ({
  getAgentName: () => undefined,
  getTeamName: () => undefined,
  isPlanModeRequired: () => false,
  isTeammate: () => false,
}))

function makeContext(initialMode: 'plan' | 'bypassPermissions'): {
  context: ToolUseContext
  getState: () => AppState
} {
  let state = {
    toolPermissionContext: {
      ...getEmptyToolPermissionContext(),
      mode: initialMode,
      prePlanMode: 'bypassPermissions',
    },
  } as AppState

  return {
    context: {
      agentId: undefined,
      options: {
        tools: [],
      },
      getAppState: () => state,
      setAppState: (updater: (prev: AppState) => AppState) => {
        state = updater(state)
      },
    } as unknown as ToolUseContext,
    getState: () => state,
  }
}

describe('ExitPlanModeV2Tool', () => {
  test('rejects approved exit mode from model-facing input', () => {
    expect(
      ExitPlanModeV2Tool.inputSchema.safeParse({
        _approvedExitMode: 'bypassPermissions',
      }).success,
    ).toBe(false)
  })

  test('accepts approved exit mode from permission-updated input', () => {
    expect(
      ExitPlanModeV2Tool.permissionUpdatedInputSchema?.safeParse({
        _approvedExitMode: 'bypassPermissions',
      }).success,
    ).toBe(true)
  })

  test('applies the approved exit mode after successful plan approval', async () => {
    const { context, getState } = makeContext('plan')

    await ExitPlanModeV2Tool.call(
      { _approvedExitMode: 'default' } as never,
      context,
      async () => ({ behavior: 'allow' }),
      {} as never,
    )

    expect(getState().toolPermissionContext.mode).toBe('default')
    expect(getState().toolPermissionContext.prePlanMode).toBeUndefined()
  })

  test('keeps an already-applied mode when no approved exit mode is provided', async () => {
    const { context, getState } = makeContext('bypassPermissions')

    await ExitPlanModeV2Tool.call(
      {},
      context,
      async () => ({ behavior: 'allow' }),
      {} as never,
    )

    expect(getState().toolPermissionContext.mode).toBe('bypassPermissions')
    expect(getState().toolPermissionContext.prePlanMode).toBeUndefined()
  })
})
