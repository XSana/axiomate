import { describe, it, expect, vi } from 'vitest'
import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk'
import { AnthropicProvider } from '../providers/anthropicProvider.js'
import type { StreamRequest } from '../provider.js'
import type { StreamEvent } from '../streamTypes.js'

// Mock analytics (transitive dep from anthropicStreamAdapter)
vi.mock('../../../services/analytics/index.js', () => ({
  logEvent: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSDKStream(
  events: Array<Record<string, unknown>>,
) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e
    },
    controller: {},
  }
}

function createMockClient(events: Array<Record<string, unknown>>) {
  const mockStream = createMockSDKStream(events)
  return {
    beta: {
      messages: {
        create: vi.fn().mockReturnValue({
          withResponse: vi.fn().mockResolvedValue({
            data: mockStream,
            request_id: 'req_test_123',
            response: { headers: new Headers({ 'x-request-id': 'req_test_123' }) },
          }),
        }),
      },
    },
  }
}

function baseRequest(overrides: Partial<StreamRequest> = {}): StreamRequest {
  return {
    model: 'claude-opus-4-6',
    messages: [{ role: 'user', content: 'hello' }],
    systemPrompt: 'You are helpful.',
    tools: [],
    maxTokens: 4096,
    signal: new AbortController().signal,
    ...overrides,
  }
}

