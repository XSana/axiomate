import { randomUUID } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, test } from 'vitest'
import { extractReadFilesFromMessages } from '../../../utils/queryHelpers.js'
import type { Message } from '../../../types/message.js'

let tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tmpDirs = []
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'axiomate-query-helpers-'))
  tmpDirs.push(dir)
  return dir
}

function assistantToolUse(
  id: string,
  name: string,
  input: Record<string, unknown>,
): Message {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: '2026-01-01T00:00:00.000Z',
    message: {
      id: randomUUID(),
      type: 'message',
      role: 'assistant',
      model: 'test',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
      content: [{ type: 'tool_use', id, name, input }],
    },
  } as Message
}

function toolResult(id: string, timestamp: string): Message {
  return {
    type: 'user',
    uuid: randomUUID(),
    timestamp,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: 'ok',
        },
      ],
    },
  } as Message
}

function readResult(
  id: string,
  timestamp: string,
  content: string,
): Message {
  return {
    type: 'user',
    uuid: randomUUID(),
    timestamp,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content,
        },
      ],
    },
  } as Message
}

describe('extractReadFilesFromMessages file-state resume reconstruction', () => {
  test('reconstructs Write state from canonical tool semantics and records format normalization', () => {
    const dir = tempDir()
    const file = join(dir, 'write.txt')
    const messages = [
      assistantToolUse('write-1', 'Write', {
        file_path: file,
        content: '\ufeffalpha\r\nbeta\r\n',
      }),
      toolResult('write-1', '2026-01-01T00:00:01.000Z'),
    ]

    const state = extractReadFilesFromMessages(messages, dir, 10).get(file)

    expect(state?.content).toBe('alpha\nbeta\n')
    expect(state?.timestamp).toBe(
      new Date('2026-01-01T00:00:01.000Z').getTime(),
    )
    expect(state?.toolNormalization).toEqual({
      sourceTool: 'Write',
      removedLeadingBom: true,
      normalizedLineEndings: true,
    })
  })

  test('replays successful Edit against prior known content instead of reading current disk', () => {
    const dir = tempDir()
    const file = join(dir, 'edit.txt')
    writeFileSync(file, 'human offline edit\n', 'utf8')
    const messages = [
      assistantToolUse('write-1', 'Write', {
        file_path: file,
        content: 'alpha\nbeta\n',
      }),
      toolResult('write-1', '2026-01-01T00:00:01.000Z'),
      assistantToolUse('edit-1', 'Edit', {
        file_path: file,
        old_string: 'beta',
        new_string: 'BETA',
      }),
      toolResult('edit-1', '2026-01-01T00:00:02.000Z'),
    ]

    const state = extractReadFilesFromMessages(messages, dir, 10).get(file)

    expect(state?.content).toBe('alpha\nBETA\n')
    expect(state?.timestamp).toBe(
      new Date('2026-01-01T00:00:02.000Z').getTime(),
    )
  })

  test('does not seed Edit state from current disk when replay has no prior known content', () => {
    const dir = tempDir()
    const file = join(dir, 'edit-without-prior.txt')
    writeFileSync(file, 'human offline edit\n', 'utf8')
    const messages = [
      assistantToolUse('edit-1', 'Edit', {
        file_path: file,
        old_string: 'alpha',
        new_string: 'ALPHA',
      }),
      toolResult('edit-1', '2026-01-01T00:00:02.000Z'),
    ]

    const cache = extractReadFilesFromMessages(messages, dir, 10)

    expect(cache.get(file)).toBeUndefined()
  })

  test('does not overwrite prior known content when Edit replay fails', () => {
    const dir = tempDir()
    const file = join(dir, 'edit-fails.txt')
    writeFileSync(file, 'human offline edit\n', 'utf8')
    const messages = [
      assistantToolUse('read-1', 'Read', {
        file_path: file,
      }),
      readResult('read-1', '2026-01-01T00:00:01.000Z', '1\talpha\n2\tbeta'),
      assistantToolUse('edit-1', 'Edit', {
        file_path: file,
        old_string: 'gamma',
        new_string: 'GAMMA',
      }),
      toolResult('edit-1', '2026-01-01T00:00:02.000Z'),
    ]

    const state = extractReadFilesFromMessages(messages, dir, 10).get(file)

    expect(state?.content).toBe('alpha\nbeta')
    expect(state?.timestamp).toBe(
      new Date('2026-01-01T00:00:01.000Z').getTime(),
    )
  })
})
