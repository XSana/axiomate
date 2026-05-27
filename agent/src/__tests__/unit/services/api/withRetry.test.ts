import { describe, expect, it } from 'vitest'

import {
  CannotRetryError,
  FallbackTriggeredError,
  withRetry,
} from '../../../../services/api/withRetry.js'
import { LLMAPIError } from '../../../../services/api/streamTypes.js'

async function consume<T>(
  gen: AsyncGenerator<unknown, T>,
): Promise<T> {
  for (;;) {
    const next = await gen.next()
    if (next.done) return next.value
  }
}

const retryOptions = {
  model: 'provider-main-model',
  thinkingConfig: { type: 'disabled' as const },
}

describe('withRetry semantic recovery', () => {
  it('does not blindly retry compression-class payload errors', async () => {
    let calls = 0
    const gen = withRetry(
      async () => ({}),
      async () => {
        calls++
        throw new LLMAPIError('Request Entity Too Large', { status: 413 })
      },
      {
        ...retryOptions,
        maxRetries: 10,
      },
    )

    await expect(consume(gen)).rejects.toBeInstanceOf(CannotRetryError)
    expect(calls).toBe(1)
  })

  it('switches to a distinct fallback model for model_not_found', async () => {
    const gen = withRetry(
      async () => ({}),
      async () => {
        throw new LLMAPIError('model not found', { status: 404 })
      },
      {
        ...retryOptions,
        fallbackModel: 'provider-fallback-model',
      },
    )

    await expect(consume(gen)).rejects.toBeInstanceOf(FallbackTriggeredError)
  })

  it('can defer model_not_found fallback for stream-creation routing', async () => {
    const gen = withRetry(
      async () => ({}),
      async () => {
        throw new LLMAPIError('model not found', { status: 404 })
      },
      {
        ...retryOptions,
        fallbackModel: 'provider-fallback-model',
        deferModelNotFoundFallback: true,
      },
    )

    await expect(consume(gen)).rejects.toBeInstanceOf(CannotRetryError)
  })

  it('switches to a distinct fallback model for non-retryable semantic fallback hints', async () => {
    const gen = withRetry(
      async () => ({}),
      async () => {
        throw new LLMAPIError('insufficient credits', { status: 402 })
      },
      {
        ...retryOptions,
        fallbackModel: 'provider-fallback-model',
      },
    )

    await expect(consume(gen)).rejects.toBeInstanceOf(FallbackTriggeredError)
  })

  it('does not trigger a fallback loop when fallback model equals current model', async () => {
    const gen = withRetry(
      async () => ({}),
      async () => {
        throw new LLMAPIError('model not found', { status: 404 })
      },
      {
        ...retryOptions,
        fallbackModel: 'provider-main-model',
      },
    )

    await expect(consume(gen)).rejects.toBeInstanceOf(CannotRetryError)
  })
})
