/**
 * OpenAI Responses API stream adapter.
 *
 * Converts the SDK's `ResponseStreamEvent` SSE stream into protocol-neutral
 * `StreamEvent` for processStream(). Mirrors the OpenAIStreamState pattern
 * used by chat completions but with a different state machine — Responses API
 * emits typed output items (message / function_call / reasoning) rather than
 * delta-merged choice messages.
 */
import type { ResponseOutputItem, ResponseStreamEvent } from 'openai/resources/responses/responses'
import {
  LLMAPIError,
  type ContentBlock,
  type LLMResponse,
  type StopReason,
  type StreamEvent,
} from '../streamTypes.js'
import { mapOpenAIResponsesUsage } from './openaiResponsesUsageMapper.js'

type ReasoningState = {
  index: number
  itemId: string
  // Each completed summary part appended in order; current accumulating
  // part is buffered separately until reasoning_summary_part.done.
  finishedParts: string[]
  currentPart: string
  currentSummaryIndex: number | null
}

type MessageState = {
  index: number
  itemId: string
}

type FunctionCallState = {
  index: number
  itemId: string
}

const FAILED_STATUS = 502

/**
 * Stateful translator from OpenAI Responses SSE events to neutral StreamEvent.
 *
 * Lifecycle: instantiate per request, call mapEvent() on each SDK event,
 * yield the returned event(s). Throws LLMAPIError on response.failed /
 * response.incomplete so the retry harness can classify and recover.
 */
export class OpenAIResponsesStreamState {
  private response: LLMResponse | undefined
  private nextIndex = 0
  private completed = false
  // Map output_index → state for each open output item.
  private reasoning = new Map<number, ReasoningState>()
  private messages = new Map<number, MessageState>()
  private functionCalls = new Map<number, FunctionCallState>()

  get hasCompletedResponse(): boolean {
    return this.completed
  }

  mapEvent(event: ResponseStreamEvent): StreamEvent[] {
    switch (event.type) {
      case 'response.created':
        return this.onResponseCreated(event.response)

      case 'response.in_progress':
        return []

      case 'response.output_item.added':
        return this.onOutputItemAdded(event.output_index, event.item)

      case 'response.output_text.delta':
        return [
          {
            type: 'block_delta',
            index: this.requireMessageIndex(event.output_index),
            delta: { type: 'text', text: event.delta },
          },
        ]

      case 'response.output_text.done':
        // Text done is informational; block closure happens via output_item.done.
        return []

      case 'response.function_call_arguments.delta':
        return [
          {
            type: 'block_delta',
            index: this.requireFunctionCallIndex(event.output_index),
            delta: { type: 'tool_input', json: event.delta },
          },
        ]

      case 'response.function_call_arguments.done':
        // Done is informational; closure via output_item.done.
        return []

      case 'response.reasoning_summary_part.added': {
        const state = this.reasoning.get(event.output_index)
        if (state) {
          // Starting a new part. If there's a buffered current part, push it.
          if (state.currentSummaryIndex !== null && state.currentPart.length > 0) {
            state.finishedParts.push(state.currentPart)
          }
          state.currentPart = ''
          state.currentSummaryIndex = event.summary_index
        }
        return []
      }

      case 'response.reasoning_summary_text.delta': {
        const state = this.reasoning.get(event.output_index)
        if (!state) return []
        state.currentPart += event.delta
        return [
          {
            type: 'block_delta',
            index: state.index,
            delta: { type: 'thinking', thinking: event.delta },
          },
        ]
      }

      case 'response.reasoning_summary_text.done':
        // Text done is informational; part transitions handled by part.added/done.
        return []

      case 'response.reasoning_summary_part.done': {
        const state = this.reasoning.get(event.output_index)
        if (state && state.currentSummaryIndex !== null) {
          state.finishedParts.push(state.currentPart)
          state.currentPart = ''
          state.currentSummaryIndex = null
        }
        return []
      }

      case 'response.output_item.done':
        return this.onOutputItemDone(event.output_index, event.item)

      case 'response.completed':
        return this.onResponseCompleted(event.response)

      case 'response.failed':
        throw new LLMAPIError(
          formatResponseError(event.response, 'response.failed'),
          { status: FAILED_STATUS },
        )

      case 'response.incomplete':
        throw new LLMAPIError(
          formatResponseError(event.response, 'response.incomplete'),
          { status: FAILED_STATUS },
        )

      case 'error':
        throw new LLMAPIError(
          `Responses stream error: ${(event as { message?: string }).message ?? 'unknown'}`,
          { status: FAILED_STATUS },
        )

      default:
        // Built-in tool events (web_search, file_search, code_interpreter, etc.)
        // and content-part / refusal events are not surfaced — we don't expose
        // built-in tools yet. Silently drop.
        return []
    }
  }

