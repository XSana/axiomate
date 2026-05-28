import { describe, expect, it } from 'vitest'

import {
  classifyError,
  type ClassifiedError,
} from '../../../../../services/api/errorClassifier.js'
import { shouldUseNonStreamingFallbackForStreamError } from '../../../../../services/api/llm.js'
import {
  OpenAIStreamState,
  type OpenAIChatChunk,
} from '../../../../../services/api/adapters/openaiStreamAdapter.js'
import { OpenAIProvider } from '../../../../../services/api/providers/openaiProvider.js'
import { resolveRecoveryAction } from '../../../../../services/api/recoveryAction.js'
import type { RecoveryTraceEvent } from '../../../../../services/api/recoveryTrace.js'
import { LLMAPIError } from '../../../../../services/api/streamTypes.js'
import type {
  MessageParam,
  NeutralToolSchema,
  StreamIntent,
} from '../../../../../services/api/streamTypes.js'
import {
  CannotRetryError,
  type RetryContext,
  withRetry,
} from '../../../../../services/api/withRetry.js'
import { readFixture, stableJson } from './fixtureUtils.js'

type ErrorEnvelopeFixture = {
  name: string
  status: number
  message: string
  headers?: Record<string, string>
  error?: unknown
  reason: ClassifiedError['reason']
  action: ReturnType<typeof resolveRecoveryAction> | 'non_streaming_fallback'
  useNonStreamingFallback: boolean
}

type StreamChunkFixture = {
  name: string
  chunks: unknown[]
  flush: boolean
  events?: unknown[]
  throws?: {
    status: number
    messageIncludes: string
  }
}

const baseMessages: MessageParam[] = [
  { role: 'user', content: 'Summarize the repo status.' },
]

const toolResultMessages: MessageParam[] = [
  ...baseMessages,
  {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'call_read_1',
        name: 'Read',
        input: { file_path: 'C:/repo/README.md' },
      },
    ],
  },
  {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'call_read_1',
        content: [
          { type: 'text', text: 'file contents' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'iVBORw0KGgo=',
            },
          },
        ],
      },
    ],
  },
]

const tools: NeutralToolSchema[] = [
  {
    name: 'Read',
    description: 'Read a workspace file.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute file path.',
          pattern: '^[A-Z]:\\\\.*',
          format: 'uri',
        },
      },
      required: ['file_path'],
    },
  },
]

function makeProvider() {
  return new OpenAIProvider({
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'test-key',
    modelConfig: {
      model: 'gpt-4o',
      protocol: 'openai-chat',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-key',
    },
  })
}

function makeIntent(messages: MessageParam[] = baseMessages): StreamIntent {
  return {
    model: 'gpt-4o',
    messages: messages.map((message, index) => ({
      type: message.role,
      message,
      uuid: `msg_${index}`,
    })),
    systemPrompt: [{ type: 'text', text: 'You are concise.' }],
    tools,
    toolChoice: { type: 'auto' },
    maxOutputTokens: 4096,
    temperature: 0.2,
    thinking: { type: 'disabled' },
  }
}

function buildRequestBody(
  retryContext: Partial<
    Omit<RetryContext, 'omittedRequestFields'> & {
      omittedRequestFields: readonly string[]
    }
  > = {},
  messages: MessageParam[] = baseMessages,
) {
  const provider = makeProvider()
  return stableJson(
    (
      provider as unknown as {
        buildRequestBodyForRetry(
          model: string,
          intent: StreamIntent,
          retryContext: RetryContext,
          options: { stream: boolean },
        ): Record<string, unknown>
      }
    ).buildRequestBodyForRetry(
      'gpt-4o',
      makeIntent(messages),
      {
        model: 'gpt-4o',
        thinkingConfig: { type: 'disabled' },
        ...retryContext,
        omittedRequestFields: retryContext.omittedRequestFields
          ? [...retryContext.omittedRequestFields]
          : undefined,
      },
      { stream: true },
    ),
  )
}

async function consume<T>(gen: AsyncGenerator<unknown, T>): Promise<T> {
  for (;;) {
    const next = await gen.next()
    if (next.done) return next.value
  }
}

function projectTrace(event: RecoveryTraceEvent) {
  return {
    observationId: event.observationId,
    decisionId: event.decisionId,
    reason: event.reason,
    intent: event.intent,
    action: event.action,
    outcome: event.outcome,
    repeatPolicy: event.repeatPolicy,
    ...(event.ruleId ? { ruleId: event.ruleId } : {}),
    ...(event.previousReason ? { previousReason: event.previousReason } : {}),
    ...(event.previousIntent ? { previousIntent: event.previousIntent } : {}),
    ...(event.previousAction ? { previousAction: event.previousAction } : {}),
    ...(event.requestId ? { requestId: event.requestId } : {}),
    ...(event.streamPhase ? { streamPhase: event.streamPhase } : {}),
    ...(event.ttfbMs !== undefined ? { ttfbMs: event.ttfbMs } : {}),
    ...(event.elapsedMs !== undefined ? { elapsedMs: event.elapsedMs } : {}),
    ...(event.bytesReceived !== undefined
      ? { bytesReceived: event.bytesReceived }
      : {}),
    ...(event.innerCause ? { innerCause: event.innerCause } : {}),
    ...(event.safeHeaders ? { safeHeaders: event.safeHeaders } : {}),
    ...(event.mutation ? { mutation: event.mutation } : {}),
    final: event.final,
  }
}

