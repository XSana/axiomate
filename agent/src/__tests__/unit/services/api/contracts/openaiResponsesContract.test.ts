import { describe, expect, it, vi } from 'vitest'

import { shouldUseNonStreamingFallbackForStreamError } from '../../../../../services/api/llm.js'
import { OpenAIResponsesStreamState } from '../../../../../services/api/adapters/openaiResponsesStreamAdapter.js'
import { OpenAIResponsesProvider } from '../../../../../services/api/providers/openaiResponsesProvider.js'
import { classifyError } from '../../../../../services/api/errorClassifier.js'
import { LLMAPIError } from '../../../../../services/api/streamTypes.js'
import { withRetry } from '../../../../../services/api/withRetry.js'
import type { ResponseStreamEvent } from 'openai/resources/responses/responses'
import { readFixture, stableJson } from './fixtureUtils.js'

vi.mock('../../../../../services/api/withRetry.js', () => ({
  withRetry: vi.fn(async function* (getClient: any, operation: any, options: any) {
    const client = await getClient()
    return await operation(client, 1, {
      model: options.model,
      thinkingConfig: options.thinkingConfig,
    })
  }),
}))

type ResponsesStreamFixture = {
  name: string
  events: unknown[]
  flush: boolean
  streamEvents?: unknown[]
  throws?: {
    status: number
    messageIncludes: string
  }
}

function makeProvider(model = 'gpt-4o') {
  return new OpenAIResponsesProvider({
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'test-key',
    modelConfig: {
      model,
      protocol: 'openai-responses',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-key',
    },
  })
}

function attachClient(provider: OpenAIResponsesProvider, response: unknown) {
  ;(provider as any).client = {
    responses: {
      create: vi.fn().mockResolvedValue(response),
    },
  }
}

describe('OpenAI Responses SDK retry policy', () => {
  it('passes maxRetries:0 to SDK calls so withRetry owns retries', async () => {
    const provider = makeProvider()
    attachClient(provider, {
      id: 'resp_123',
      model: 'gpt-4o',
      output: [
        {
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'ok' }],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 1 },
    })

    await provider.inference({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    })

    const create = (provider as any).client.responses.create
    expect(create.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ maxRetries: 0 }),
    )
  })
})

function makeIntent() {
  return {
    model: 'gpt-4o',
    messages: [
      {
        type: 'user',
        message: { role: 'user' as const, content: 'hi' },
        uuid: 'msg_1',
      },
    ],
    systemPrompt: [],
    tools: [],
    maxOutputTokens: 4096,
    thinking: { type: 'disabled' as const },
  }
}

async function consume<T>(gen: AsyncGenerator<unknown, T>): Promise<T> {
  for (;;) {
    const next = await gen.next()
    if (next.done) return next.value
  }
}

describe('OpenAI Responses stream event-order golden fixtures', () => {
  it.each(
    readFixture<ResponsesStreamFixture[]>('openai-responses/stream-events.json'),
  )('$name', fixture => {
    const state = new OpenAIResponsesStreamState()
    const events: unknown[] = []

    const runFixture = () => {
      for (const event of fixture.events) {
        events.push(...state.mapEvent(event as ResponseStreamEvent))
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
        const classified = classifyError(error, {
          provider: 'openai-responses',
          model: 'gpt-4o',
        })
        expect(classified.reason).toBe('server_error')
        expect(classified.retryable).toBe(true)
      }
      return
    }

    runFixture()
    expect(stableJson(events)).toEqual(fixture.streamEvents)
  })
})

describe('OpenAI Responses stream fallback parity', () => {
  it('uses non-streaming fallback for stream-shape failures before assistant output', () => {
    expect(
      shouldUseNonStreamingFallbackForStreamError(
        makeProvider(),
        new LLMAPIError(
          'Responses stream: text delta for output_index=0 without prior message item',
          { status: 502 },
        ),
        'gpt-4o',
      ),
    ).toBe(true)
  })

  it('does not use non-streaming fallback after assistant output was committed', () => {
    expect(
      shouldUseNonStreamingFallbackForStreamError(
        makeProvider(),
        new LLMAPIError(
          'Responses stream: text delta for output_index=0 without prior message item',
          { status: 502 },
        ),
        'gpt-4o',
        { committedAssistantMessages: 1 },
      ),
    ).toBe(false)
  })

  it('defers model_not_found fallback during stream creation like Chat', async () => {
    const provider = makeProvider()
    attachClient(provider, {
      [Symbol.asyncIterator]: async function* () {},
    })

    const gen = provider.bind({
      retryOptions: {
        model: 'gpt-4o',
        thinkingConfig: { type: 'disabled' },
        fallbackModel: 'gpt-4o-mini',
      },
    }).createStream({
      model: 'gpt-4o',
      signal: new AbortController().signal,
      intent: makeIntent() as any,
    })
    await consume(gen)

    expect(vi.mocked(withRetry).mock.calls.at(-1)?.[2]).toMatchObject({
      model: 'gpt-4o',
      fallbackModel: 'gpt-4o-mini',
      deferModelNotFoundFallback: true,
    })
  })
})

describe('OpenAI Responses non-streaming fallback response validation', () => {
  it('throws retryable LLMAPIError(502) when fallback response has empty output', async () => {
    const provider = makeProvider()
    attachClient(provider, {
      id: 'resp_empty',
      model: 'gpt-4o',
      status: 'completed',
      output: [],
      usage: {
        input_tokens: 5,
        output_tokens: 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 5,
      },
    })

    const gen = provider.bind(undefined).createNonStreamingFallback!({
      model: 'gpt-4o',
      signal: new AbortController().signal,
      intent: makeIntent() as any,
    })

    try {
      await consume(gen)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(LLMAPIError)
      expect((error as LLMAPIError).status).toBe(502)
      expect((error as LLMAPIError).message).toContain('empty content')
      const classified = classifyError(error, {
        provider: 'openai-responses',
        model: 'gpt-4o',
      })
      expect(classified.reason).toBe('server_error')
      expect(classified.retryable).toBe(true)
    }
  })
})