async function collectStream(
  stream: AsyncIterable<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const e of stream) events.push(e)
  return events
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnthropicProvider', () => {
  describe('createStream', () => {
    it('converts neutral request and returns neutral stream events', async () => {
      const sdkEvents = [
        {
          type: 'message_start',
          message: {
            id: 'msg_01',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-opus-4-6',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 50, output_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '', citations: null },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello!' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 5 },
        },
        { type: 'message_stop' },
      ]

      const mockClient = createMockClient(sdkEvents)
      const provider = new AnthropicProvider({
        getClient: vi.fn().mockResolvedValue(mockClient),
      })

      const result = await provider.createStream(baseRequest())
      expect(result.requestId).toBe('req_test_123')

      const events = await collectStream(result.stream)
      expect(events).toHaveLength(6)
      expect(events[0]).toMatchObject({ type: 'response_start' })
      expect(events[1]).toMatchObject({ type: 'block_start', block: { type: 'text' } })
      expect(events[2]).toMatchObject({ type: 'block_delta', delta: { type: 'text', text: 'Hello!' } })
      expect(events[3]).toMatchObject({ type: 'block_stop' })
      expect(events[4]).toMatchObject({ type: 'response_delta', stopReason: 'end_turn' })
      expect(events[5]).toMatchObject({ type: 'response_stop' })
    })

    it('passes neutral messages through Anthropic conversion', async () => {
      const mockClient = createMockClient([{ type: 'message_stop' }])
      const getClient = vi.fn().mockResolvedValue(mockClient)
      const provider = new AnthropicProvider({ getClient })

      await provider.createStream(baseRequest({
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                toolUseId: 'toolu_01',
                content: 'file contents',
              },
            ],
          },
        ],
        tools: [
          { name: 'Read', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
        ],
        toolChoice: { type: 'specific', name: 'Read' },
      }))

      const createCall = mockClient.beta.messages.create
      expect(createCall).toHaveBeenCalledTimes(1)
      const params = createCall.mock.calls[0][0]

      // Messages converted to Anthropic format
      expect(params.messages).toHaveLength(3)
      expect(params.messages[0]).toEqual({ role: 'user', content: 'hi' })
      expect(params.messages[2].content[0]).toMatchObject({
        type: 'tool_result',
        tool_use_id: 'toolu_01',
      })

      // Tools converted
      expect(params.tools).toHaveLength(1)
      expect(params.tools[0]).toMatchObject({
        name: 'Read',
        input_schema: { type: 'object' },
      })

      // Tool choice converted
      expect(params.tool_choice).toEqual({ type: 'tool', name: 'Read' })
    })

    it('passes provider-specific options to SDK params', async () => {
      const mockClient = createMockClient([{ type: 'message_stop' }])
      const provider = new AnthropicProvider({
        getClient: vi.fn().mockResolvedValue(mockClient),
      })

      await provider.createStream(baseRequest({
        providerOptions: {
          betas: ['beta-1', 'beta-2'],
          thinkingConfig: { type: 'adaptive' },
          metadata: { user_id: 'test' },
          speed: 'fast',
        },
      }))

      const params = mockClient.beta.messages.create.mock.calls[0][0]
      expect(params.betas).toEqual(['beta-1', 'beta-2'])
      expect(params.thinking).toEqual({ type: 'adaptive' })
      expect(params.metadata).toEqual({ user_id: 'test' })
      expect(params.speed).toBe('fast')
    })

    it('omits temperature when thinking is enabled', async () => {
      const mockClient = createMockClient([{ type: 'message_stop' }])
      const provider = new AnthropicProvider({
        getClient: vi.fn().mockResolvedValue(mockClient),
      })

      await provider.createStream(baseRequest({
        temperature: 0.7,
        providerOptions: { thinkingConfig: { type: 'adaptive' } },
      }))

      const params = mockClient.beta.messages.create.mock.calls[0][0]
      expect(params.temperature).toBeUndefined()
    })

    it('includes temperature when thinking is not enabled', async () => {
      const mockClient = createMockClient([{ type: 'message_stop' }])
      const provider = new AnthropicProvider({
        getClient: vi.fn().mockResolvedValue(mockClient),
      })

      await provider.createStream(baseRequest({ temperature: 0.5 }))

      const params = mockClient.beta.messages.create.mock.calls[0][0]
      expect(params.temperature).toBe(0.5)
    })

    it('converts string system prompt', async () => {
      const mockClient = createMockClient([{ type: 'message_stop' }])
      const provider = new AnthropicProvider({
        getClient: vi.fn().mockResolvedValue(mockClient),
      })

      await provider.createStream(baseRequest({ systemPrompt: 'Be concise.' }))

      const params = mockClient.beta.messages.create.mock.calls[0][0]
      expect(params.system).toBe('Be concise.')
    })

    it('converts array system prompt', async () => {
      const mockClient = createMockClient([{ type: 'message_stop' }])
      const provider = new AnthropicProvider({
        getClient: vi.fn().mockResolvedValue(mockClient),
      })

      await provider.createStream(baseRequest({
        systemPrompt: [
          { type: 'text', text: 'Part 1.' },
          { type: 'text', text: 'Part 2.' },
        ],
      }))

      const params = mockClient.beta.messages.create.mock.calls[0][0]
      expect(params.system).toEqual([
        { type: 'text', text: 'Part 1.' },
        { type: 'text', text: 'Part 2.' },
      ])
    })
  })

  describe('classifyError', () => {
    it('classifies 529 as retryable overloaded', () => {
      const error = new APIError(529, undefined, 'overloaded', undefined)
      const result = new AnthropicProvider({ getClient: vi.fn() }).classifyError(error)
      expect(result).toMatchObject({ retryable: true, type: 'overloaded', statusCode: 529 })
    })

    it('classifies 429 as retryable rate_limit', () => {
      const error = new APIError(429, undefined, 'rate limited', undefined)
      const result = new AnthropicProvider({ getClient: vi.fn() }).classifyError(error)
      expect(result).toMatchObject({ retryable: true, type: 'rate_limit', statusCode: 429 })
    })

    it('classifies 401 as non-retryable auth', () => {
      const error = new APIError(401, undefined, 'unauthorized', undefined)
      const result = new AnthropicProvider({ getClient: vi.fn() }).classifyError(error)
      expect(result).toMatchObject({ retryable: false, type: 'auth', statusCode: 401 })
    })

    it('classifies connection error as retryable', () => {
      const error = new APIConnectionError({ cause: { code: 'ECONNRESET' } as any })
      const result = new AnthropicProvider({ getClient: vi.fn() }).classifyError(error)
      expect(result).toMatchObject({ retryable: true, type: 'connection' })
    })

    it('classifies abort as non-retryable', () => {
      const error = new APIUserAbortError()
      const result = new AnthropicProvider({ getClient: vi.fn() }).classifyError(error)
      expect(result).toMatchObject({ retryable: false, type: 'abort' })
    })

    it('classifies unknown errors as non-retryable other', () => {
      const result = new AnthropicProvider({ getClient: vi.fn() }).classifyError(new Error('unknown'))
      expect(result).toMatchObject({ retryable: false, type: 'other' })
    })
  })

  describe('calculateCost', () => {
    it('converts neutral Usage and delegates to cost function', () => {
      const mockCostFn = vi.fn().mockReturnValue(0.05)
      const provider = new AnthropicProvider({
        getClient: vi.fn(),
        calculateUSDCost: mockCostFn,
      })

      const cost = provider.calculateCost('claude-opus-4-6', {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
      })

      expect(cost).toBe(0.05)
      expect(mockCostFn).toHaveBeenCalledWith('claude-opus-4-6', {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 0,
      })
    })

    it('returns null when no cost function configured', () => {
      const provider = new AnthropicProvider({ getClient: vi.fn() })
      expect(provider.calculateCost('model', { inputTokens: 0, outputTokens: 0 })).toBeNull()
    })
  })
})
