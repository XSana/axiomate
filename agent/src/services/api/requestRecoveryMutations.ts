import type { NeutralToolSchema } from './streamTypes.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function omitRequestFields<T extends Record<string, unknown>>(
  params: T,
  fields: readonly string[] | undefined,
): T {
  if (!fields || fields.length === 0) {
    return params
  }

  const next: Record<string, unknown> = { ...params }
  for (const field of fields) {
    delete next[field]
  }
  return next as T
}

export function stripUnsupportedJsonSchemaKeywords(
  value: unknown,
): unknown {
  if (Array.isArray(value)) {
    return value.map(item => stripUnsupportedJsonSchemaKeywords(item))
  }

  if (!isRecord(value)) {
    return value
  }

  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'pattern' || key === 'format') {
      continue
    }
    next[key] = stripUnsupportedJsonSchemaKeywords(child)
  }
  return next
}

export function stripUnsupportedJsonSchemaKeywordsFromTools(
  tools: readonly NeutralToolSchema[],
): NeutralToolSchema[] {
  return tools.map(tool => ({
    ...tool,
    inputSchema: stripUnsupportedJsonSchemaKeywords(
      tool.inputSchema,
    ) as NeutralToolSchema['inputSchema'],
  }))
}

export function stripOpenAIResponsesReasoningReplay(
  input: unknown,
): unknown {
  if (!Array.isArray(input)) {
    return input
  }

  return input
    .filter(item => !(isRecord(item) && item.type === 'reasoning'))
    .map(item => {
      if (!isRecord(item)) {
        return item
      }
      const next = { ...item }
      delete next.encrypted_content
      return next
    })
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return '(no output)'
  }

  const parts: string[] = []
  for (const part of content) {
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
      parts.push(part.text)
    } else if (isRecord(part) && part.type === 'image') {
      parts.push('[Image omitted from tool result]')
    }
  }

  return parts.join('\n') || '(no output)'
}

export function downgradeMultimodalToolResultContent(
  messages: readonly unknown[],
): unknown[] {
  return messages.map(message => {
    if (!isRecord(message)) {
      return message
    }

    if (isRecord(message.message) && Array.isArray(message.message.content)) {
      return {
        ...message,
        message: downgradeMessageToolResultContent(message.message),
      }
    }

    if (!Array.isArray(message.content)) {
      return message
    }

    return downgradeMessageToolResultContent(message)
  })
}

function downgradeMessageToolResultContent(
  message: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(message.content)) {
    return message
  }

  return {
    ...message,
    content: message.content.map(block => {
      if (!isRecord(block) || block.type !== 'tool_result') {
        return block
      }
      return {
        ...block,
        content: stringifyToolResultContent(block.content),
      }
    }),
  }
}
