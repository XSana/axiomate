/**
 * Converts between neutral request types and Anthropic SDK types.
 *
 * Two directions:
 * - toNeutral: internal Message[] → neutral MessageParam[] (for StreamRequest)
 * - toAnthropic: neutral types → Anthropic SDK types (inside AnthropicProvider)
 */
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  AssistantMessageParam,
  ContentBlockParam,
  ImageBlockParam,
  MessageParam,
  TextBlockParam,
  ThinkingBlockParam,
  ToolChoice,
  ToolDefinition,
  ToolResultBlockParam,
  ToolUseBlockParam,
  UserMessageParam,
} from '../streamTypes.js'

// =====================================================================
// Internal Message → Neutral (toNeutral)
// =====================================================================

/**
 * Convert an internal message (UserMessage | AssistantMessage) to neutral MessageParam.
 * Accepts the raw `.message` field from internal types.
 */
export function messageToNeutral(msg: {
  role: 'user' | 'assistant'
  content: string | any[]
}): MessageParam {
  if (msg.role === 'user') {
    return {
      role: 'user',
      content:
        typeof msg.content === 'string'
          ? msg.content
          : msg.content.map(blockParamToNeutral),
    } as UserMessageParam
  }
  return {
    role: 'assistant',
    content: Array.isArray(msg.content)
      ? msg.content.map(blockParamToNeutral)
      : [],
  } as AssistantMessageParam
}

/**
 * Convert a single Anthropic BetaContentBlockParam to neutral ContentBlockParam.
 */
export function blockParamToNeutral(block: any): ContentBlockParam {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'image':
      return {
        type: 'image',
        mediaType: block.source?.media_type ?? 'image/png',
        data: block.source?.data ?? '',
      }
    case 'tool_result':
      return {
        type: 'tool_result',
        toolUseId: block.tool_use_id,
        content:
          typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? block.content.map(blockParamToNeutral) as TextBlockParam[]
              : '',
        isError: block.is_error,
      }
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input ?? {},
      }
    case 'thinking':
      return {
        type: 'thinking',
        thinking: block.thinking,
        signature: block.signature,
      }
    default:
      // Unknown block types (document, redacted_thinking, etc.) → text placeholder
      return { type: 'text', text: '' }
  }
}

/**
 * Convert Anthropic BetaToolUnion[] to neutral ToolDefinition[].
 */
export function toolsToNeutral(tools: BetaToolUnion[]): ToolDefinition[] {
  return tools
    .filter((t): t is BetaToolUnion & { name: string; input_schema?: any } =>
      'name' in t && 'input_schema' in t,
    )
    .map(t => ({
      name: t.name,
      description: (t as any).description,
      inputSchema: (t as any).input_schema ?? { type: 'object' },
    }))
}

/**
 * Convert Anthropic BetaToolChoice to neutral ToolChoice.
 */
export function toolChoiceToNeutral(
  choice: BetaToolChoiceAuto | BetaToolChoiceTool | { type: string; name?: string } | undefined,
): ToolChoice | undefined {
  if (!choice) return undefined
  switch (choice.type) {
    case 'auto':
      return { type: 'auto' }
    case 'any':
      return { type: 'required' }
    case 'tool':
      return { type: 'specific', name: choice.name }
    case 'none':
      return { type: 'none' }
    default:
      return { type: 'auto' }
  }
}

// =====================================================================
// Neutral → Anthropic (toAnthropic)
// =====================================================================

/**
 * Convert neutral MessageParam[] to Anthropic BetaMessageParam[].
 */
export function messagesToAnthropic(messages: MessageParam[]): BetaMessageParam[] {
  return messages.map(msg => ({
    role: msg.role,
    content:
      typeof msg.content === 'string'
        ? msg.content
        : msg.content.map(blockParamToAnthropic),
  }))
}

/**
 * Convert a single neutral ContentBlockParam to Anthropic BetaContentBlockParam.
 */
export function blockParamToAnthropic(block: ContentBlockParam): BetaContentBlockParam {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text } as BetaContentBlockParam
    case 'image':
      return {
        type: 'image',
        source: {
          type: 'base64',
          data: block.data,
          media_type: block.mediaType as any,
        },
      } as BetaContentBlockParam
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content:
          typeof block.content === 'string'
            ? block.content
            : block.content.map(b => blockParamToAnthropic(b)),
        is_error: block.isError,
      } as BetaContentBlockParam
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
      } as BetaContentBlockParam
    case 'thinking':
      return {
        type: 'thinking',
        thinking: block.thinking,
        signature: block.signature ?? '',
      } as BetaContentBlockParam
  }
}

/**
 * Convert neutral ToolDefinition[] to Anthropic BetaToolUnion[].
 */
export function toolsToAnthropic(tools: ToolDefinition[]): BetaToolUnion[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object' as const,
      ...t.inputSchema,
    },
  }))
}

/**
 * Convert neutral ToolChoice to Anthropic BetaToolChoice.
 */
export function toolChoiceToAnthropic(
  choice: ToolChoice | undefined,
): BetaToolChoiceAuto | BetaToolChoiceTool | { type: 'any' } | { type: 'none' } | undefined {
  if (!choice) return undefined
  switch (choice.type) {
    case 'auto':
      return { type: 'auto' }
    case 'none':
      return { type: 'none' }
    case 'required':
      return { type: 'any' }
    case 'specific':
      return { type: 'tool', name: choice.name }
  }
}
