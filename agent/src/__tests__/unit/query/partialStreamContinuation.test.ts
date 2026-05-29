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
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../../types/message.js'
import type { ToolUseContext } from '../../../Tool.js'

const now = new Date().toISOString()

function makePartialAssistant(options: {
  droppedToolNames?: string[]
} = {}): AssistantMessage {
  return {
    type: 'assistant',
    uuid: '00000000-0000-4000-8000-000000000001',
    timestamp: now,
    partialStreamRecovery: {
      reason: 'network_interruption',
      ...(options.droppedToolNames
        ? { droppedToolNames: options.droppedToolNames }
        : {}),
    },
    message: {
      id: 'partial-stream-stub',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'partial text' }],
      model: 'test-model',
      stop_reason: 'max_tokens',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    },
  }
}

function makeAssistantText(text: string): AssistantMessage {
  return {
    type: 'assistant',
    uuid: '00000000-0000-4000-8000-000000000002',
    timestamp: now,
    message: {
      id: 'msg_done',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'test-model',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    },
  }
}

function makeContext(): ToolUseContext {
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
    onRecoveryTrace: undefined,
  } as unknown as ToolUseContext
}

async function drain(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const message of gen) {
    out.push(message)
  }
  return out
}

function makeDeps(firstMessage: AssistantMessage): {
  deps: QueryDeps
  callModel: ReturnType<typeof vi.fn>
} {
  const callModel = vi.fn(async function* (input: { messages: Message[] }) {
    if (callModel.mock.calls.length === 1) {
      yield firstMessage
      return
    }
    const continuation = input.messages.at(-1) as UserMessage
    expect(continuation.type).toBe('user')
    yield makeAssistantText(
      typeof continuation.message.content === 'string'
        ? continuation.message.content
        : continuation.message.content[0]?.type === 'text'
          ? continuation.message.content[0].text
          : 'unexpected',
    )
  })
  const deps: QueryDeps = {
    callModel: callModel as unknown as QueryDeps['callModel'],
    microcompact: vi.fn(async messages => ({ messages })) as QueryDeps['microcompact'],
    autocompact: vi.fn(async () => ({ wasCompacted: false })) as QueryDeps['autocompact'],
    uuid: vi.fn(() => '00000000-0000-4000-8000-000000000099'),
  }
  return { deps, callModel }
}

describe('query partial stream continuation', () => {
  it('turns a text-only partial stream stub into a network continuation prompt', async () => {
    const { deps, callModel } = makeDeps(makePartialAssistant())

    const output = await drain(
      query({
        messages: [],
        systemPrompt: '' as never,
        userContext: {},
        systemContext: {},
        canUseTool: vi.fn(),
        toolUseContext: makeContext(),
        querySource: 'sdk',
        deps,
      }),
    )

    expect(callModel).toHaveBeenCalledTimes(2)
    const last = output
      .filter((message): message is AssistantMessage =>
        (message as { type?: unknown }).type === 'assistant',
      )
      .at(-1)!
    expect(last.message.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('network error mid-stream'),
    })
    expect((last.message.content[0] as { text: string }).text).not.toContain(
      'Output token limit hit',
    )
  })

  it('uses chunking guidance when a partial stream dropped a tool call', async () => {
    const { deps, callModel } = makeDeps(
      makePartialAssistant({ droppedToolNames: ['Write'] }),
    )

    const output = await drain(
      query({
        messages: [],
        systemPrompt: '' as never,
        userContext: {},
        systemContext: {},
        canUseTool: vi.fn(),
        toolUseContext: makeContext(),
        querySource: 'sdk',
        deps,
      }),
    )

    expect(callModel).toHaveBeenCalledTimes(2)
    const last = output
      .filter((message): message is AssistantMessage =>
        (message as { type?: unknown }).type === 'assistant',
      )
      .at(-1)!
    expect(last.message.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Write'),
    })
    expect((last.message.content[0] as { text: string }).text).toContain(
      'Break the remaining work into smaller chunks',
    )
  })
})
