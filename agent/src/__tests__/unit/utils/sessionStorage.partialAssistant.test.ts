import { randomUUID } from 'crypto'
import type { UUID } from 'crypto'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, test } from 'vitest'

import {
  buildConversationChain,
  loadTranscriptFile,
  pickConversationHead,
} from '../../../utils/sessionStorage.js'

const tempDirs: string[] = []

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
        content: 'I inspected',
      },
      {
        type: 'partial-assistant',
        sessionId,
        parentUuid: userUuid,
        uuid: randomUUID(),
        timestamp: '2026-06-10T10:00:02.000Z',
        content: 'I inspected the session storage path\n  ',
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
        content: 'incomplete text',
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
})
