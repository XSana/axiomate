/**
 * Behavior-only tests for `maybeSnapshotBeforeToolCall` — the
 * action-triggered file-history snapshot gate that runs before each
 * tool call inside `runToolUse`.
 *
 * Contract under test:
 *   1. Read-only tools never trigger a snapshot.
 *   2. The first non-readonly tool of a turn triggers exactly one snapshot.
 *   3. Subsequent non-readonly tools in the same turn dedup (no extra
 *      snapshot) — keyed by the user message UUID.
 *   4. Without a resolvable user message in the messages list, no
 *      snapshot is taken.
 *   5. When fileHistory is disabled, no snapshot is taken regardless.
 *
 * We stub `fileHistoryMakeSnapshot` so we can count invocations without
 * spinning up the shadow-git pipeline; the gating logic is what's being
 * exercised.
 */
import { randomUUID, type UUID } from 'crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { MakeSnapshotResult } from '../../../../utils/fileHistory.js'

const makeSnapshotCalls: Array<{ messageId: UUID }> = []
const makeSnapshotResults: MakeSnapshotResult[] = []

vi.mock('../../../../utils/fileHistory.js', async () => {
  return {
    fileHistoryEnabled: () =>
      process.env.AXIOMATE_CODE_DISABLE_FILE_CHECKPOINTING !== '1',
    fileHistoryMakeSnapshot: vi.fn(
      async (_updater: unknown, messageId: UUID) => {
        makeSnapshotCalls.push({ messageId })
        return makeSnapshotResults.shift() ?? { ok: true, hash: 'hash' }
      },
    ),
  }
})

import { maybeSnapshotBeforeToolCall } from '../../../../services/tools/toolExecution.js'
import type { Tool, ToolUseContext } from '../../../../Tool.js'
import type { Message, UserMessage } from '../../../../types/message.js'
import type { FileHistoryState, FileHistorySnapshot } from '../../../../utils/fileHistory.js'

const uuid = (): UUID => randomUUID()

function userMessage(text = 'hi'): UserMessage {
  return {
    type: 'user',
    uuid: uuid(),
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: text },
  }
}

function fakeTool(opts: { isReadOnly: boolean }): Tool {
  return {
    name: 'fake',
    isReadOnly: () => opts.isReadOnly,
  } as unknown as Tool
}

function makeCtx(opts: {
  messages: Message[]
  fileHistory?: FileHistoryState
  appendSystemMessage?: ToolUseContext['appendSystemMessage']
}): ToolUseContext {
  let fh: FileHistoryState = opts.fileHistory ?? {
    snapshotMessageIds: new Set(),
    checkpointLabelsByHash: new Map(),
    trackedFiles: new Set<string>(),
    snapshotSequence: 0,
  }
  return {
    messages: opts.messages,
    setAppState: (f: (prev: never) => never) => {
      const prev = { fileHistory: fh } as never
      const next = f(prev) as { fileHistory: FileHistoryState }
      fh = next.fileHistory
    },
    getAppState: () => ({ fileHistory: fh }) as never,
    appendSystemMessage: opts.appendSystemMessage,
  } as unknown as ToolUseContext
}

beforeEach(() => {
  makeSnapshotCalls.length = 0
  makeSnapshotResults.length = 0
  delete process.env.AXIOMATE_CODE_DISABLE_FILE_CHECKPOINTING
})

afterEach(() => {
  delete process.env.AXIOMATE_CODE_DISABLE_FILE_CHECKPOINTING
})

describe('maybeSnapshotBeforeToolCall — gating', () => {
  test('read-only tool does NOT trigger a snapshot', async () => {
    const ctx = makeCtx({ messages: [userMessage()] })
    await maybeSnapshotBeforeToolCall(fakeTool({ isReadOnly: true }), {}, ctx)
    expect(makeSnapshotCalls).toHaveLength(0)
  })

  test('first non-readonly tool of a turn triggers exactly one snapshot', async () => {
    const u = userMessage()
    const ctx = makeCtx({ messages: [u] })
    await maybeSnapshotBeforeToolCall(fakeTool({ isReadOnly: false }), {}, ctx)
    expect(makeSnapshotCalls).toHaveLength(1)
    expect(makeSnapshotCalls[0]!.messageId).toBe(u.uuid)
  })

  test('second non-readonly tool in the same turn deduplicates', async () => {
    const u = userMessage()
    // Pretend the first snapshot already landed: state already carries
    // an entry keyed by the user message uuid.
    const fileHistory: FileHistoryState = {
      snapshotMessageIds: new Set([u.uuid]),
      checkpointLabelsByHash: new Map(),
      trackedFiles: new Set<string>(),
      snapshotSequence: 1,
    }
    const ctx = makeCtx({ messages: [u], fileHistory })
    await maybeSnapshotBeforeToolCall(fakeTool({ isReadOnly: false }), {}, ctx)
    expect(makeSnapshotCalls).toHaveLength(0)
  })

  test('no resolvable user message → no snapshot', async () => {
    // assistant-only / tool_result-only message stream — nothing the
    // selectableUserMessagesFilter accepts as a turn anchor.
    const ctx = makeCtx({ messages: [] })
    await maybeSnapshotBeforeToolCall(fakeTool({ isReadOnly: false }), {}, ctx)
    expect(makeSnapshotCalls).toHaveLength(0)
  })

  test('disabled fileHistory short-circuits even for write tools', async () => {
    process.env.AXIOMATE_CODE_DISABLE_FILE_CHECKPOINTING = '1'
    const ctx = makeCtx({ messages: [userMessage()] })
    await maybeSnapshotBeforeToolCall(fakeTool({ isReadOnly: false }), {}, ctx)
    expect(makeSnapshotCalls).toHaveLength(0)
  })

  test('uses the most recent user message uuid as the dedup key', async () => {
    const oldUser = userMessage('first turn')
    const newUser = userMessage('second turn')
    const ctx = makeCtx({ messages: [oldUser, newUser] })
    await maybeSnapshotBeforeToolCall(fakeTool({ isReadOnly: false }), {}, ctx)
    expect(makeSnapshotCalls).toHaveLength(1)
    expect(makeSnapshotCalls[0]!.messageId).toBe(newUser.uuid)
  })

  test('shows a warning on first too-many-files detection', async () => {
    makeSnapshotResults.push({
      ok: false,
      reason: 'too-many-files',
      maxFiles: 200_000,
      firstDetection: true,
    })
    const appendSystemMessage = vi.fn()
    const ctx = makeCtx({
      messages: [userMessage()],
      appendSystemMessage,
    })

    await maybeSnapshotBeforeToolCall(fakeTool({ isReadOnly: false }), {}, ctx)

    expect(appendSystemMessage).toHaveBeenCalledTimes(1)
    expect(appendSystemMessage.mock.calls[0]![0]).toMatchObject({
      type: 'system',
      subtype: 'informational',
      level: 'warning',
    })
    expect(appendSystemMessage.mock.calls[0]![0].content).toContain(
      '200,000',
    )
  })

  test('does not repeat warning for cached too-many-files results', async () => {
    makeSnapshotResults.push({
      ok: false,
      reason: 'too-many-files',
      maxFiles: 200_000,
      firstDetection: false,
    })
    const appendSystemMessage = vi.fn()
    const ctx = makeCtx({
      messages: [userMessage()],
      appendSystemMessage,
    })

    await maybeSnapshotBeforeToolCall(fakeTool({ isReadOnly: false }), {}, ctx)

    expect(appendSystemMessage).not.toHaveBeenCalled()
  })
})
