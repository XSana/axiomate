import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { sanitizePath } from '../../../utils/sessionStoragePortable.js'

const state = vi.hoisted(() => ({
  tempDir: '',
  cwd: '',
  sessionId: '',
  counter: 0,
}))

vi.mock('../../../utils/envUtils.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../utils/envUtils.js')>()
  return { ...actual, getConfigHomeDir: () => state.tempDir }
})

vi.mock('../../../bootstrap/state.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../bootstrap/state.js')>()
  return {
    ...actual,
    getOriginalCwd: () => state.cwd,
    getSessionId: () => state.sessionId,
  }
})

vi.mock('../../../utils/goal/goalJudge.js', () => ({
  judgeGoal: vi.fn(),
  DEFAULT_MAX_CONSECUTIVE_PARSE_FAILURES: 3,
}))

import type { UUID } from 'crypto'
import { judgeGoal } from '../../../utils/goal/goalJudge.js'
import { GoalManager } from '../../../utils/goal/goalManager.js'
import {
  dequeue,
  enqueue,
  getCommandQueueSnapshot,
} from '../../../utils/messageQueueManager.js'
import type { AssistantMessage } from '../../../types/message.js'
import type { ToolUseContext } from '../../../Tool.js'
import { handleGoalHook } from '../../../query/goalHook.js'

const mockedJudge = vi.mocked(judgeGoal)

function assistantTextMessage(text: string): AssistantMessage {
  return {
    type: 'assistant',
    uuid: 'aa000000-0000-4000-8000-000000000001' as UUID,
    timestamp: new Date().toISOString(),
    parentUuid: null,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  } as unknown as AssistantMessage
}

function makeCtx(abortController = new AbortController()): ToolUseContext {
  return {
    abortController,
  } as unknown as ToolUseContext
}

async function consume(
  gen: AsyncGenerator<unknown, unknown>,
): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const m of gen) out.push(m)
  return out
}

function drainQueue(): unknown[] {
  const out: unknown[] = []
  let cmd
  while ((cmd = dequeue())) out.push(cmd)
  return out
}

beforeEach(async () => {
  state.counter++
  state.tempDir = await mkdtemp(join(tmpdir(), 'axiomate-goal-hook-'))
  state.cwd = `/tmp/axiomate-goal-hook-cwd-${state.counter}`
  state.sessionId = `00000000-0000-4000-8000-${String(state.counter).padStart(12, '0')}`
  await mkdir(join(state.tempDir, 'projects', sanitizePath(state.cwd)), {
    recursive: true,
  })
  mockedJudge.mockReset()
  drainQueue()
})

afterEach(async () => {
  drainQueue()
  if (state.tempDir) await rm(state.tempDir, { recursive: true, force: true })
})

describe('handleGoalHook — early returns', () => {
  test('no active goal — no judge call, no enqueue, no yield', async () => {
    const msgs = await consume(
      handleGoalHook({
        assistantMessages: [assistantTextMessage('whatever')],
        toolUseContext: makeCtx(),
      }),
    )
    expect(msgs).toEqual([])
    expect(mockedJudge).not.toHaveBeenCalled()
    expect(getCommandQueueSnapshot()).toHaveLength(0)
  })

  test('real user message queued — defers (no judge, no enqueue)', async () => {
    const mgr = await GoalManager.load(state.sessionId as UUID)
    await mgr.set('do thing', { maxTurns: 10 })
    enqueue({ value: 'user typed something', mode: 'prompt' })

    const msgs = await consume(
      handleGoalHook({
        assistantMessages: [assistantTextMessage('finished a step')],
        toolUseContext: makeCtx(),
      }),
    )
    expect(msgs).toEqual([])
    expect(mockedJudge).not.toHaveBeenCalled()
    // Queue still has the real user message.
    expect(getCommandQueueSnapshot()).toHaveLength(1)
  })

  test('queued slash command does NOT count as real message', async () => {
    mockedJudge.mockResolvedValue({
      verdict: 'continue',
      reason: 'still going',
      parseFailed: false,
    })
    const mgr = await GoalManager.load(state.sessionId as UUID)
    await mgr.set('do thing', { maxTurns: 10 })
    enqueue({ value: '/subgoal add foo', mode: 'prompt' })

    await consume(
      handleGoalHook({
        assistantMessages: [assistantTextMessage('progress')],
        toolUseContext: makeCtx(),
      }),
    )
    expect(mockedJudge).toHaveBeenCalledTimes(1)
  })

  test('empty assistant response & not interrupted — bail without judge', async () => {
    const mgr = await GoalManager.load(state.sessionId as UUID)
    await mgr.set('x', { maxTurns: 10 })
    await consume(
      handleGoalHook({
        assistantMessages: [assistantTextMessage('   ')],
        toolUseContext: makeCtx(),
      }),
    )
    expect(mockedJudge).not.toHaveBeenCalled()
  })
})

