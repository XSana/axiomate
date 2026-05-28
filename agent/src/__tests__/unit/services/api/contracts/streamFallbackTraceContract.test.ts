import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  SystemAPIErrorMessage,
} from '../../../../../types/message.js'
import type {
  BoundProvider,
  LLMProvider,
  ProviderStreamResult,
  StreamRequest,
} from '../../../../../services/api/provider.js'
import type { RecoveryTraceEvent } from '../../../../../services/api/recoveryTrace.js'
import {
  LLMAPIError,
  type LLMMessage,
  type StreamEvent,
} from '../../../../../services/api/streamTypes.js'
import { asSystemPrompt } from '../../../../../utils/systemPromptType.js'
import { readFixture } from './fixtureUtils.js'
import { queryModelWithStreaming } from '../../../../../services/api/llm.js'

const fakeProviderState = vi.hoisted(() => ({
  mode: 'stream_fallback' as 'stream_fallback' | 'watchdog_retry',
  streamError: new Error('Stream ended without receiving any events') as unknown,
  streamAttempts: 0,
}))

vi.mock('../../../../../services/api/providerRegistry.js', () => ({
  getProviderForModel: () => new FakeFallbackProvider(fakeProviderState),
}))

vi.mock('../../../../../services/vcr.js', () => ({
  withStreamingVCR: async function* (
    _messages: unknown[],
    f: () => AsyncGenerator<unknown, void>,
  ) {
    yield* f()
  },
  withVCR: async (_messages: unknown[], f: () => Promise<unknown>) => f(),
}))

vi.mock('../../../../../services/analytics/index.js', () => ({
  logEvent: vi.fn(),
}))

vi.mock('../../../../../utils/sleep.js', () => ({
  sleep: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../../../../utils/diagLogs.js', () => ({
  logForDiagnosticsNoPII: vi.fn(),
}))

vi.mock('../../../../../utils/model/model.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../../../utils/model/model.js')>()
  return {
    ...actual,
    normalizeModelStringForAPI: (model: string) => model,
  }
})

vi.mock('../../../../../utils/config.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../../../utils/config.js')>()
  return {
    ...actual,
    getGlobalConfig: () => ({
      ...actual.DEFAULT_GLOBAL_CONFIG,
      models: {
        'gpt-4o': {
          model: 'gpt-4o',
          protocol: 'openai-chat',
          baseUrl: 'https://example.invalid/v1',
          apiKey: 'test-key',
          contextWindow: 128000,
          maxOutputTokens: 4096,
        },
      },
    }),
  }
})

function makeFallbackMessage(): LLMMessage {
  return {
    id: 'msg_fallback_trace',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'fallback ok' }],
    model: 'gpt-4o',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 3,
      output_tokens: 2,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
  }
}

function makeSuccessfulRetryStreamResult(
  request: StreamRequest,
  attempt: number,
): ProviderStreamResult {
  const requestId = `req_watchdog_${attempt}`
  const responseHeaders = new Headers({ 'x-request-id': requestId })
  request.hooks?.onAttemptStart?.({ attempt, start: Date.now() })
  request.hooks?.onRequestSent?.({
    maxOutputTokens: 4096,
    requestId,
    response: { headers: responseHeaders },
  })
  request.hooks?.onProviderEvent?.({ type: 'ttfb', ms: 3 })
  request.hooks?.onProviderEvent?.({ type: 'bytes', bytes: 23 })

  return {
    requestId,
    responseHeaders,
    maxOutputTokens: 4096,
    stream: {
      async *[Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
        yield {
          type: 'response_start',
          response: {
            id: 'resp_watchdog_success',
            model: 'gpt-4o',
            stopReason: null,
            usage: { inputTokens: 2, outputTokens: 0 },
          },
        }
        yield {
          type: 'block_start',
          index: 0,
          block: { type: 'text', text: '' },
        }
        yield {
          type: 'block_delta',
          index: 0,
          delta: { type: 'text', text: 'retry ok' },
        }
        yield { type: 'block_stop', index: 0 }
        yield {
          type: 'response_delta',
          stopReason: 'end_turn',
          usage: { inputTokens: 2, outputTokens: 2 },
        }
        yield { type: 'response_stop' }
      },
    },
  }
}

function makeWatchdogStreamResult(
  request: StreamRequest,
  attempt: number,
): ProviderStreamResult {
  const requestId = `req_watchdog_${attempt}`
  const responseHeaders = new Headers({ 'x-request-id': requestId })
  let releaseStream!: () => void
  const streamReleased = new Promise<void>(resolve => {
    releaseStream = resolve
  })
  const response = {
    headers: responseHeaders,
    body: {
      cancel: () => {
        releaseStream()
        return Promise.resolve()
      },
    },
  }

  request.hooks?.onAttemptStart?.({ attempt, start: Date.now() })
  request.hooks?.onRequestSent?.({
    maxOutputTokens: 4096,
    requestId,
    response,
  })
  request.hooks?.onProviderEvent?.({ type: 'ttfb', ms: 7 })
  request.hooks?.onProviderEvent?.({ type: 'bytes', bytes: 13 })

  return {
    requestId,
    responseHeaders,
    maxOutputTokens: 4096,
    stream: {
      async *[Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
        await streamReleased
      },
    },
  }
}