describe('OpenAI Chat request body golden fixtures', () => {
  it.each([
    ['normal stream', {}, 'openai-chat/request.normal-stream.json', baseMessages],
    [
      'drop max_tokens',
      { dropMaxTokens: true },
      'openai-chat/request.drop-max-tokens.json',
      baseMessages,
    ],
    [
      'omit unsupported temperature',
      { omittedRequestFields: ['temperature'] },
      'openai-chat/request.omit-temperature.json',
      baseMessages,
    ],
    [
      'strip llama.cpp unsupported schema keywords',
      { stripJsonSchemaKeywords: true },
      'openai-chat/request.strip-schema-keywords.json',
      baseMessages,
    ],
    [
      'downgrade multimodal tool result content',
      { downgradeMultimodalToolContent: true },
      'openai-chat/request.downgrade-tool-content.json',
      toolResultMessages,
    ],
  ] as const)('%s', (_name, retryContext, fixture, messages) => {
    expect(buildRequestBody(retryContext, messages)).toEqual(
      readFixture(fixture),
    )
  })
})

describe('OpenAI Chat error envelope golden fixtures', () => {
  const provider = makeProvider()

  it.each(readFixture<ErrorEnvelopeFixture[]>('openai-chat/error-envelopes.json'))(
    '$name',
    fixture => {
      const error = new LLMAPIError(fixture.message, {
        status: fixture.status,
        headers: fixture.headers,
        error: fixture.error,
      })
      const classified = classifyError(error, {
        provider: 'openai-chat',
        model: 'gpt-4o',
      })

      expect(classified.reason).toBe(fixture.reason)
      expect(
        shouldUseNonStreamingFallbackForStreamError(provider, error, 'gpt-4o'),
      ).toBe(fixture.useNonStreamingFallback)

      if (fixture.action !== 'non_streaming_fallback') {
        expect(
          resolveRecoveryAction(classified, {
            canFallback: fixture.action === 'fallback_model',
          }),
        ).toBe(fixture.action)
      }
    },
  )
})

describe('OpenAI Chat stream chunk golden fixtures', () => {
  it.each(
    readFixture<StreamChunkFixture[]>('openai-chat/stream-chunks.json'),
  )('$name', fixture => {
    const state = new OpenAIStreamState()
    const events: unknown[] = []

    const runFixture = () => {
      for (const chunk of fixture.chunks) {
        events.push(...state.mapChunk(chunk as OpenAIChatChunk))
      }
      if (fixture.flush) {
        events.push(...state.flush())
      }
    }

    if (fixture.throws) {
      expect(runFixture).toThrow(LLMAPIError)
      try {
        runFixture()
      } catch (error) {
        expect(error).toBeInstanceOf(LLMAPIError)
        expect((error as LLMAPIError).status).toBe(fixture.throws.status)
        expect((error as LLMAPIError).message).toContain(
          fixture.throws.messageIncludes,
        )
      }
      return
    }

    runFixture()
    expect(stableJson(events)).toEqual(fixture.events)
  })

  it('does not choose non-streaming fallback after a tool_use was yielded', () => {
    const provider = makeProvider()
    const state = new OpenAIStreamState()
    const events = [
      ...state.mapChunk({
        id: 'chatcmpl_tool_partial',
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_read_1',
                  type: 'function',
                  function: { name: 'Read', arguments: '{"file_path":"' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      } as OpenAIChatChunk),
      ...state.mapChunk({
        id: 'chatcmpl_tool_partial',
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: 'C:/repo/README.md"}' } },
              ],
            },
            finish_reason: null,
          },
        ],
      } as OpenAIChatChunk),
      ...state.flush(),
    ]

    expect(events.some(event => event.type === 'block_stop')).toBe(true)
    expect(
      shouldUseNonStreamingFallbackForStreamError(
        provider,
        new Error('Stream ended without receiving any events'),
        'gpt-4o',
        { committedAssistantMessages: 1 },
      ),
    ).toBe(false)
  })
})

describe('OpenAI Chat retry trace golden fixtures', () => {
  it('emits stable trace sequence for request mutations', async () => {
    const traces: RecoveryTraceEvent[] = []
    const cases = [
      {
        errors: [
          new LLMAPIError('max_tokens is too large', { status: 400 }),
          new LLMAPIError('max_tokens is too large', { status: 400 }),
        ],
      },
      {
        errors: [
          new LLMAPIError('Unsupported parameter: temperature', {
            status: 400,
            error: {
              error: {
                code: 'unsupported_parameter',
                param: 'temperature',
              },
            },
          }),
          new LLMAPIError('Unsupported parameter: temperature', {
            status: 400,
            error: {
              error: {
                code: 'unsupported_parameter',
                param: 'temperature',
              },
            },
          }),
        ],
      },
      {
        errors: [
          new LLMAPIError('error parsing grammar: json-schema-to-grammar', {
            status: 400,
          }),
          new LLMAPIError('error parsing grammar: json-schema-to-grammar', {
            status: 400,
          }),
        ],
      },
    ]

    for (const contractCase of cases) {
      let call = 0
      const gen = withRetry(
        async () => ({}),
        async () => {
          throw contractCase.errors[Math.min(call++, contractCase.errors.length - 1)]
        },
        {
          protocol: 'openai-chat',
          model: 'gpt-4o',
          thinkingConfig: { type: 'disabled' },
          maxRetries: 10,
          onRecoveryTrace: event => traces.push(event),
        },
      )
      await expect(consume(gen)).rejects.toBeInstanceOf(CannotRetryError)
    }

    expect(traces.map(projectTrace)).toEqual(
      readFixture('openai-chat/retry-traces.json'),
    )
  })
})
