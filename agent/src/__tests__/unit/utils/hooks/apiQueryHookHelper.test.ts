import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AuxiliaryTaskAttempt } from '../../../../services/api/auxiliaryTaskRunner.js'
import type { AssistantMessage, Message } from '../../../../types/message.js'
import { asSystemPrompt } from '../../../../utils/systemPromptType.js'
import type { ApiQueryHookContext } from '../../../../utils/hooks/apiQueryHookHelper.js'

vi.mock('../../../../services/api/llm.js', () => ({
  queryModelWithoutStreaming: vi.fn(),
}))

vi.mock('../../../../services/api/auxiliaryTaskRunner.js', () => ({
  auxiliaryFailureAssistantMessage: vi.fn(() => null),
  runAuxiliaryTask: vi.fn(async options =>
    options.execute(makeAttempt(options.task)),
  ),
}))

import { queryModelWithoutStreaming } from '../../../../services/api/llm.js'
import { runAuxiliaryTask } from '../../../../services/api/auxiliaryTaskRunner.js'
import {
  createApiQueryHook,
  type ApiQueryResult,
} from '../../../../utils/hooks/apiQueryHookHelper.js'

const mockedQuery = vi.mocked(queryModelWithoutStreaming)
const mockedRunAuxiliaryTask = vi.mocked(runAuxiliaryTask)

function makeAttempt(task: string): AuxiliaryTaskAttempt {
  return {
    task,
    policy: {
      id: 'skill-route',
      task,
      primary: 'mid-model',
      fallbackChain: ['fast-model'],
      recoveryProfile: 'auxiliary-fast',
      allowActions: ['retry_same_model', 'adapt_request', 'switch_model'],
      switchModelOn: ['rate_limit', 'server_error'],
      failure: 'fail_open',
      timeoutMs: 30_000,
    },
    model: 'mid-model',
    provider: {} as AuxiliaryTaskAttempt['provider'],
    routeId: 'skill-route',
    chainIndex: 0,
    fallbackModel: 'fast-model',
    policyGate: {
      allowActions: ['retry_same_model', 'adapt_request', 'switch_model'],
      switchModelOn: ['rate_limit', 'server_error'],
      actionAllowed: true,
    },
  }
}

function assistant(text: string, model = 'mid-model'): AssistantMessage {
  return {
    type: 'assistant',
    uuid: '00000000-0000-0000-0000-000000000001',
    timestamp: '2026-05-29T00:00:00.000Z',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      model,
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    },
  } as AssistantMessage
}

function userMessage(text: string): Message {
  return {
    type: 'user',
    uuid: '00000000-0000-0000-0000-000000000002',
    timestamp: '2026-05-29T00:00:00.000Z',
    message: { role: 'user', content: text },
  } as Message
}

function makeContext(
  overrides: Partial<ApiQueryHookContext> = {},
): ApiQueryHookContext {
  const onRecoveryTrace = vi.fn()
  return {
    messages: [userMessage('hello')],
    systemPrompt: asSystemPrompt([]),
    userContext: {},
    systemContext: {},
    querySource: 'repl_main_thread',
    toolUseContext: {
      options: {
        tools: [],
        isNonInteractiveSession: false,
        appendSystemPrompt: '',
        agentDefinitions: { activeAgents: [] },
      },
      getAppState: () => ({
        toolPermissionContext: {},
      }),
      onRecoveryTrace,
    },
    ...overrides,
  } as unknown as ApiQueryHookContext
}

describe('createApiQueryHook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedQuery.mockResolvedValue(assistant('<result>{"ok":true}</result>'))
    mockedRunAuxiliaryTask.mockImplementation(async options =>
      options.execute(makeAttempt(options.task)),
    )
  })

  test('routes auxiliary hooks through the task runner with recovery metadata', async () => {
    const logResult = vi.fn()
    const context = makeContext()
    const hook = createApiQueryHook({
      name: 'skill_improvement',
      auxiliaryTask: 'skillImprovement',
      shouldRun: async () => true,
      buildMessages: () => [userMessage('inspect this skill')],
      useTools: false,
      parseResponse: content => ({ content }),
      logResult,
    })

    await hook(context)

    expect(mockedRunAuxiliaryTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'skillImprovement',
        operation: 'inference',
        querySource: 'skill_improvement',
        sink: context.toolUseContext.onRecoveryTrace,
      }),
    )
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          model: 'mid-model',
          fallbackModel: 'fast-model',
          recoveryRouteId: 'skill-route',
          recoveryFromModel: 'mid-model',
          recoveryChainIndex: 0,
          recoveryPolicyGate: expect.objectContaining({
            actionAllowed: true,
          }),
          onRecoveryTrace: context.toolUseContext.onRecoveryTrace,
          querySource: 'skill_improvement',
        }),
      }),
    )
    expect(logResult).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        model: 'mid-model',
      } satisfies Partial<ApiQueryResult<{ content: string }>>),
      context,
    )
  })

  test('preserves explicit getModel hooks as direct model bypasses', async () => {
    const logResult = vi.fn()
    const context = makeContext()
    const hook = createApiQueryHook({
      name: 'custom_hook',
      getModel: () => 'explicit-model',
      shouldRun: async () => true,
      buildMessages: () => [userMessage('direct')],
      parseResponse: content => content,
      logResult,
    })

    await hook(context)

    expect(mockedRunAuxiliaryTask).not.toHaveBeenCalled()
    expect(mockedQuery.mock.calls[0]![0].options).toMatchObject({
      model: 'explicit-model',
      querySource: 'custom_hook',
    })
    expect(mockedQuery.mock.calls[0]![0].options).not.toHaveProperty(
      'fallbackModel',
    )
    expect(logResult).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        model: 'mid-model',
      }),
      context,
    )
  })

  test('logs an error result when auxiliary failure disposition returns null', async () => {
    const logResult = vi.fn()
    mockedRunAuxiliaryTask.mockResolvedValueOnce(null)
    const context = makeContext()
    const hook = createApiQueryHook({
      name: 'skill_improvement',
      auxiliaryTask: 'skillImprovement',
      shouldRun: async () => true,
      buildMessages: () => [userMessage('inspect')],
      parseResponse: vi.fn(),
      logResult,
    })

    await hook(context)

    expect(logResult).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        queryName: 'skill_improvement',
        error: expect.objectContaining({
          message: 'Model returned no response',
        }),
      }),
      context,
    )
  })
})
