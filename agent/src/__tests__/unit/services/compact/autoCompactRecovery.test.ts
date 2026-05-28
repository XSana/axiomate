import { randomUUID } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToolUseContext } from '../../../../Tool.js'
import type {
  Message,
  SystemCompactBoundaryMessage,
  UserMessage,
} from '../../../../types/message.js'
import type { CacheSafeParams } from '../../../../utils/forkedAgent.js'
import type { CompactionResult, RecompactionInfo } from '../../../../services/compact/compact.js'

const compactConversationMock = vi.hoisted(() => vi.fn())
const trySessionMemoryCompactionMock = vi.hoisted(() => vi.fn())

vi.mock('../../../../utils/config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../utils/config.js')>()
  return {
    ...actual,
    getGlobalConfig: () => ({
      ...actual.DEFAULT_GLOBAL_CONFIG,
      autoCompactEnabled: true,
    }),
  }
})

vi.mock('../../../../utils/envUtils.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../utils/envUtils.js')>()
  return {
    ...actual,
    isEnvTruthy: (value: unknown) => value === '1' || value === 'true',
  }
})

vi.mock('../../../../services/SessionMemory/sessionMemoryUtils.js', () => ({
  setLastSummarizedMessageId: vi.fn(),
}))

vi.mock('../../../../services/compact/postCompactCleanup.js', () => ({
  runPostCompactCleanup: vi.fn(),
}))

vi.mock('../../../../services/compact/sessionMemoryCompact.js', () => ({
  trySessionMemoryCompaction: trySessionMemoryCompactionMock,
}))

vi.mock('../../../../services/compact/compact.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../../services/compact/compact.js')>()
  return {
    ...actual,
    compactConversation: compactConversationMock,
  }
})

import { autoCompactIfNeeded } from '../../../../services/compact/autoCompact.js'

beforeEach(() => {
  compactConversationMock.mockReset()
  trySessionMemoryCompactionMock.mockReset()
})

function makeUserMessage(content: string): UserMessage {
  return {
    type: 'user',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: { role: 'user', content },
  } as unknown as UserMessage
}

function makeCompactionResult(): CompactionResult {
  const boundaryMarker: SystemCompactBoundaryMessage = {
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    level: 'info',
    compactMetadata: {
      trigger: 'auto',
      preTokens: 10,
    },
  }
  return {
    boundaryMarker,
    summaryMessages: [makeUserMessage('summary')],
    attachments: [],
    hookResults: [],
  }
}

function makeToolUseContext(): ToolUseContext {
  return {
    options: {
      mainLoopModel: 'small-test-model',
      tools: [],
    },
    agentId: undefined,
  } as unknown as ToolUseContext
}

function makeCacheSafeParams(
  toolUseContext: ToolUseContext,
  messages: Message[],
): CacheSafeParams {
  return {
    systemPrompt: '' as never,
    userContext: {},
    systemContext: {},
    toolUseContext,
    forkContextMessages: messages,
  }
}

describe('autoCompactIfNeeded recovery options', () => {
  it('forced lower_context_tier compacts below the normal threshold and records recovery metadata', async () => {
    const messages: Message[] = [makeUserMessage('short conversation')]
    const toolUseContext = makeToolUseContext()
    const compactionResult = makeCompactionResult()
    compactConversationMock.mockResolvedValueOnce(compactionResult)
    trySessionMemoryCompactionMock.mockResolvedValueOnce(null)

    const result = await autoCompactIfNeeded(
      messages,
      toolUseContext,
      makeCacheSafeParams(toolUseContext, messages),
      'repl_main_thread',
      undefined,
      0,
      { force: true, recoveryAction: 'lower_context_tier' },
    )

    expect(result.wasCompacted).toBe(true)
    expect(result.compactionResult).toBe(compactionResult)
    expect(compactConversationMock).toHaveBeenCalledTimes(1)

    const recompactionInfo = compactConversationMock.mock.calls[0]?.[6] as
      | RecompactionInfo
      | undefined
    expect(recompactionInfo).toEqual(
      expect.objectContaining({
        forced: true,
        recoveryAction: 'lower_context_tier',
        querySource: 'repl_main_thread',
      }),
    )
  })

  it('forced mode keeps recursive compact sources disabled', async () => {
    const messages: Message[] = [makeUserMessage('short conversation')]
    const toolUseContext = makeToolUseContext()

    const result = await autoCompactIfNeeded(
      messages,
      toolUseContext,
      makeCacheSafeParams(toolUseContext, messages),
      'compact',
      undefined,
      0,
      { force: true, recoveryAction: 'lower_context_tier' },
    )

    expect(result.wasCompacted).toBe(false)
    expect(compactConversationMock).not.toHaveBeenCalled()
  })
})
