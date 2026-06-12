import { randomUUID } from 'crypto'
import type { UUID } from 'crypto'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, test } from 'vitest'

import {
  resetStateForTests,
  setOriginalCwd,
  switchSession,
} from '../../../bootstrap/state.js'
import {
  buildConversationChain,
  doesMessageExistInSession,
  flushSessionStorage,
  loadTranscriptFile,
  PartialAssistantTracker,
  pickConversationHead,
  resetProjectForTesting,
  setSessionFileForTesting,
} from '../../../utils/sessionStorage.js'
import { asSessionId } from '../../../types/ids.js'

const tempDirs: string[] = []
const originalTestPersistence = process.env.TEST_ENABLE_SESSION_PERSISTENCE

function baseMessageFields(sessionId: UUID, uuid: UUID, timestamp: string) {
  return {
    uuid,
    timestamp,
    sessionId,
    userType: 'external',
    entrypoint: 'cli',
    cwd: '/tmp/project',
    version: 'test',
    isSidechain: false,
    gitBranch: 'main',
  }
}

function userEntry(args: {
  sessionId: UUID
  uuid: UUID
  parentUuid: UUID | null
  timestamp: string
  content: string
}) {
  return {
    parentUuid: args.parentUuid,
    ...baseMessageFields(args.sessionId, args.uuid, args.timestamp),
    type: 'user',
    message: {
      role: 'user',
      content: args.content,
    },
  }
}

function assistantEntry(args: {
  sessionId: UUID
  uuid: UUID
  parentUuid: UUID
  timestamp: string
  content: string
}) {
  return {
    parentUuid: args.parentUuid,
    ...baseMessageFields(args.sessionId, args.uuid, args.timestamp),
    type: 'assistant',
    message: {
      id: randomUUID(),
      type: 'message',
      role: 'assistant',
      model: 'test',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: null,
      content: [{ type: 'text', text: args.content }],
    },
  }
}

async function writeJsonl(entries: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'axiomate-partial-assistant-'))
  tempDirs.push(dir)
  const file = join(dir, `${randomUUID()}.jsonl`)
  await writeFile(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n')
  return file
}

async function loadChain(file: string) {
  const { messages, leafUuids, conversationHead } = await loadTranscriptFile(file)
  const leaf = pickConversationHead({
    messages,
    leafUuids,
    conversationHead,
    leafPredicate: msg => msg.type === 'user' || msg.type === 'assistant',
  })
  if (!leaf) throw new Error('No leaf')
  return buildConversationChain(messages, leaf)
}

