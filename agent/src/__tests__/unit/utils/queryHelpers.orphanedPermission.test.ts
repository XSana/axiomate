import { z } from 'zod/v4'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { handleOrphanedPermission } from '../../../utils/queryHelpers.js'
import {
  createFileStateCacheWithSizeLimit,
} from '../../../utils/fileStateCache.js'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolUseContext,
} from '../../../Tool.js'
import type { Message } from '../../../types/message.js'
import type { OrphanedPermission } from '../../../types/textInputTypes.js'
import { resetStateForTests, setSessionPersistenceDisabled } from '../../../bootstrap/state.js'

vi.mock('../../../services/tools/toolHooks.js', () => ({
  resolveHookPermissionDecision: async (
    _hookPermissionResult: unknown,
    _tool: unknown,
    input: Record<string, unknown>,
    _toolUseContext: unknown,
    _canUseTool: unknown,
    _assistantMessage: unknown,
    _toolUseID: unknown,
  ) => ({
    decision: {
      behavior: 'allow',
      updatedInput: {
        ...input,
        _approvedExitMode: 'default',
      },
    },
    input,
  }),
  runPostToolUseFailureHooks: async function* () {},
  runPostToolUseHooks: async function* () {},
  runPreToolUseHooks: async function* () {},
}))

function makePermissionUpdatedInputTool(
  callSpy: ReturnType<typeof vi.fn>,
): Tool {
  return {
    name: 'FakePermissionUpdatedInputTool',
    inputSchema: z.strictObject({}),
    permissionUpdatedInputSchema: z.strictObject({
      _approvedExitMode: z.literal('default'),
    }),
    isReadOnly: () => false,
    isEnabled: () => true,
    isConcurrencySafe: () => false,
    description: async () => 'fake',
    prompt: async () => 'fake',
    userFacingName: () => 'Fake',
    call: async input => {
      callSpy(input)
      return { data: 'called' }
    },
    mapToolResultToToolResultBlockParam: (content, toolUseID) => ({
      type: 'tool_result',
      content: String(content),
      tool_use_id: toolUseID,
    }),
  } as unknown as Tool
}

function makeContext(tool: Tool): ToolUseContext {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools: [tool],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: {
        activeAgents: [],
        allAgents: [],
      },
    },
    abortController: new AbortController(),
    readFileState: createFileStateCacheWithSizeLimit(10),
    getAppState: () =>
      ({
        toolPermissionContext: getEmptyToolPermissionContext(),
      }) as never,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
    nestedMemoryAttachmentTriggers: new Set<string>(),
    dynamicSkillDirTriggers: new Set<string>(),
  } as ToolUseContext
}

function assistantToolUseMessage(
  input: Record<string, unknown>,
): Extract<Message, { type: 'assistant' }> {
  return {
    type: 'assistant',
    uuid: '00000000-0000-4000-8000-000000000001',
    timestamp: '2026-06-09T00:00:00.000Z',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
      content: [
        {
          type: 'tool_use',
          id: 'toolu_orphaned',
          name: 'FakePermissionUpdatedInputTool',
          input,
        },
      ],
    },
  }
}

function firstToolResultContent(messages: Message[]): string {
  const userMessage = messages.find((message): message is Extract<Message, { type: 'user' }> =>
    message.type === 'user',
  )
  const content = userMessage?.message.content
  const result = Array.isArray(content) ? content[0] : null
  return result && 'content' in result ? String(result.content) : ''
}

beforeEach(() => {
  resetStateForTests()
  setSessionPersistenceDisabled(true)
})

describe('handleOrphanedPermission', () => {
  test('preserves model input and validates permission-updated input with the permission schema', async () => {
    const callSpy = vi.fn()
    const tool = makePermissionUpdatedInputTool(callSpy)
    const assistantMessage = assistantToolUseMessage({})
    const mutableMessages: Message[] = []
    const orphanedPermission: OrphanedPermission = {
      assistantMessage,
      permissionResult: {
        behavior: 'allow',
        toolUseID: 'toolu_orphaned',
        updatedInput: {
          _approvedExitMode: 'default',
        },
      },
    }
    const sdkMessages = []

    for await (const message of handleOrphanedPermission(
      orphanedPermission,
      [tool],
      mutableMessages,
      makeContext(tool) as never,
    )) {
      sdkMessages.push(message)
    }

    expect(callSpy).toHaveBeenCalledWith({ _approvedExitMode: 'default' })
    expect(firstToolResultContent(mutableMessages)).toBe('called')
    expect(firstToolResultContent(mutableMessages)).not.toContain(
      'InputValidationError',
    )
    expect(sdkMessages).toHaveLength(2)
  })
})
