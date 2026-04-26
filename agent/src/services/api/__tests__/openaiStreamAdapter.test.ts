import { describe, expect, it } from 'vitest'
import {
  OpenAIStreamState,
  type OpenAIChatChunk,
} from '../adapters/openaiStreamAdapter.js'

describe('OpenAIStreamState usage mapping', () => {
  it('maps cache usage from OpenAI-compatible stream chunks', () => {
    const state = new OpenAIStreamState()
    const events = state.mapChunk({
      id: 'chatcmpl_test',
      model: 'qwen3.6-plus',
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 50,
        total_tokens: 1050,
        prompt_tokens_details: {
          cached_tokens: 400,
        },
      },
    } as OpenAIChatChunk)

    const responseDelta = events.find(event => event.type === 'response_delta')
    expect(responseDelta?.type === 'response_delta' ? responseDelta.usage : null)
      .toEqual({
        inputTokens: 600,
        outputTokens: 50,
        cacheReadTokens: 400,
      })
  })
})
