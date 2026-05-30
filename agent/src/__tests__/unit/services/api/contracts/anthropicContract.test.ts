import type {
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { describe, expect, it } from 'vitest'

import { anthropicStreamAdapter } from '../../../../../services/api/adapters/anthropicStreamAdapter.js'
import { messagesToAnthropic } from '../../../../../services/api/adapters/anthropicRequestAdapter.js'
import { processStream } from '../../../../../services/api/streamAccumulator.js'
import type {
  StreamAccumulatorResult,
  StreamOutput,
} from '../../../../../services/api/streamAccumulator.js'
import type {
  MessageParam,
  StreamEvent,
} from '../../../../../services/api/streamTypes.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../../../../types/message.js'
import {
  ensureToolResultPairing,
  normalizeMessagesForAPI,
} from '../../../../../utils/messages.js'
import { readFixture, stableJson } from './fixtureUtils.js'

type AnthropicStreamFixture = {
  name: string
  events: unknown[]
  streamEvents: unknown[]
  accumulator: unknown
}

async function* streamFromEvents<T>(events: unknown[]): AsyncGenerator<T> {
  for (const event of events) {
    yield event as T
  }
}

async function collectStreamEvents(events: unknown[]): Promise<StreamEvent[]> {
  const result: StreamEvent[] = []
  for await (const event of anthropicStreamAdapter(
    streamFromEvents<BetaRawMessageStreamEvent>(events),
  )) {
    result.push(event)
  }
  return result
}

async function collectAccumulator(streamEvents: StreamEvent[]) {
  const gen = processStream(streamFromEvents<StreamEvent>(streamEvents), {
    tools: [],
    model: 'anthropic-main-model',
    maxOutputTokens: 4096,
    streamRequestId: 'req_anthropic_contract',
  })
  const outputs: StreamOutput[] = []
  let result: StreamAccumulatorResult | undefined

  for (;;) {
    const next = await gen.next()
    if (next.done) {
      result = next.value as StreamAccumulatorResult
      break
    }
    outputs.push(next.value as StreamOutput)
  }
  if (!result) {
    throw new Error('stream accumulator did not return a result')
  }

  const assistantMessages = outputs
    .filter(output => output?.type === 'assistant_message')
    .map(output => {
      const message = output.message
      return {
        content: stableJson(message.message.content),
        stopReason: message.message.stop_reason,
        usage: message.message.usage,
      }
    })

  return {
    assistantMessages,
    result: {
      hasResponseStart: result.hasResponseStart,
      newMessageCount: result.newMessages.length,
      stopReason: result.stopReason,
      usage: result.usage,
    },
  }
}

function makeAssistantMessage(
  content: AssistantMessage['message']['content'],
): AssistantMessage {
  return {
    type: 'assistant',
    uuid: '00000000-0000-4000-8000-000000000001',
    timestamp: '2026-01-01T00:00:00.000Z',
    message: {
      id: 'msg_tool_order',
      type: 'message',
      role: 'assistant',
      content,
      model: 'anthropic-main-model',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 4,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    },
  } as AssistantMessage
}

function makeUserMessage(content: UserMessage['message']['content']): UserMessage {
  return {
    type: 'user',
    uuid: '00000000-0000-4000-8000-000000000002',
    timestamp: '2026-01-01T00:00:01.000Z',
    message: {
      role: 'user',
      content,
    },
  } as UserMessage
}

function toMessageParams(
  messages: (AssistantMessage | UserMessage)[],
): MessageParam[] {
  return messages.map(message => ({
    role: message.message.role,
    content: message.message.content,
  })) as MessageParam[]
}

describe('Anthropic stream contract fixtures', () => {
  it.each(
    readFixture<AnthropicStreamFixture[]>('anthropic/stream-events.json'),
  )('$name', async fixture => {
    const streamEvents = await collectStreamEvents(fixture.events)

    expect(stableJson(streamEvents)).toEqual(fixture.streamEvents)
    expect(await collectAccumulator(streamEvents)).toEqual(fixture.accumulator)
  })
})

describe('Anthropic request contract fixtures', () => {
  it('keeps tool_result blocks before ordinary user content', () => {
    const transcript: Message[] = [
      makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'call_read_1',
          name: 'Read',
          input: { file_path: 'C:/repo/README.md' },
        },
      ]),
      makeUserMessage([
        { type: 'text', text: 'Continue after reading.' },
        {
          type: 'tool_result',
          tool_use_id: 'call_read_1',
          content: [{ type: 'text', text: 'file contents' }],
        },
      ]),
    ]

    const normalized = ensureToolResultPairing(
      normalizeMessagesForAPI(transcript),
    )
    const requestMessages = messagesToAnthropic(toMessageParams(normalized))

    expect(stableJson(requestMessages)).toEqual(
      readFixture('anthropic/request.tool-result-order.json'),
    )
  })
})
