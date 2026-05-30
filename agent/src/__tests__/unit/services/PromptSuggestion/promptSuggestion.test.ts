import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runForkedAgent: vi.fn(),
  getAuxiliaryTaskPolicy: vi.fn(),
}))

vi.mock('../../../../utils/forkedAgent.js', () => ({
  createCacheSafeParams: vi.fn(),
  runForkedAgent: mocks.runForkedAgent,
}))

vi.mock('../../../../utils/model/model.js', () => ({
  getAuxiliaryTaskPolicy: mocks.getAuxiliaryTaskPolicy,
}))

vi.mock('../../../../bootstrap/state.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../bootstrap/state.js')>()),
  getIsNonInteractiveSession: vi.fn(() => false),
}))

vi.mock('../../../../utils/settings/settings.js', () => ({
  getInitialSettings: vi.fn(() => ({ promptSuggestionEnabled: true })),
}))

vi.mock('../../../../utils/agentSwarmsEnabled.js', () => ({
  isAgentSwarmsEnabled: vi.fn(() => false),
}))

vi.mock('../../../../utils/teammate.js', () => ({
  isTeammate: vi.fn(() => false),
}))

vi.mock('../../../../services/analytics/index.js', () => ({
  logEvent: vi.fn(),
}))

vi.mock('../../../../services/PromptSuggestion/speculation.js', () => ({
  isSpeculationEnabled: vi.fn(() => false),
  startSpeculation: vi.fn(),
}))

import { generateSuggestion } from '../../../../services/PromptSuggestion/promptSuggestion.js'

describe('promptSuggestion', () => {
  beforeEach(() => {
    mocks.runForkedAgent.mockReset()
    mocks.getAuxiliaryTaskPolicy.mockReset()
  })

  it('routes prompt suggestions through the configured auxiliary model and task output cap', async () => {
    mocks.getAuxiliaryTaskPolicy.mockReturnValue({
      id: 'promptSuggestion',
      task: 'promptSuggestion',
      primary: 'prompt-qwen3-8b',
      fallbackChain: [],
      recoveryProfile: 'auxiliary-fast',
      allowActions: ['retry_same_model'],
      switchModelOn: ['timeout', 'connection', 'server_error'],
      failure: 'return_null',
      timeoutMs: 8000,
      maxOutputTokens: 64,
    })
    mocks.runForkedAgent.mockResolvedValue({
      messages: [
        {
          type: 'assistant',
          requestId: 'req_1',
          message: {
            content: [{ type: 'text', text: 'run tests' }],
          },
        },
      ],
    })

    const result = await generateSuggestion(
      new AbortController(),
      'user_intent',
      {
        messages: [],
        systemPrompt: [],
        userContext: {},
        systemContext: {},
        toolUseContext: {
          options: {},
        },
      } as never,
    )

    expect(result).toEqual({
      suggestion: 'run tests',
      generationRequestId: 'req_1',
    })
    expect(mocks.runForkedAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        querySource: 'prompt_suggestion',
        forkLabel: 'prompt_suggestion',
        maxOutputTokens: 64,
        skipTranscript: true,
        skipCacheWrite: true,
        modelRouteOverride: expect.objectContaining({
          primary: 'prompt-qwen3-8b',
          auxiliaryTask: 'promptSuggestion',
          recoveryMaxRetries: 0,
          recoveryTimeoutMs: 8000,
        }),
        overrides: expect.objectContaining({
          optionPatch: expect.objectContaining({
            mainLoopModel: 'prompt-qwen3-8b',
            tools: [],
            thinkingConfig: { type: 'disabled' },
          }),
        }),
      }),
    )
  })
})
