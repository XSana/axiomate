import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../utils/model/model.js', () => ({
  getMidModel: vi.fn(() => 'test-fallback-model'),
  getFastModel: vi.fn(() => 'test-fast-model'),
  getRuntimeMainLoopModel: vi.fn(({ mainLoopModel }) => mainLoopModel),
  renderModelName: vi.fn((model: string) => model),
  doesMostRecentAssistantMessageExceed200k: vi.fn(() => false),
}))

import { query } from '../../../query.js'
import type { QueryDeps } from '../../../query/deps.js'
import type { RecoveryTraceEvent } from '../../../services/api/recoveryTrace.js'
import type { AssistantMessage, Message } from '../../../types/message.js'
import type { ToolUseContext } from '../../../Tool.js'

const now = new Date().toISOString()

function makeAssistantMessage(): AssistantMessage {
  return {
    type: 'assistant',
    uuid: '00000000-0000-4000-8000-000000000001',
    timestamp: now,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
    },
  } as unknown as AssistantMessage
}

function makeContext(onRecoveryTrace: (event: RecoveryTraceEvent) => void): ToolUseContext {
  return {
    abortController: new AbortController(),
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    readFileState: new Map(),
    getAppState: () => ({
      toolPermissionContext: { mode: 'default' },
      mcp: { tools: [], clients: [] },
      effortValueByModel: {},
    }),
    setAppState: () => {},
    messages: [],
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    onRecoveryTrace,
  } as unknown as ToolUseContext
}

async function drain(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const message of gen) {
    out.push(message)
  }
  return out
}

describe('query recovery trace plumbing', () => {
  it('passes ToolUseContext.onRecoveryTrace into the API streaming options', async () => {
    const onRecoveryTrace = vi.fn()
    const callModel = vi.fn(async function* (input: {
      options: { onRecoveryTrace?: (event: RecoveryTraceEvent) => void }
    }) {
      expect(input.options.onRecoveryTrace).toBe(onRecoveryTrace)
      yield makeAssistantMessage()
    })
    const deps: QueryDeps = {
      callModel: callModel as unknown as QueryDeps['callModel'],
      microcompact: vi.fn(async messages => ({ messages })) as QueryDeps['microcompact'],
      autocompact: vi.fn(async () => ({ wasCompacted: false })) as QueryDeps['autocompact'],
      uuid: vi.fn(() => '00000000-0000-4000-8000-000000000099'),
    }
    const messages: Message[] = []

    await drain(
      query({
        messages,
        systemPrompt: '' as never,
        userContext: {},
        systemContext: {},
        canUseTool: vi.fn(),
        toolUseContext: makeContext(onRecoveryTrace),
        querySource: 'sdk',
        deps,
      }),
    )

    expect(callModel).toHaveBeenCalledTimes(1)
  })
})
