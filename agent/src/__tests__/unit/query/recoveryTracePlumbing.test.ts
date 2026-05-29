import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../utils/model/model.js', () => ({
  getMainRoute: vi.fn(() => ({
    id: 'default',
    primary: 'test-model',
    fallbackChain: ['test-fallback-model', 'test-final-model'],
    recoveryProfile: 'main-agent',
    allowActions: ['retry_same_model', 'adapt_request', 'switch_model'],
    switchModelOn: ['rate_limit', 'overloaded'],
  })),
  resolveModelChain: vi.fn(() => [
    'test-model',
    'test-fallback-model',
    'test-final-model',
  ]),
  getRuntimeMainLoopModel: vi.fn(({ mainLoopModel }) => mainLoopModel),
  renderModelName: vi.fn((model: string) => model),
  doesMostRecentAssistantMessageExceed200k: vi.fn(() => false),
}))

import { query } from '../../../query.js'
import type { QueryDeps } from '../../../query/deps.js'
import { FallbackTriggeredError } from '../../../services/api/withRetry.js'
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

  it('uses the configured main route chain for multi-hop model fallback', async () => {
    const onRecoveryTrace = vi.fn()
    const attemptedModels: string[] = []
    const callModel = vi.fn(async function* (input: {
      options: {
        model: string
        fallbackModel?: string
        recoveryRouteId?: string
        recoveryFromModel?: string
        recoveryChainIndex?: number
      }
    }) {
      attemptedModels.push(input.options.model)
      if (input.options.model === 'test-model') {
        expect(input.options.fallbackModel).toBe('test-fallback-model')
        expect(input.options.recoveryRouteId).toBe('default')
        expect(input.options.recoveryFromModel).toBe('test-model')
        expect(input.options.recoveryChainIndex).toBe(0)
        throw new FallbackTriggeredError('test-model', 'test-fallback-model')
      }
      if (input.options.model === 'test-fallback-model') {
        expect(input.options.fallbackModel).toBe('test-final-model')
        expect(input.options.recoveryChainIndex).toBe(1)
        throw new FallbackTriggeredError(
          'test-fallback-model',
          'test-final-model',
        )
      }
      expect(input.options.fallbackModel).toBeUndefined()
      expect(input.options.recoveryChainIndex).toBe(2)
      yield makeAssistantMessage()
    })
    const deps: QueryDeps = {
      callModel: callModel as unknown as QueryDeps['callModel'],
      microcompact: vi.fn(async messages => ({ messages })) as QueryDeps['microcompact'],
      autocompact: vi.fn(async () => ({ wasCompacted: false })) as QueryDeps['autocompact'],
      uuid: vi.fn(() => '00000000-0000-4000-8000-000000000099'),
    }

    const output = await drain(
      query({
        messages: [],
        systemPrompt: '' as never,
        userContext: {},
        systemContext: {},
        canUseTool: vi.fn(),
        toolUseContext: makeContext(onRecoveryTrace),
        querySource: 'sdk',
        deps,
      }),
    )

    expect(attemptedModels).toEqual([
      'test-model',
      'test-fallback-model',
      'test-final-model',
    ])
    expect(
      output.filter(
        (message): message is AssistantMessage =>
          (message as { type?: unknown }).type === 'assistant',
      ),
    ).toHaveLength(1)
  })

  it('treats an explicit fallback model as the next route-chain candidate', async () => {
    const onRecoveryTrace = vi.fn()
    const attemptedModels: string[] = []
    const callModel = vi.fn(async function* (input: {
      options: { model: string; fallbackModel?: string }
    }) {
      attemptedModels.push(input.options.model)
      if (input.options.model === 'test-model') {
        expect(input.options.fallbackModel).toBe('explicit-fallback')
        throw new FallbackTriggeredError('test-model', 'explicit-fallback')
      }
      expect(input.options.model).toBe('explicit-fallback')
      expect(input.options.fallbackModel).toBe('test-fallback-model')
      yield makeAssistantMessage()
    })
    const deps: QueryDeps = {
      callModel: callModel as unknown as QueryDeps['callModel'],
      microcompact: vi.fn(async messages => ({ messages })) as QueryDeps['microcompact'],
      autocompact: vi.fn(async () => ({ wasCompacted: false })) as QueryDeps['autocompact'],
      uuid: vi.fn(() => '00000000-0000-4000-8000-000000000099'),
    }

    await drain(
      query({
        messages: [],
        systemPrompt: '' as never,
        userContext: {},
        systemContext: {},
        canUseTool: vi.fn(),
        toolUseContext: makeContext(onRecoveryTrace),
        fallbackModel: 'explicit-fallback',
        querySource: 'sdk',
        deps,
      }),
    )

    expect(attemptedModels).toEqual(['test-model', 'explicit-fallback'])
  })
})
