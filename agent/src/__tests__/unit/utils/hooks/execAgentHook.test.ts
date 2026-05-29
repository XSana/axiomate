import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentHook } from '../../../../utils/settings/types.js'
import type { ToolUseContext } from '../../../../Tool.js'

vi.mock('../../../../query.js', () => ({
  query: vi.fn(),
}))

vi.mock('../../../../utils/model/model.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../utils/model/model.js')>()
  return {
    ...actual,
    getAuxiliaryTaskPolicy: vi.fn(() => ({
      id: 'hookAgent',
      task: 'hookAgent',
      primary: 'hook-model',
      fallbackChain: ['hook-fallback'],
      recoveryProfile: 'auxiliary-quality',
      allowActions: ['retry_same_model', 'adapt_request', 'switch_model'],
      switchModelOn: ['rate_limit', 'server_error'],
      failure: 'propagate_error',
      timeoutMs: 45_000,
    })),
  }
})

vi.mock('../../../../utils/sessionStorage.js', () => ({
  getAgentTranscriptPath: vi.fn(() => '/tmp/agent-transcript.jsonl'),
  getTranscriptPath: vi.fn(() => '/tmp/transcript.jsonl'),
}))

import { query } from '../../../../query.js'
import { execAgentHook } from '../../../../utils/hooks/execAgentHook.js'
import {
  getAuxiliaryTaskPolicy,
} from '../../../../utils/model/model.js'

const mockedQuery = vi.mocked(query)
const mockedGetAuxiliaryTaskPolicy = vi.mocked(getAuxiliaryTaskPolicy)

function makeContext(): ToolUseContext {
  return {
    abortController: new AbortController(),
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'main-model',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'enabled', budgetTokens: 1024 },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    readFileState: new Map(),
    getAppState: () => ({
      toolPermissionContext: {
        mode: 'default',
        alwaysAllowRules: {},
      },
      mcp: { tools: [], clients: [] },
    }),
    setAppState: () => {},
    messages: [],
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    setStreamMode: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  } as unknown as ToolUseContext
}

function structuredOutputMessage(ok = true) {
  return {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-000000000001',
    timestamp: '2026-05-29T00:00:00.000Z',
    attachment: {
      type: 'structured_output',
      data: ok ? { ok: true } : { ok: false, reason: 'not done' },
    },
  } as const
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedQuery.mockImplementation(async function* () {
    yield structuredOutputMessage()
  } as unknown as typeof query)
})

describe('execAgentHook', () => {
  test('runs unspecified hook agents through the hookAgent auxiliary route policy', async () => {
    const context = makeContext()
    const hook: AgentHook = {
      type: 'agent',
      prompt: 'verify',
    }

    const result = await execAgentHook(
      hook,
      'Stop',
      'Stop',
      '{}',
      new AbortController().signal,
      context,
      undefined,
      [],
    )

    expect(result.outcome).toBe('success')
    expect(mockedGetAuxiliaryTaskPolicy).toHaveBeenCalledWith('hookAgent')
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        querySource: 'hook_agent',
        modelRouteOverride: expect.objectContaining({
          id: 'hookAgent',
          primary: 'hook-model',
          fallbackChain: ['hook-fallback'],
          auxiliaryTask: 'hookAgent',
        }),
        toolUseContext: expect.objectContaining({
          options: expect.objectContaining({
            mainLoopModel: 'hook-model',
            isNonInteractiveSession: true,
            thinkingConfig: { type: 'disabled' },
          }),
        }),
      }),
    )
  })

  test('treats explicit hook.model as a single-model full-query route bypass', async () => {
    const context = makeContext()
    const hook: AgentHook = {
      type: 'agent',
      prompt: 'verify',
      model: 'explicit-model',
    }

    await execAgentHook(
      hook,
      'Stop',
      'Stop',
      '{}',
      new AbortController().signal,
      context,
      undefined,
      [],
    )

    expect(mockedGetAuxiliaryTaskPolicy).not.toHaveBeenCalled()
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRouteOverride: expect.objectContaining({
          id: 'hook:explicit-model',
          primary: 'explicit-model',
          fallbackChain: [],
        }),
      }),
    )
    const route = mockedQuery.mock.calls[0]![0].modelRouteOverride
    expect(route).not.toHaveProperty('auxiliaryTask')
  })
})
