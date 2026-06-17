import { randomUUID } from 'crypto'
import { describe, expect, it, vi } from 'vitest'

import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../../../types/message.js'
import { createFileStateCacheWithSizeLimit } from '../../../../utils/fileStateCache.js'

const planFilePath = 'C:\\workspace\\.plans\\session-plan.md'
// CRLF + trailing-BOM-free content mirrors a Windows plan written by
// ExitPlanMode (writeFile(plan, 'utf-8')). The read-state coordinate stored for
// the gate must be LF-normalized so a later Edit is not falsely rejected as
// stale_content once the plan's mtime advances.
const planContentRaw = '# Plan\r\n\r\n- update the plan\r\n'
const planContentNormalized = '# Plan\n\n- update the plan\n'

vi.mock('../../../../utils/plans.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../../utils/plans.js')>()
  return {
    ...actual,
    getPlan: vi.fn(() => planContentRaw),
    getPlanFilePath: vi.fn(() => planFilePath),
  }
})

vi.mock('../../../../utils/forkedAgent.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../../utils/forkedAgent.js')>()
  return {
    ...actual,
    runForkedAgent: vi.fn(async () => {
      const fakeAssistant: AssistantMessage = {
        type: 'assistant',
        uuid: randomUUID(),
        timestamp: '2026-01-01T00:00:03.000Z',
        message: {
          id: `msg_${randomUUID()}`,
          role: 'assistant',
          model: 'test-model',
          stop_reason: 'end_turn',
          stop_sequence: null,
          type: 'message',
          usage: { input_tokens: 10, output_tokens: 20 },
          content: [{ type: 'text', text: 'synthetic compact summary' }],
        },
      } as unknown as AssistantMessage
      return {
        messages: [fakeAssistant],
        totalUsage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }
    }),
  }
})

import { compactConversation } from '../../../../services/compact/compact.js'

function makeUserMsg(text: string): UserMessage {
  return {
    type: 'user',
    uuid: randomUUID(),
    timestamp: '2026-01-01T00:00:00.000Z',
    message: { role: 'user', content: text },
  } as unknown as UserMessage
}

function makeAssistantTextMsg(text: string): Message {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: '2026-01-01T00:00:00.500Z',
    message: {
      id: `msg_${randomUUID()}`,
      role: 'assistant',
      model: 'test-model',
      stop_reason: 'end_turn',
      stop_sequence: null,
      type: 'message',
      usage: { input_tokens: 10, output_tokens: 20 },
      content: [{ type: 'text', text }],
    },
  } as unknown as Message
}

function makeMinimalContext() {
  const abortController = new AbortController()
  const appState = {
    mainLoopModel: 'test-model',
    mainLoopModelOverrideForSession: {
      type: 'single-model-route' as const,
      modelId: 'test-model',
    },
    verbose: false,
    thinkingEnabled: false,
    promptSuggestionEnabled: false,
    settings: {},
    tasks: {},
    toolPermissionContext: { mode: 'default' as const },
    messages: [],
    pendingToolUseMessages: [],
    isLoading: false,
  }
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' as const },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { builtIn: [], user: [], project: [], activeAgents: [] },
      querySource: 'cli' as const,
    },
    abortController,
    readFileState: createFileStateCacheWithSizeLimit(100, 1_000_000),
    loadedNestedMemoryPaths: new Set<string>(),
    getAppState: () => appState,
    setAppState: () => {},
    messages: [],
    setSDKStatus: () => {},
    setStreamMode: () => {},
    setResponseLength: () => {},
    onCompactProgress: () => {},
  }
}

describe('compact plan attachment read state', () => {
  it('marks the compact plan attachment as observed when the plan content is reintroduced', async () => {
    const messages: Message[] = [
      makeUserMsg('please make a plan'),
      makeAssistantTextMsg('I wrote a plan'),
      makeUserMsg('compact now'),
    ]
    const context = makeMinimalContext()

    const result = await compactConversation(
      messages,
      context as never,
      {
        forkContextMessages: messages,
        systemPrompt: { text: '' },
        userContext: {},
        systemContext: {},
        toolUseContext: {},
      } as never,
      true,
      undefined,
      false,
    )

    expect(
      result.attachments.some(
        attachment => attachment.attachment.type === 'plan_file_reference',
      ),
    ).toBe(true)
    const restored = context.readFileState.get(planFilePath)
    // Stored content is LF-normalized to match the Write/Edit staleness gate,
    // which compares against normalizeContentToLf(disk). Storing raw CRLF here
    // would falsely reject a later plan Edit as stale_content once mtime drifts.
    expect(restored?.content).toBe(planContentNormalized)
    expect(restored?.content).not.toContain('\r')
    expect(restored?.offset).toBeUndefined()
    expect(restored?.limit).toBeUndefined()
  }, 30_000)
})
