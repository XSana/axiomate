import { describe, it, expect } from 'vitest'
import {
  blockParamToNeutral,
  blockParamToAnthropic,
  messageToNeutral,
  messagesToAnthropic,
  toolsToNeutral,
  toolsToAnthropic,
  toolChoiceToNeutral,
  toolChoiceToAnthropic,
} from '../adapters/anthropicRequestAdapter.js'

// ---------------------------------------------------------------------------
// blockParamToNeutral
// ---------------------------------------------------------------------------

describe('blockParamToNeutral', () => {
  it('converts text block', () => {
    expect(blockParamToNeutral({ type: 'text', text: 'hello' })).toEqual({
      type: 'text',
      text: 'hello',
    })
  })

  it('strips cache_control from text block', () => {
    const result = blockParamToNeutral({
      type: 'text',
      text: 'cached',
      cache_control: { type: 'ephemeral' },
    })
    expect(result).toEqual({ type: 'text', text: 'cached' })
    expect('cache_control' in result).toBe(false)
  })

  it('converts image block (base64 source)', () => {
    expect(
      blockParamToNeutral({
        type: 'image',
        source: { type: 'base64', data: 'abc123', media_type: 'image/png' },
      }),
    ).toEqual({ type: 'image', mediaType: 'image/png', data: 'abc123' })
  })

  it('converts tool_result block', () => {
    expect(
      blockParamToNeutral({
        type: 'tool_result',
        tool_use_id: 'toolu_01',
        content: 'file contents',
        is_error: false,
      }),
    ).toEqual({
      type: 'tool_result',
      toolUseId: 'toolu_01',
      content: 'file contents',
      isError: false,
    })
  })

  it('converts tool_result with nested content blocks', () => {
    const result = blockParamToNeutral({
      type: 'tool_result',
      tool_use_id: 'toolu_02',
      content: [{ type: 'text', text: 'output' }],
    })
    expect(result).toMatchObject({
      type: 'tool_result',
      toolUseId: 'toolu_02',
      content: [{ type: 'text', text: 'output' }],
    })
  })

  it('converts tool_use block', () => {
    expect(
      blockParamToNeutral({
        type: 'tool_use',
        id: 'toolu_03',
        name: 'Read',
        input: { path: '/a' },
      }),
    ).toEqual({
      type: 'tool_use',
      id: 'toolu_03',
      name: 'Read',
      input: { path: '/a' },
    })
  })

  it('converts thinking block', () => {
    expect(
      blockParamToNeutral({
        type: 'thinking',
        thinking: 'hmm',
        signature: 'sig',
      }),
    ).toEqual({ type: 'thinking', thinking: 'hmm', signature: 'sig' })
  })

  it('converts unknown block type to empty text', () => {
    expect(
      blockParamToNeutral({ type: 'document', source: { type: 'base64' } }),
    ).toEqual({ type: 'text', text: '' })
  })
})

// ---------------------------------------------------------------------------
// messageToNeutral
// ---------------------------------------------------------------------------

