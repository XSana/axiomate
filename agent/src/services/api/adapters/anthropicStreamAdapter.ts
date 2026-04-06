/**
 * Converts Anthropic BetaRawMessageStreamEvent stream to neutral StreamEvent stream.
 */
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageDeltaUsage,
  BetaRawMessageStreamEvent,
  BetaStopReason,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  BlockDelta,
  ContentBlock,
  LLMResponse,
  ServerToolResultBlock,
  StopReason,
  StreamEvent,
  Usage,
} from '../streamTypes.js'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Adapts an Anthropic raw SSE stream into neutral StreamEvent.
 * Optionally calls `onRawEvent` for each raw event before conversion,
 * allowing the caller to perform provider-specific side effects
 * (stall detection, TTFB recording, research capture, etc.)
 */
export async function* anthropicStreamAdapter(
  stream: AsyncIterable<BetaRawMessageStreamEvent>,
  onRawEvent?: (raw: BetaRawMessageStreamEvent) => void,
): AsyncGenerator<StreamEvent> {
  for await (const raw of stream) {
    onRawEvent?.(raw)
    const neutral = convertToNeutral(raw)
    if (neutral) {
      yield neutral
    }
  }
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

function convertToNeutral(
  event: BetaRawMessageStreamEvent,
): StreamEvent | null {
  switch (event.type) {
    case 'message_start':
      return {
        type: 'response_start',
        response: mapResponse(event.message),
      }

    case 'content_block_start':
      return {
        type: 'block_start',
        index: event.index,
        block: mapContentBlock(event.content_block),
      }

    case 'content_block_delta': {
      const delta = mapDelta(event.delta)
      if (!delta) return null // unknown delta type (e.g. citations_delta)
      return {
        type: 'block_delta',
        index: event.index,
        delta,
      }
    }

    case 'content_block_stop':
      return {
        type: 'block_stop',
        index: event.index,
      }

    case 'message_delta':
      return {
        type: 'response_delta',
        stopReason: mapStopReason(event.delta.stop_reason),
        usage: mapDeltaUsage(event.usage),
      }

    case 'message_stop':
      return { type: 'response_stop' }

    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Mappers (exported for testing)
// ---------------------------------------------------------------------------

export function mapStopReason(reason: BetaStopReason | null): StopReason {
  switch (reason) {
    case 'end_turn':
      return 'end_turn'
    case 'tool_use':
      return 'tool_use'
    case 'max_tokens':
      return 'max_tokens'
    case 'stop_sequence':
      return 'stop_sequence'
    case 'content_filter':
      return 'content_filter'
    case null:
      return null
    default:
      // Unknown stop reasons (refusal, model_context_window_exceeded, etc.)
      // Map to 'end_turn' as safest default — the model stopped producing output.
      return 'end_turn'
  }
}

export function mapContentBlock(block: BetaContentBlock | { type: string; [key: string]: unknown }): ContentBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text ?? '' }
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: typeof block.input === 'object' && block.input !== null
          ? block.input
          : {},
      }
    case 'thinking':
      return {
        type: 'thinking',
        thinking: block.thinking ?? '',
        signature: block.signature,
      }
    case 'server_tool_use':
      return {
        type: 'server_tool_use',
        id: block.id,
        name: block.name,
        input: typeof block.input === 'object' && block.input !== null
          ? block.input
          : {},
      }
    case 'redacted_thinking':
      return { type: 'redacted_thinking', data: block.data ?? '' }
    default: {
      // web_search_tool_result, etc. → wrap as server_tool_result
      // Preserves provider-specific block data for consumers that need it
      const result: ServerToolResultBlock = {
        type: 'server_tool_result',
        id: block.id ?? '',
        toolUseId: block.tool_use_id ?? '',
        content: block.content ?? block,
      }
      return result
    }
  }
}

export function mapDelta(delta: any): BlockDelta | null {
  switch (delta.type) {
    case 'text_delta':
      return { type: 'text', text: delta.text }
    case 'input_json_delta':
      return { type: 'tool_input', json: delta.partial_json }
    case 'thinking_delta':
      return { type: 'thinking', thinking: delta.thinking }
    case 'signature_delta':
      return { type: 'signature', signature: delta.signature }
    case 'citations_delta':
      return { type: 'citations', citation: delta.citation }
    case 'connector_text_delta':
      return { type: 'connector_text', text: delta.connector_text }
    default:
      return null
  }
}

export function mapUsage(usage: BetaMessage['usage']): Usage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    ...(usage?.cache_read_input_tokens != null && {
      cacheReadTokens: usage.cache_read_input_tokens,
    }),
    ...(usage?.cache_creation_input_tokens != null && {
      cacheWriteTokens: usage.cache_creation_input_tokens,
    }),
  }
}

/**
 * Map message_delta usage to neutral Usage.
 * Note: BetaMessageDeltaUsage SDK type only declares output_tokens,
 * but the API sends input_tokens too — access it via extended type.
 */
export function mapDeltaUsage(usage: BetaMessageDeltaUsage): Usage {
  const extended = usage as BetaMessageDeltaUsage & {
    input_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  return {
    inputTokens: extended.input_tokens ?? 0,
    outputTokens: extended.output_tokens ?? 0,
    ...(extended.cache_read_input_tokens != null && {
      cacheReadTokens: extended.cache_read_input_tokens,
    }),
    ...(extended.cache_creation_input_tokens != null && {
      cacheWriteTokens: extended.cache_creation_input_tokens,
    }),
  }
}

export function mapResponse(message: BetaMessage): LLMResponse {
  return {
    id: message.id,
    model: message.model,
    stopReason: mapStopReason(message.stop_reason),
    usage: mapUsage(message.usage),
  }
}