describe('handleGoalHook — interrupted path', () => {
  test('aborted controller → pause without judge call, isMeta verdict msg', async () => {
    const mgr = await GoalManager.load(state.sessionId as UUID)
    await mgr.set('long task', { maxTurns: 99 })

    const ctrl = new AbortController()
    ctrl.abort()

    const msgs = (await consume(
      handleGoalHook({
        assistantMessages: [assistantTextMessage('partial')],
        toolUseContext: makeCtx(ctrl),
      }),
    )) as Array<{
      type: string
      subtype?: string
      content?: string
      isMeta?: boolean
    }>
    expect(mockedJudge).not.toHaveBeenCalled()
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.type).toBe('system')
    expect(msgs[0]!.subtype).toBe('informational')
    expect(msgs[0]!.isMeta).toBe(true)
    expect(msgs[0]!.content).toContain('interrupted')

    // Persisted: state should now be paused with Ctrl+C reason
    const reloaded = await GoalManager.load(state.sessionId as UUID)
    expect(reloaded.state?.status).toBe('paused')
    expect(reloaded.state?.pausedReason).toContain('Ctrl+C')
  })
})

describe('handleGoalHook — continue path enqueues continuation', () => {
  test('verdict=continue → enqueue continuation prompt with priority next', async () => {
    mockedJudge.mockResolvedValue({
      verdict: 'continue',
      reason: 'partial progress',
      parseFailed: false,
    })
    const mgr = await GoalManager.load(state.sessionId as UUID)
    await mgr.set('write fib', { maxTurns: 10 })

    const msgs = (await consume(
      handleGoalHook({
        assistantMessages: [assistantTextMessage('wrote some')],
        toolUseContext: makeCtx(),
      }),
    )) as Array<{ content?: string; isMeta?: boolean }>
    expect(mockedJudge).toHaveBeenCalledTimes(1)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.isMeta).toBe(true)
    expect(msgs[0]!.content).toContain('Continuing toward goal (1/10)')

    const queue = getCommandQueueSnapshot()
    expect(queue).toHaveLength(1)
    expect(queue[0]!.priority).toBe('next')
    expect(typeof queue[0]!.value === 'string' ? queue[0]!.value : '').toContain(
      'Continuing toward your standing goal',
    )
  })

  test('verdict=done → no enqueue, ✓ message yielded', async () => {
    mockedJudge.mockResolvedValue({
      verdict: 'done',
      reason: 'shipped',
      parseFailed: false,
    })
    const mgr = await GoalManager.load(state.sessionId as UUID)
    await mgr.set('ship', { maxTurns: 10 })

    const msgs = (await consume(
      handleGoalHook({
        assistantMessages: [assistantTextMessage('shipped')],
        toolUseContext: makeCtx(),
      }),
    )) as Array<{ content?: string }>
    expect(msgs[0]!.content).toBe('✓ Goal achieved: shipped')
    expect(getCommandQueueSnapshot()).toHaveLength(0)
  })
})