describe('messageToNeutral', () => {
  it('converts user message with string content', () => {
    expect(
      messageToNeutral({ role: 'user', content: 'hello' }),
    ).toEqual({ role: 'user', content: 'hello' })
  })

  it('converts user message with block array content', () => {
    const result = messageToNeutral({
      role: 'user',
      content: [
        { type: 'text', text: 'look at this' },
        { type: 'tool_result', tool_use_id: 'toolu_01', content: 'ok' },
      ],
    })
    expect(result.role).toBe('user')
    expect(result.content).toHaveLength(2)
    expect((result.content as any)[0]).toEqual({ type: 'text', text: 'look at this' })
    expect((result.content as any)[1]).toMatchObject({
      type: 'tool_result',
      toolUseId: 'toolu_01',
    })
  })

  it('converts assistant message with content blocks', () => {
    const result = messageToNeutral({
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will read that' },
        { type: 'tool_use', id: 'toolu_01', name: 'Read', input: {} },
      ],
    })
    expect(result.role).toBe('assistant')
    expect((result as any).content).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// blockParamToAnthropic (reverse)
// ---------------------------------------------------------------------------

describe('blockParamToAnthropic', () => {
  it('converts neutral text → Anthropic text', () => {
    expect(blockParamToAnthropic({ type: 'text', text: 'hi' })).toMatchObject({
      type: 'text',
      text: 'hi',
    })
  })

  it('converts neutral image → Anthropic image', () => {
    const result = blockParamToAnthropic({
      type: 'image',
      mediaType: 'image/jpeg',
      data: 'base64data',
    })
    expect(result).toMatchObject({
      type: 'image',
      source: { type: 'base64', data: 'base64data', media_type: 'image/jpeg' },
    })
  })

  it('converts neutral tool_result → Anthropic tool_result', () => {
    const result = blockParamToAnthropic({
      type: 'tool_result',
      toolUseId: 'toolu_01',
      content: 'output',
      isError: true,
    })
    expect(result).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu_01',
      content: 'output',
      is_error: true,
    })
  })

  it('converts neutral tool_use → Anthropic tool_use', () => {
    const result = blockParamToAnthropic({
      type: 'tool_use',
      id: 'toolu_01',
      name: 'Read',
      input: { path: '/a' },
    })
    expect(result).toMatchObject({
      type: 'tool_use',
      id: 'toolu_01',
      name: 'Read',
      input: { path: '/a' },
    })
  })

  it('converts neutral thinking → Anthropic thinking', () => {
    const result = blockParamToAnthropic({
      type: 'thinking',
      thinking: 'hmm',
      signature: 'sig',
    })
    expect(result).toMatchObject({
      type: 'thinking',
      thinking: 'hmm',
      signature: 'sig',
    })
  })
})

// ---------------------------------------------------------------------------
// Round-trip: neutral → anthropic → neutral
// ---------------------------------------------------------------------------

describe('round-trip conversion', () => {
  it('text block survives round-trip', () => {
    const original = { type: 'text' as const, text: 'hello' }
    expect(blockParamToNeutral(blockParamToAnthropic(original))).toEqual(original)
  })

  it('tool_use block survives round-trip', () => {
    const original = {
      type: 'tool_use' as const,
      id: 'toolu_01',
      name: 'Read',
      input: { path: '/a' },
    }
    expect(blockParamToNeutral(blockParamToAnthropic(original))).toEqual(original)
  })

  it('tool_result block survives round-trip', () => {
    const original = {
      type: 'tool_result' as const,
      toolUseId: 'toolu_01',
      content: 'output',
      isError: false,
    }
    expect(blockParamToNeutral(blockParamToAnthropic(original))).toEqual(original)
  })
})

// ---------------------------------------------------------------------------
// toolsToNeutral / toolsToAnthropic
// ---------------------------------------------------------------------------

describe('toolsToNeutral', () => {
  it('converts BetaTool to ToolDefinition', () => {
    const tools = [
      {
        name: 'Read',
        description: 'Read a file',
        input_schema: {
          type: 'object' as const,
          properties: { path: { type: 'string' } },
        },
      },
    ]
    expect(toolsToNeutral(tools as any)).toEqual([
      {
        name: 'Read',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
        },
      },
    ])
  })

  it('filters out special tool types without input_schema', () => {
    const tools = [
      { name: 'bash', type: 'bash_20250124' },
      { name: 'Read', input_schema: { type: 'object' }, description: 'read' },
    ]
    const result = toolsToNeutral(tools as any)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Read')
  })
})

describe('toolsToAnthropic', () => {
  it('converts ToolDefinition to BetaTool', () => {
    const result = toolsToAnthropic([
      {
        name: 'Read',
        description: 'Read a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ])
    expect(result[0]).toMatchObject({
      name: 'Read',
      description: 'Read a file',
      input_schema: { type: 'object', properties: { path: { type: 'string' } } },
    })
  })
})

// ---------------------------------------------------------------------------
// toolChoiceToNeutral / toolChoiceToAnthropic
// ---------------------------------------------------------------------------

describe('toolChoiceToNeutral', () => {
  it('maps auto', () => expect(toolChoiceToNeutral({ type: 'auto' })).toEqual({ type: 'auto' }))
  it('maps any → required', () => expect(toolChoiceToNeutral({ type: 'any' })).toEqual({ type: 'required' }))
  it('maps tool → specific', () =>
    expect(toolChoiceToNeutral({ type: 'tool', name: 'Read' })).toEqual({ type: 'specific', name: 'Read' }))
  it('maps none', () => expect(toolChoiceToNeutral({ type: 'none' })).toEqual({ type: 'none' }))
  it('returns undefined for undefined', () => expect(toolChoiceToNeutral(undefined)).toBeUndefined())
})

describe('toolChoiceToAnthropic', () => {
  it('maps auto', () => expect(toolChoiceToAnthropic({ type: 'auto' })).toEqual({ type: 'auto' }))
  it('maps required → any', () => expect(toolChoiceToAnthropic({ type: 'required' })).toEqual({ type: 'any' }))
  it('maps specific → tool', () =>
    expect(toolChoiceToAnthropic({ type: 'specific', name: 'Read' })).toEqual({ type: 'tool', name: 'Read' }))
  it('maps none', () => expect(toolChoiceToAnthropic({ type: 'none' })).toEqual({ type: 'none' }))
  it('returns undefined for undefined', () => expect(toolChoiceToAnthropic(undefined)).toBeUndefined())
})

// ---------------------------------------------------------------------------
// messagesToAnthropic
// ---------------------------------------------------------------------------

describe('messagesToAnthropic', () => {
  it('converts neutral messages to Anthropic format', () => {
    const result = messagesToAnthropic([
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi back' }],
      },
    ])
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ role: 'user', content: 'hello' })
    expect(result[1].role).toBe('assistant')
    expect((result[1].content as any)[0]).toMatchObject({
      type: 'text',
      text: 'hi back',
    })
  })
})
