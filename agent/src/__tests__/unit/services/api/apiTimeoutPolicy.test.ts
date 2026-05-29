import { describe, expect, it, vi } from 'vitest'

import {
  applyApiTimeoutTraceContext,
  resolveApiTimeoutPolicy,
  withApiTimeout,
} from '../../../../services/api/apiTimeoutPolicy.js'
import { LLMAbortError } from '../../../../services/api/streamTypes.js'

describe('api timeout policy', () => {
  it('labels stream first-byte and idle timeouts separately', () => {
    expect(
      resolveApiTimeoutPolicy({
        protocol: 'openai-responses',
        operation: 'stream',
        streamPhase: 'first_byte',
      }),
    ).toEqual({
      timeoutKind: 'first_byte_timeout',
      timeoutMs: 45_000,
    })

    expect(
      resolveApiTimeoutPolicy({
        protocol: 'openai-responses',
        operation: 'stream',
        streamPhase: 'streaming',
      }),
    ).toEqual({
      timeoutKind: 'stream_idle_timeout',
      timeoutMs: 90_000,
    })
  })

  it('widens non-streaming timeout for large inputs', () => {
    expect(
      resolveApiTimeoutPolicy({
        protocol: 'openai-responses',
        operation: 'non_streaming_fallback',
        estimatedInputTokens: 10_000,
      }),
    ).toEqual({
      timeoutKind: 'non_streaming_timeout',
      timeoutMs: 120_000,
    })

    expect(
      resolveApiTimeoutPolicy({
        protocol: 'openai-responses',
        operation: 'non_streaming_fallback',
        estimatedInputTokens: 80_000,
      }),
    ).toEqual({
      timeoutKind: 'non_streaming_timeout',
      timeoutMs: 180_000,
    })
  })

  it('honors API_TIMEOUT_MS for non-streaming fallback', () => {
    vi.stubEnv('API_TIMEOUT_MS', '250000')
    try {
      expect(
        resolveApiTimeoutPolicy({
          protocol: 'anthropic',
          operation: 'non_streaming_fallback',
          estimatedInputTokens: 80_000,
        }),
      ).toEqual({
        timeoutKind: 'non_streaming_timeout',
        timeoutMs: 250_000,
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('uses source-aware auxiliary timeouts', () => {
    expect(
      resolveApiTimeoutPolicy({
        protocol: 'openai-chat',
        operation: 'side_query',
        querySource: 'side_question',
      }),
    ).toEqual({
      timeoutKind: 'auxiliary_timeout',
      timeoutMs: 60_000,
    })

    expect(
      resolveApiTimeoutPolicy({
        protocol: 'openai-chat',
        operation: 'side_query',
        querySource: 'session_search',
      }),
    ).toEqual({
      timeoutKind: 'auxiliary_timeout',
      timeoutMs: 60_000,
    })

    expect(
      resolveApiTimeoutPolicy({
        protocol: 'openai-chat',
        operation: 'inference',
        querySource: 'generate_session_title',
      }),
    ).toEqual({
      timeoutKind: 'auxiliary_timeout',
      timeoutMs: 30_000,
    })
  })

  it('throws protocol-neutral timeout errors', async () => {
    vi.useFakeTimers()
    try {
      const promise = withApiTimeout(
        { timeoutKind: 'auxiliary_timeout', timeoutMs: 25 },
        undefined,
        () => new Promise(() => {}),
      )
      const expectation = expect(promise).rejects.toMatchObject({
        name: 'LLMTimeoutError',
        message: 'auxiliary_timeout after 25ms',
      })

      await vi.advanceTimersByTimeAsync(25)
      await expectation
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not wait for timeout when parent aborts', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const promise = withApiTimeout(
        { timeoutKind: 'auxiliary_timeout', timeoutMs: 25_000 },
        controller.signal,
        () => new Promise(() => {}),
      )

      const expectation = expect(promise).rejects.toBeInstanceOf(LLMAbortError)
      controller.abort('user_stop')
      await expectation
    } finally {
      vi.useRealTimers()
    }
  })

  it('writes timeout policy fields into trace context only when requested', () => {
    const context: {
      timeoutKind?: ReturnType<typeof resolveApiTimeoutPolicy>['timeoutKind']
      timeoutMs?: number
    } = {}

    applyApiTimeoutTraceContext(context, {
      timeoutKind: 'non_streaming_timeout',
      timeoutMs: 120_000,
    })

    expect(context).toEqual({
      timeoutKind: 'non_streaming_timeout',
      timeoutMs: 120_000,
    })
    expect(() =>
      applyApiTimeoutTraceContext(undefined, {
        timeoutKind: 'auxiliary_timeout',
        timeoutMs: 30_000,
      }),
    ).not.toThrow()
  })
})
