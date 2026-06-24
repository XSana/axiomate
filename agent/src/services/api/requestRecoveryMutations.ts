import type { NeutralToolSchema } from './streamTypes.js'
import type {
  Base64ImageSource,
  ContentBlockParam,
  ImageBlockParam,
  MessageParam,
  TextBlockParam,
} from './streamTypes.js'
import {
  getImageRecoveryRewritePolicy,
  resolveImageRecoveryProfile,
  type ImageRecoveryProfile,
} from './imageRecovery.js'
import { maybeResizeAndDownsampleImageBuffer } from '../../utils/imageResizer.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type ImageRewriteOptions = {
  profile?: ImageRecoveryProfile
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

export function stripSlashEnumValuesFromJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => stripSlashEnumValuesFromJsonSchema(item))
  }

  if (!isRecord(value)) {
    return value
  }

  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (
      key === 'enum' &&
      Array.isArray(child) &&
      child.some(item => typeof item === 'string' && item.includes('/'))
    ) {
      continue
    }
    next[key] = stripSlashEnumValuesFromJsonSchema(child)
  }
  return next
}

export function stripSlashEnumValuesFromTools<T extends readonly unknown[]>(
  tools: T,
): T {
  return tools.map(tool =>
    stripSlashEnumValuesFromJsonSchema(tool),
  ) as unknown as T
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

export async function rewriteImagePayloadsForRecovery<T>(
  messages: T,
  options?: ImageRewriteOptions,
): Promise<T> {
  if (!Array.isArray(messages)) {
    return messages
  }

  const rewritten = await Promise.all(
    messages.map(message => rewriteImagePayloadsInMessage(message, options)),
  )
  return rewritten as T
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

async function rewriteImagePayloadsInMessage(
  message: unknown,
  options?: ImageRewriteOptions,
): Promise<unknown> {
  if (!isRecord(message)) {
    return message
  }

  if (isRecord(message.message)) {
    const inner = await rewriteImagePayloadsInMessageParam(
      message.message as MessageParam,
      options,
    )
    return inner === message.message ? message : { ...message, message: inner }
  }

  if ('role' in message && 'content' in message) {
    return rewriteImagePayloadsInMessageParam(message as MessageParam, options)
  }

  return message
}

async function rewriteImagePayloadsInMessageParam(
  message: MessageParam,
  options?: ImageRewriteOptions,
): Promise<MessageParam> {
  if (!Array.isArray(message.content)) {
    return message
  }

  const content = await rewriteImagePayloadsInBlocks(message.content, options)
  return content === message.content ? message : { ...message, content }
}

async function rewriteImagePayloadsInBlocks(
  blocks: readonly ContentBlockParam[],
  options?: ImageRewriteOptions,
): Promise<ContentBlockParam[]> {
  let changed = false
  const rewritten: ContentBlockParam[] = []
  for (const block of blocks) {
    const next = await rewriteImagePayloadsInBlock(block, options)
    changed ||= next !== block
    rewritten.push(next)
  }
  return changed ? rewritten : (blocks as ContentBlockParam[])
}

async function rewriteImagePayloadsInBlock(
  block: ContentBlockParam,
  options?: ImageRewriteOptions,
): Promise<ContentBlockParam> {
  if (block.type === 'image') {
    return rewriteImageBlockForRecovery(block, options)
  }

  if (block.type !== 'tool_result' || !Array.isArray(block.content)) {
    return block
  }

  if (options?.profile === 'drop_or_textualize_tool_result_images') {
    const profile = resolveImageRecoveryProfile(options.profile)
    let changed = false
    const content: (TextBlockParam | ImageBlockParam)[] = block.content.map(part => {
      if (part.type !== 'image') {
        return part
      }
      changed = true
      return {
        type: 'text' as const,
        text: `[Image omitted from tool result during API retry: ${profile}]`,
      }
    })
    return changed ? { ...block, content } : block
  }

  const content = await rewriteToolResultContentImagePayloads(
    block.content,
    options,
  )
  return content === block.content ? block : { ...block, content }
}

async function rewriteToolResultContentImagePayloads(
  blocks: readonly (TextBlockParam | ImageBlockParam)[],
  options?: ImageRewriteOptions,
): Promise<(TextBlockParam | ImageBlockParam)[]> {
  let changed = false
  const rewritten: (TextBlockParam | ImageBlockParam)[] = []
  for (const block of blocks) {
    if (block.type !== 'image') {
      rewritten.push(block)
      continue
    }
    const next = await rewriteImageBlockForRecovery(block, options)
    changed ||= next !== block
    rewritten.push(next)
  }
  return changed ? rewritten : [...blocks]
}

async function rewriteImageBlockForRecovery(
  block: ImageBlockParam,
  options?: ImageRewriteOptions,
): Promise<ImageBlockParam> {
  if (block.source.type !== 'base64') {
    return block
  }

  const policy = getImageRecoveryRewritePolicy(options?.profile)
  const buffer = Buffer.from(block.source.data, 'base64')
  const resized = await maybeResizeAndDownsampleImageBuffer(
    buffer,
    buffer.length,
    imageExtension(block.source),
    {
      maxWidth: policy.maxWidth,
      maxHeight: policy.maxHeight,
      targetRawSize: policy.targetRawSize,
      jpegQualitySteps: policy.jpegQualitySteps,
      fallbackMaxEdge: policy.fallbackMaxEdge,
      forceJpeg: policy.forceJpeg,
      allowRawFallback: false,
    },
  )
  const data = resized.buffer.toString('base64')
  const media_type = `image/${resized.mediaType}` as Base64ImageSource['media_type']

  if (
    data === block.source.data &&
    media_type === block.source.media_type
  ) {
    return block
  }

  return {
    ...block,
    source: {
      type: 'base64',
      media_type,
      data,
    },
  }
}

function imageExtension(source: Base64ImageSource): string {
  return source.media_type.split('/')[1] ?? 'png'
}
