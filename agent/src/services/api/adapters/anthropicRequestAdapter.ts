/**
 * Converts between neutral request types and Anthropic SDK types.
 *
 * Since neutral request types use snake_case (matching Anthropic SDK field names),
 * most conversions are pass-through. The adapter handles structural differences
 * (ContentBlockParam union membership, BetaToolUnion wrapper, etc.)
 */
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  ContentBlockParam,
  MessageParam,
  NeutralToolSchema,
  ToolChoice,
  ToolDefinition,
} from '../streamTypes.js'

// =====================================================================
// Internal Message → Neutral (toNeutral)
// =====================================================================

/**
 * Convert an internal message to neutral MessageParam.
 * Since field names are identical (snake_case), this is a type cast.
 */
export function messageToNeutral(msg: {
  role: 'user' | 'assistant'
  content: string | any[]
}): MessageParam {
  return msg as MessageParam
}

/**
 * Convert a single Anthropic BetaContentBlockParam to neutral ContentBlockParam.
 * Field names are identical — just a type boundary cast.
 */
export function blockParamToNeutral(block: any): ContentBlockParam {
  return block as ContentBlockParam
}

/**
 * Convert Anthropic BetaToolUnion[] to neutral ToolDefinition[].
 */
export function toolsToNeutral(tools: BetaToolUnion[]): ToolDefinition[] {
  return tools
    .filter((t): t is BetaToolUnion & { name: string; description?: string; input_schema?: Record<string, unknown> } =>
      'name' in t && 'input_schema' in t,
    )
    .map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema ?? { type: 'object' },
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
      return { type: 'specific', name: (choice as BetaToolChoiceTool).name }
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
 * Field names are identical — structural cast.
 */
export function messagesToAnthropic(messages: MessageParam[]): BetaMessageParam[] {
  return messages as unknown as BetaMessageParam[]
}

/**
 * Convert a single neutral ContentBlockParam to Anthropic BetaContentBlockParam.
 * Field names are identical — type boundary cast.
 */
export function blockParamToAnthropic(block: ContentBlockParam): BetaContentBlockParam {
  return block as unknown as BetaContentBlockParam
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
 * Convert neutral ToolChoice to Anthropic BetaToolChoice. Optionally consult
 * a vendor-supplied `toolChoiceMap` to remap variants the vendor doesn't
 * accept (e.g. MiniMax accepts only auto/none and remaps required/specific
 * to 'auto'). When `toolChoiceMap` is omitted or doesn't contain the key,
 * the default Anthropic 1P mapping applies:
 *   auto → 'auto'
 *   none → 'none'
 *   required → 'any'
 *   specific → 'tool' (keeps the user-provided name field)
 */
export function toolChoiceToAnthropic(
  choice: ToolChoice | undefined,
  toolChoiceMap?: Partial<
    Record<'auto' | 'none' | 'required' | 'specific', string | null>
  >,
): BetaToolChoiceAuto | BetaToolChoiceTool | { type: 'any' } | { type: 'none' } | undefined {
  if (!choice) return undefined
  const defaultMap: Record<'auto' | 'none' | 'required' | 'specific', string> = {
    auto: 'auto',
    none: 'none',
    required: 'any',
    specific: 'tool',
  }
  const remapped = toolChoiceMap?.[choice.type]
  // RFC 7396: null in the map deletes the mapping → fall back to default.
  const finalType =
    remapped == null ? defaultMap[choice.type] : remapped
  // Only the 'tool' (specific) form carries an inline name; every other
  // wire shape is just `{type}`.
  if (finalType === 'tool' && choice.type === 'specific') {
    return { type: 'tool', name: choice.name } as BetaToolChoiceTool
  }
  return { type: finalType } as
    | BetaToolChoiceAuto
    | { type: 'any' }
    | { type: 'none' }
}

/**
 * Convert a NeutralToolSchema to the Anthropic SDK tool format.
 *
 * Handles the field name mapping (inputSchema → input_schema) and
 * optional provider-hint fields (strict, cache_control, eager_input_streaming).
 * Unknown fields are ignored.
 */
/** Anthropic SDK tool format produced by neutralToolToSDK */
export interface AnthropicToolSchema {
  name: string
  description?: string
  input_schema: { type: 'object'; [key: string]: unknown }
  strict?: boolean
  eager_input_streaming?: boolean
  cache_control?: { type: 'ephemeral'; scope?: string; ttl?: string } | null
}

export function neutralToolToSDK(t: NeutralToolSchema): AnthropicToolSchema {
  return {
    name: t.name,
    description: t.description,
    input_schema: { type: 'object' as const, ...t.inputSchema },
    ...(t.strict ? { strict: true } : {}),
    ...(t.eager_input_streaming ? { eager_input_streaming: true } : {}),
    ...(t.cache_control ? { cache_control: t.cache_control } : {}),
  }
}