  /**
   * Emit final block_stop events for any output items that didn't receive an
   * output_item.done event before the stream ended. Defensive — a clean
   * stream closes everything via output_item.done.
   */
  flush(): StreamEvent[] {
    const events: StreamEvent[] = []
    for (const state of this.reasoning.values()) {
      events.push({ type: 'block_stop', index: state.index })
    }
    for (const state of this.messages.values()) {
      events.push({ type: 'block_stop', index: state.index })
    }
    for (const state of this.functionCalls.values()) {
      events.push({ type: 'block_stop', index: state.index })
    }
    this.reasoning.clear()
    this.messages.clear()
    this.functionCalls.clear()
    return events
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private onResponseCreated(response: { id: string; model: string }): StreamEvent[] {
    this.response = {
      id: response.id,
      model: response.model,
      stopReason: null,
      usage: { inputTokens: 0, outputTokens: 0 },
    }
    return [{ type: 'response_start', response: this.response }]
  }

  private onOutputItemAdded(outputIndex: number, item: ResponseOutputItem): StreamEvent[] {
    switch (item.type) {
      case 'message': {
        const blockIndex = this.nextIndex++
        this.messages.set(outputIndex, { index: blockIndex, itemId: item.id as string })
        return [
          {
            type: 'block_start',
            index: blockIndex,
            block: { type: 'text', text: '' },
          },
        ]
      }
      case 'function_call': {
        const blockIndex = this.nextIndex++
        this.functionCalls.set(outputIndex, { index: blockIndex, itemId: item.id as string })
        const block: ContentBlock = {
          type: 'tool_use',
          id: item.call_id as string,
          name: item.name as string,
          input: {},
        }
        return [{ type: 'block_start', index: blockIndex, block }]
      }
      case 'reasoning': {
        const blockIndex = this.nextIndex++
        this.reasoning.set(outputIndex, {
          index: blockIndex,
          itemId: item.id as string,
          finishedParts: [],
          currentPart: '',
          currentSummaryIndex: null,
        })
        const block: ContentBlock = {
          type: 'thinking',
          thinking: '',
          roundTrip: { provider: 'none' },
        }
        return [{ type: 'block_start', index: blockIndex, block }]
      }
      default:
        // Unhandled output item types (built-in tools): no block_start.
        return []
    }
  }

  private onOutputItemDone(outputIndex: number, item: ResponseOutputItem): StreamEvent[] {
    switch (item.type) {
      case 'message': {
        const state = this.messages.get(outputIndex)
        if (!state) return []
        this.messages.delete(outputIndex)
        return [{ type: 'block_stop', index: state.index }]
      }
      case 'function_call': {
        const state = this.functionCalls.get(outputIndex)
        if (!state) return []
        this.functionCalls.delete(outputIndex)
        return [{ type: 'block_stop', index: state.index }]
      }
      case 'reasoning': {
        const state = this.reasoning.get(outputIndex)
        if (!state) return []
        this.reasoning.delete(outputIndex)

        // Finalize any in-progress summary part
        if (state.currentSummaryIndex !== null && state.currentPart.length > 0) {
          state.finishedParts.push(state.currentPart)
        }

        const summaryParts = (item.summary as Array<{ text: string }> | undefined)
          ?.map(s => s.text)
          ?? state.finishedParts

        const encryptedContent = item.encrypted_content as string | null | undefined

        return [
          {
            type: 'block_delta',
            index: state.index,
            delta: {
              type: 'thinking_round_trip',
              roundTrip: {
                provider: 'openai-responses',
                id: (item.id as string) ?? state.itemId,
                ...(encryptedContent ? { encryptedContent } : {}),
                summaryParts,
              },
            },
          },
          { type: 'block_stop', index: state.index },
        ]
      }
      default:
        return []
    }
  }

  private onResponseCompleted(response: {
    status?: string | null
    usage?: import('openai/resources/responses/responses').ResponseUsage
    incomplete_details?: { reason?: string | null } | null
  }): StreamEvent[] {
    this.completed = true
    const usage = mapOpenAIResponsesUsage(response.usage)
    const stopReason = mapStopReason(response.status, response.incomplete_details?.reason)
    return [
      { type: 'response_delta', stopReason, usage },
      { type: 'response_stop' },
    ]
  }

  private requireMessageIndex(outputIndex: number): number {
    const state = this.messages.get(outputIndex)
    if (!state) {
      throw new LLMAPIError(
        `Responses stream: text delta for output_index=${outputIndex} without prior message item`,
        { status: FAILED_STATUS },
      )
    }
    return state.index
  }

  private requireFunctionCallIndex(outputIndex: number): number {
    const state = this.functionCalls.get(outputIndex)
    if (!state) {
      throw new LLMAPIError(
        `Responses stream: function call args delta for output_index=${outputIndex} without prior function_call item`,
        { status: FAILED_STATUS },
      )
    }
    return state.index
  }
}

function mapStopReason(
  status: string | null | undefined,
  incompleteReason: string | null | undefined,
): StopReason {
  if (incompleteReason === 'max_output_tokens' || incompleteReason === 'max_tokens') {
    return 'max_tokens'
  }
  if (incompleteReason === 'content_filter') {
    return 'content_filter'
  }
  switch (status) {
    case 'completed':
      return 'end_turn'
    case 'incomplete':
      return 'end_turn'
    default:
      return 'end_turn'
  }
}

function formatResponseError(
  response: { error?: { message?: string | null; code?: string | null } | null; incomplete_details?: { reason?: string | null } | null },
  prefix: string,
): string {
  const errMsg = response.error?.message
  const errCode = response.error?.code
  const incompleteReason = response.incomplete_details?.reason
  const parts: string[] = [prefix]
  if (errCode) parts.push(`[${errCode}]`)
  if (errMsg) parts.push(errMsg)
  if (incompleteReason) parts.push(`(incomplete: ${incompleteReason})`)
  return parts.join(' ')
}