afterEach(async () => {
  await flushSessionStorage().catch(() => {})
  resetProjectForTesting()
  resetStateForTests()
  if (originalTestPersistence === undefined) {
    delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
  } else {
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = originalTestPersistence
  }
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('partial assistant transcript recovery', () => {
  test('uses the latest partial assistant when the user message is still the leaf', async () => {
    const sessionId = randomUUID()
    const userUuid = randomUUID()
    const file = await writeJsonl([
      userEntry({
        sessionId,
        uuid: userUuid,
        parentUuid: null,
        timestamp: '2026-06-10T10:00:00.000Z',
        content: 'start work',
      }),
      {
        type: 'partial-assistant',
        sessionId,
        parentUuid: userUuid,
        uuid: randomUUID(),
        timestamp: '2026-06-10T10:00:01.000Z',
        blocks: [{ text: 'I inspected' }],
      },
      {
        type: 'partial-assistant',
        sessionId,
        parentUuid: userUuid,
        uuid: randomUUID(),
        timestamp: '2026-06-10T10:00:02.000Z',
        blocks: [{ text: 'I inspected the session storage path\n  ' }],
      },
    ])

    const chain = await loadChain(file)
    const last = chain.at(-1)

    expect(chain.map(m => m.type)).toEqual(['user', 'assistant'])
    expect(last?.type).toBe('assistant')
    expect(last?.parentUuid).toBe(userUuid)
    if (last?.type !== 'assistant') throw new Error('Expected assistant leaf')
    expect(last.message.content).toEqual([
      { type: 'text', text: 'I inspected the session storage path\n  ' },
    ])
  })

  test('ignores partial assistant once a real child message exists', async () => {
    const sessionId = randomUUID()
    const userUuid = randomUUID()
    const assistantUuid = randomUUID()
    const file = await writeJsonl([
      userEntry({
        sessionId,
        uuid: userUuid,
        parentUuid: null,
        timestamp: '2026-06-10T10:00:00.000Z',
        content: 'start work',
      }),
      {
        type: 'partial-assistant',
        sessionId,
        parentUuid: userUuid,
        uuid: randomUUID(),
        timestamp: '2026-06-10T10:00:01.000Z',
        blocks: [{ text: 'incomplete text' }],
      },
      assistantEntry({
        sessionId,
        uuid: assistantUuid,
        parentUuid: userUuid,
        timestamp: '2026-06-10T10:00:03.000Z',
        content: 'complete text',
      }),
    ])

    const chain = await loadChain(file)
    const last = chain.at(-1)

    expect(chain.map(m => m.uuid)).toEqual([userUuid, assistantUuid])
    if (last?.type !== 'assistant') throw new Error('Expected assistant leaf')
    expect(last.message.content).toEqual([
      { type: 'text', text: 'complete text' },
    ])
  })

  test('does not overwrite a real assistant message with a partial using the same uuid', async () => {
    const sessionId = randomUUID()
    const userUuid = randomUUID()
    const assistantUuid = randomUUID()
    const file = await writeJsonl([
      userEntry({
        sessionId,
        uuid: userUuid,
        parentUuid: null,
        timestamp: '2026-06-10T10:00:00.000Z',
        content: 'start work',
      }),
      assistantEntry({
        sessionId,
        uuid: assistantUuid,
        parentUuid: userUuid,
        timestamp: '2026-06-10T10:00:01.000Z',
        content: 'complete text',
      }),
      {
        type: 'partial-assistant',
        sessionId,
        parentUuid: assistantUuid,
        uuid: assistantUuid,
        timestamp: '2026-06-10T10:00:02.000Z',
        blocks: [{ text: 'stale partial text' }],
      },
    ])

    const chain = await loadChain(file)
    const last = chain.at(-1)

    expect(chain.map(m => m.uuid)).toEqual([userUuid, assistantUuid])
    if (last?.type !== 'assistant') throw new Error('Expected assistant leaf')
    expect(last.message.content).toEqual([
      { type: 'text', text: 'complete text' },
    ])
  })

  test('multi-block entry preserves all text blocks in order', async () => {
    const sessionId = randomUUID()
    const userUuid = randomUUID()
    const partialUuid = randomUUID()
    const file = await writeJsonl([
      userEntry({
        sessionId,
        uuid: userUuid,
        parentUuid: null,
        timestamp: '2026-06-10T10:00:00.000Z',
        content: 'start work',
      }),
      {
        type: 'partial-assistant',
        sessionId,
        parentUuid: userUuid,
        uuid: partialUuid,
        timestamp: '2026-06-10T10:00:02.000Z',
        blocks: [
          { text: 'first block' },
          { text: 'second block' },
          { text: 'third block' },
        ],
      },
    ])

    const chain = await loadChain(file)
    const last = chain.at(-1)

    expect(chain.map(m => m.type)).toEqual(['user', 'assistant'])
    expect(last?.uuid).toBe(partialUuid)
    if (last?.type !== 'assistant') throw new Error('Expected assistant leaf')
    expect(last.message.content).toEqual([
      { type: 'text', text: 'first block' },
      { type: 'text', text: 'second block' },
      { type: 'text', text: 'third block' },
    ])
  })

  test('tracker writes multiple text blocks as an ordered array', async () => {
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'

    const sessionId = randomUUID()
    const userUuid = randomUUID()
    const dir = await mkdtemp(join(tmpdir(), 'axiomate-partial-assistant-'))
    tempDirs.push(dir)
    const projectDir = join(dir, 'project')
    const file = join(dir, `${sessionId}.jsonl`)

    resetStateForTests()
    setOriginalCwd(projectDir)
    switchSession(asSessionId(sessionId))
    resetProjectForTesting()
    setSessionFileForTesting(file)

    await writeFile(
      file,
      JSON.stringify(
        userEntry({
          sessionId: sessionId as UUID,
          uuid: userUuid,
          parentUuid: null,
          timestamp: '2026-06-10T10:00:00.000Z',
          content: 'start work',
        }),
      ) + '\n',
    )

    const tracker = new PartialAssistantTracker()
    tracker.setParent(userUuid)
    tracker.onResponseStart()
    tracker.onTextBlockStart(0)
    tracker.onTextDelta(0, 'first block content')
    tracker.onTextBlockStop(0)
    tracker.onTextBlockStart(2) // index 1 is a tool_use, skipped
    tracker.onTextDelta(2, 'second block content')
    tracker.onTextBlockStop(2)
    tracker.onResponseStop()
    await flushSessionStorage()

    const chain = await loadChain(file)
    const last = chain.at(-1)

    expect(last?.type).toBe('assistant')
    if (last?.type !== 'assistant') throw new Error('Expected assistant leaf')
    expect(last.message.content).toEqual([
      { type: 'text', text: 'first block content' },
      { type: 'text', text: 'second block content' },
    ])
  })

  test('tracker throttles tiny updates within the same response', async () => {
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'

    const sessionId = randomUUID()
    const userUuid = randomUUID()
    const dir = await mkdtemp(join(tmpdir(), 'axiomate-partial-assistant-'))
    tempDirs.push(dir)
    const projectDir = join(dir, 'project')
    const file = join(dir, `${sessionId}.jsonl`)

    resetStateForTests()
    setOriginalCwd(projectDir)
    switchSession(asSessionId(sessionId))
    resetProjectForTesting()
    setSessionFileForTesting(file)

    await writeFile(
      file,
      JSON.stringify(
        userEntry({
          sessionId: sessionId as UUID,
          uuid: userUuid,
          parentUuid: null,
          timestamp: '2026-06-10T10:00:00.000Z',
          content: 'start work',
        }),
      ) + '\n',
    )

    const tracker = new PartialAssistantTracker()
    tracker.setParent(userUuid)
    tracker.onResponseStart()
    tracker.onTextBlockStart(0)
    tracker.onTextDelta(0, 'small')
    tracker.onTextDelta(0, ' update')
    // No force flush — both deltas are within throttle window
    await flushSessionStorage()

    const raw = await readFile(file, 'utf8')
    // Only one write (the first delta triggers the first write, second is throttled)
    expect(raw.match(/"type":"partial-assistant"/g)?.length ?? 0).toBeLessThanOrEqual(1)
  })

  test('does not treat synthesized partial UUIDs as real transcript messages for dedup', async () => {
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'

    const sessionId = randomUUID()
    const userUuid = randomUUID()
    const assistantUuid = randomUUID()
    const dir = await mkdtemp(join(tmpdir(), 'axiomate-partial-assistant-'))
    tempDirs.push(dir)
    const projectDir = join(dir, 'project')
    const file = join(dir, `${sessionId}.jsonl`)

    resetStateForTests()
    setOriginalCwd(projectDir)
    switchSession(asSessionId(sessionId))
    resetProjectForTesting()
    setSessionFileForTesting(file)

    await writeFile(file, [
      userEntry({
        sessionId: sessionId as UUID,
        uuid: userUuid,
        parentUuid: null,
        timestamp: '2026-06-10T10:00:00.000Z',
        content: 'start work',
      }),
      {
        type: 'partial-assistant',
        sessionId,
        parentUuid: userUuid,
        uuid: assistantUuid,
        timestamp: '2026-06-10T10:00:01.000Z',
        blocks: [{ text: 'partial text' }],
      },
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n')

    const chain = await loadChain(file)

    expect(chain.map(m => m.uuid)).toEqual([userUuid, assistantUuid])
    expect(await doesMessageExistInSession(sessionId, assistantUuid)).toBe(false)
  })

  test('starts a new JSONL line when appending after a truncated tail', async () => {
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'

    const sessionId = randomUUID()
    const userUuid = randomUUID()
    const dir = await mkdtemp(join(tmpdir(), 'axiomate-partial-assistant-'))
    tempDirs.push(dir)
    const projectDir = join(dir, 'project')
    const file = join(dir, `${sessionId}.jsonl`)

    resetStateForTests()
    setOriginalCwd(projectDir)
    switchSession(asSessionId(sessionId))
    resetProjectForTesting()
    setSessionFileForTesting(file)

    await writeFile(
      file,
      JSON.stringify(
        userEntry({
          sessionId: sessionId as UUID,
          uuid: userUuid,
          parentUuid: null,
          timestamp: '2026-06-10T10:00:00.000Z',
          content: 'start work',
        }),
      ) + '\n{"type":"partial-assistant","blocks":[{"text":"truncated"}]',
    )

    const tracker = new PartialAssistantTracker()
    tracker.setParent(userUuid)
    tracker.onResponseStart()
    tracker.onTextBlockStart(0)
    tracker.onTextDelta(0, 'recovered partial')
    tracker.onResponseStop()
    await flushSessionStorage()

    const raw = await readFile(file, 'utf8')
    expect(raw).toContain(
      '"truncated"}]\n{"type":"partial-assistant"',
    )

    const chain = await loadChain(file)
    const last = chain.at(-1)

    expect(last?.type).toBe('assistant')
    if (last?.type !== 'assistant') throw new Error('Expected assistant leaf')
    expect(last.message.content).toEqual([
      { type: 'text', text: 'recovered partial' },
    ])
  })

  test('prefers newer partial leaf over stale conversation head', async () => {
    const sessionId = randomUUID()
    const firstUserUuid = randomUUID()
    const firstAssistantUuid = randomUUID()
    const secondUserUuid = randomUUID()
    const partialUuid = randomUUID()
    const file = await writeJsonl([
      userEntry({
        sessionId,
        uuid: firstUserUuid,
        parentUuid: null,
        timestamp: '2026-06-10T10:00:00.000Z',
        content: 'first prompt',
      }),
      assistantEntry({
        sessionId,
        uuid: firstAssistantUuid,
        parentUuid: firstUserUuid,
        timestamp: '2026-06-10T10:00:01.000Z',
        content: 'first answer',
      }),
      {
        type: 'head',
        uuid: randomUUID(),
        headUuid: firstAssistantUuid,
        timestamp: '2026-06-10T10:00:02.000Z',
        sessionId,
      },
      userEntry({
        sessionId,
        uuid: secondUserUuid,
        parentUuid: firstAssistantUuid,
        timestamp: '2026-06-10T10:00:03.000Z',
        content: 'second prompt',
      }),
      {
        type: 'partial-assistant',
        sessionId,
        parentUuid: secondUserUuid,
        uuid: partialUuid,
        timestamp: '2026-06-10T10:00:04.000Z',
        blocks: [{ text: 'partial second answer' }],
      },
    ])

    const chain = await loadChain(file)

    expect(chain.map(m => m.uuid)).toEqual([
      firstUserUuid,
      firstAssistantUuid,
      secondUserUuid,
      partialUuid,
    ])
  })

  test('honors a newer conversation head over older leaves', async () => {
    const sessionId = randomUUID()
    const firstUserUuid = randomUUID()
    const firstAssistantUuid = randomUUID()
    const secondUserUuid = randomUUID()
    const file = await writeJsonl([
      userEntry({
        sessionId,
        uuid: firstUserUuid,
        parentUuid: null,
        timestamp: '2026-06-10T10:00:00.000Z',
        content: 'first prompt',
      }),
      assistantEntry({
        sessionId,
        uuid: firstAssistantUuid,
        parentUuid: firstUserUuid,
        timestamp: '2026-06-10T10:00:01.000Z',
        content: 'first answer',
      }),
      userEntry({
        sessionId,
        uuid: secondUserUuid,
        parentUuid: firstAssistantUuid,
        timestamp: '2026-06-10T10:00:03.000Z',
        content: 'second prompt',
      }),
      {
        type: 'head',
        uuid: randomUUID(),
        headUuid: firstAssistantUuid,
        timestamp: '2026-06-10T10:00:04.000Z',
        sessionId,
      },
    ])

    const chain = await loadChain(file)

    expect(chain.map(m => m.uuid)).toEqual([firstUserUuid, firstAssistantUuid])
  })
})