type FakeProviderState = typeof fakeProviderState

class FakeFallbackProvider implements LLMProvider {
  readonly name = 'openai-chat'

  constructor(private readonly state: FakeProviderState) {}

  async *createStream(
    request: StreamRequest,
  ): AsyncGenerator<SystemAPIErrorMessage, ProviderStreamResult> {
    return yield* this.bind().createStream(request)
  }

  bind(): BoundProvider {
    return {
      createStream: async function* (
        request: StreamRequest,
      ): AsyncGenerator<
        never,
        ProviderStreamResult
      > {
        this.state.streamAttempts++
        const attempt = this.state.streamAttempts
        if (this.state.mode === 'watchdog_retry') {
          return attempt === 1
            ? makeWatchdogStreamResult(request, attempt)
            : makeSuccessfulRetryStreamResult(request, attempt)
        }

        const streamError = this.state.streamError
        return {
          requestId: 'req_stream_trace',
          responseHeaders: undefined,
          maxOutputTokens: 4096,
          stream: {
            async *[Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
              yield {
                type: 'response_start',
                response: {
                  id: 'resp_trace',
                  model: 'gpt-4o',
                  stopReason: null,
                  usage: { inputTokens: 1, outputTokens: 0 },
                },
              }
              throw streamError
            },
          },
        }
      }.bind(this),
      createNonStreamingFallback: async function* (
        _request: StreamRequest,
      ): AsyncGenerator<never, { message: LLMMessage; requestId: string }> {
        return {
          message: makeFallbackMessage(),
          requestId: 'req_fallback_trace',
        }
      },
    }
  }

  classifyError() {
    return { retryable: false, type: 'other' as const }
  }

  calculateCost() {
    return null
  }

  wrapError(error: unknown): LLMAPIError {
    if (error instanceof LLMAPIError) return error
    return new LLMAPIError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    )
  }

  inference(): never {
    throw new Error('not used')
  }

  countTokens(): Promise<number | null> {
    return Promise.resolve(null)
  }
}

function projectTrace(event: RecoveryTraceEvent) {
  return {
    protocol: event.protocol,
    reason: event.reason,
    intent: event.intent,
    action: event.action,
    outcome: event.outcome,
    repeatPolicy: event.repeatPolicy,
    requestId: event.requestId,
    streamPhase: event.streamPhase,
    innerCause: event.innerCause,
    ...(event.ttfbMs !== undefined ? { ttfbMs: event.ttfbMs } : {}),
    ...(event.bytesReceived !== undefined
      ? { bytesReceived: event.bytesReceived }
      : {}),
    ...(event.safeHeaders !== undefined
      ? { safeHeaders: event.safeHeaders }
      : {}),
    final: event.final,
  }
}

type QueryModelWithStreamingInput = Parameters<typeof queryModelWithStreaming>[0]

function makeModelOptions(
  traces: RecoveryTraceEvent[],
): QueryModelWithStreamingInput['options'] {
  return {
    getToolPermissionContext: async () => ({
      mode: 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
    }),
    model: 'gpt-4o',
    isNonInteractiveSession: true,
    querySource: 'sdk',
    agents: [],
    hasAppendSystemPrompt: false,
    mcpTools: [],
    onRecoveryTrace: event => traces.push(event),
  }
}

async function collect(
  gen: AsyncGenerator<unknown, unknown>,
): Promise<unknown[]> {
  const messages: unknown[] = []
  for await (const message of gen) {
    messages.push(message)
  }
  return messages
}

describe('stream fallback recovery trace golden fixture', () => {
  beforeEach(() => {
    fakeProviderState.mode = 'stream_fallback'
    fakeProviderState.streamError = new Error(
      'Stream ended without receiving any events',
    )
    fakeProviderState.streamAttempts = 0
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('emits non_streaming_fallback trace before running fallback request', async () => {
    const traces: RecoveryTraceEvent[] = []
    const messages = await collect(
      queryModelWithStreaming({
        messages: [],
        systemPrompt: asSystemPrompt([]),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: new AbortController().signal,
        options: makeModelOptions(traces),
      }),
    )

    expect(messages.some(message => (message as { type?: string }).type === 'assistant')).toBe(true)
    expect(traces.map(projectTrace)).toEqual(
      readFixture('api-recovery/stream-fallback-trace.json'),
    )
  })

  it('emits stream watchdog retry trace with stream observability fields', async () => {
    vi.stubEnv('AXIOMATE_ENABLE_STREAM_WATCHDOG', '1')
    vi.stubEnv('AXIOMATE_STREAM_IDLE_TIMEOUT_MS', '1')
    fakeProviderState.mode = 'watchdog_retry'

    const traces: RecoveryTraceEvent[] = []
    const messages = await collect(
      queryModelWithStreaming({
        messages: [],
        systemPrompt: asSystemPrompt([]),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: new AbortController().signal,
        options: makeModelOptions(traces),
      }),
    )

    expect(messages.some(message => (message as { type?: string }).type === 'assistant')).toBe(true)
    expect(fakeProviderState.streamAttempts).toBe(2)
    expect(traces.map(projectTrace)).toEqual(
      readFixture('api-recovery/stream-watchdog-trace.json'),
    )
  })
})
