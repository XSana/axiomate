import { normalize } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { asAgentId } from '../../../types/ids.js'
import { createFileStateCacheWithSizeLimit } from '../../../utils/fileStateCache.js'
import {
  clearFileStateRegistryForTests,
  getFileStateRegistrySequence,
  getKnownReadFilePaths,
  getPathsWrittenByOtherContextsSince,
  noteFileWrite,
  recordFileRead,
} from '../../../utils/fileStateRegistry.js'

function makeContext(agentId?: ReturnType<typeof asAgentId>) {
  return {
    agentId,
    readFileState: createFileStateCacheWithSizeLimit(10),
  }
}

function seedRead(context: ReturnType<typeof makeContext>, path: string): void {
  context.readFileState.set(path, {
    content: 'content',
    timestamp: 1,
    offset: 1,
    limit: undefined,
  })
  recordFileRead(context, path)
}

describe('fileStateRegistry reminder queries', () => {
  beforeEach(() => {
    clearFileStateRegistryForTests()
  })

  test('reports sibling writes after a captured sequence for known parent reads', () => {
    const parent = makeContext()
    const child = makeContext(asAgentId('achild000000000301'))
    const readPath = normalize('/tmp/parent-read.txt')
    const unreadPath = normalize('/tmp/parent-unread.txt')

    seedRead(parent, readPath)
    const sinceSequence = getFileStateRegistrySequence()

    noteFileWrite(child, readPath)
    noteFileWrite(child, unreadPath)

    expect(getKnownReadFilePaths(parent)).toEqual([readPath])
    expect(
      getPathsWrittenByOtherContextsSince(
        parent,
        sinceSequence,
        getKnownReadFilePaths(parent),
      ),
    ).toEqual([readPath])
  })

  test('excludes parent writes and writes before the captured sequence', () => {
    const parent = makeContext()
    const child = makeContext(asAgentId('achild000000000302'))
    const oldPath = normalize('/tmp/old.txt')
    const ownPath = normalize('/tmp/own.txt')

    seedRead(parent, oldPath)
    seedRead(parent, ownPath)
    noteFileWrite(child, oldPath)
    const sinceSequence = getFileStateRegistrySequence()
    noteFileWrite(parent, ownPath)

    expect(
      getPathsWrittenByOtherContextsSince(
        parent,
        sinceSequence,
        getKnownReadFilePaths(parent),
      ),
    ).toEqual([])
  })

  test('does not remind after parent re-reads the sibling write', () => {
    const parent = makeContext()
    const child = makeContext(asAgentId('achild000000000303'))
    const path = normalize('/tmp/reread.txt')

    seedRead(parent, path)
    const sinceSequence = getFileStateRegistrySequence()
    noteFileWrite(child, path)
    recordFileRead(parent, path)

    expect(
      getPathsWrittenByOtherContextsSince(
        parent,
        sinceSequence,
        getKnownReadFilePaths(parent),
      ),
    ).toEqual([])
  })
})
