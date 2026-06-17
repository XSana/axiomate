import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import {
  allowToolUse,
  getHarnessCwd,
  makeToolContext,
  mockFileHarnessRuntime,
  parentMessage,
  setupFileHarness,
} from '../FileHarness/helpers.js'

mockFileHarnessRuntime()
setupFileHarness()

// getPlanFilePath/getPlan are resolved per-call from these mocks; the harness
// rewrites planPathState before each ExitPlanMode call so the plan lands in the
// per-test temp cwd.
const planPathState = { path: '' }
vi.mock('../../../../utils/plans.js', () => ({
  getPlan: () => 'Test plan',
  getPlanFilePath: () => planPathState.path,
}))

vi.mock('../../../../utils/teammate.js', () => ({
  getAgentName: () => undefined,
  getTeamName: () => undefined,
  isPlanModeRequired: () => false,
  isTeammate: () => false,
}))

let ExitPlanModeV2Tool: Awaited<
  typeof import('../../../../tools/ExitPlanModeTool/ExitPlanModeV2Tool.js')
>['ExitPlanModeV2Tool']
let FileEditTool: Awaited<
  typeof import('../../../../tools/FileEditTool/FileEditTool.js')
>['FileEditTool']

beforeAll(async () => {
  ;[{ ExitPlanModeV2Tool }, { FileEditTool }] = await Promise.all([
    import('../../../../tools/ExitPlanModeTool/ExitPlanModeV2Tool.js'),
    import('../../../../tools/FileEditTool/FileEditTool.js'),
  ])
}, 120_000)

describe('ExitPlanMode bypass-write read-state sync', () => {
  test('an edited-plan approval lets the implementation phase Edit the plan without a stale/not_read rejection', async () => {
    const planPath = join(getHarnessCwd(), 'edited-plan.md')
    planPathState.path = planPath
    // Pre-existing plan on disk (written earlier in plan mode). The approval
    // dialog edit will overwrite it with CRLF content (Windows writeFile).
    await writeFile(planPath, '# Plan\n\n- old step\n', 'utf8')

    const context = makeToolContext()
    const editedPlan = '# Plan\r\n\r\n- edited step one\r\n- edited step two\r\n'

    // Simulate the approval dialog returning an edited plan: ExitPlanMode writes
    // it to disk directly (bypassing FileWriteTool).
    await ExitPlanModeV2Tool.call(
      { plan: editedPlan } as never,
      context,
      allowToolUse,
      parentMessage,
    )

    // Implementation phase: model edits the plan it just got approved, using the
    // SAME context (read-state must have been synced by ExitPlanMode).
    const result = await FileEditTool.validateInput!(
      {
        file_path: planPath,
        old_string: '- edited step one',
        new_string: '- edited step ONE',
      },
      context,
    )

    expect({
      result: result.result,
      reason:
        result.result === false ? result.fileHarnessFailure?.reason : null,
    }).toEqual({ result: true, reason: null })
  })
})
