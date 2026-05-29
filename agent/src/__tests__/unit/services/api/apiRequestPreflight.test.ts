import { describe, expect, it } from 'vitest'

import {
  API_REQUEST_PREFLIGHT_RULES,
  applyApiRequestPreflight,
} from '../../../../services/api/apiRequestPreflight.js'

function makeBody(model: string) {
  return {
    model,
    service_tier: 'priority',
    tools: [
      {
        type: 'function',
        name: 'pick_model',
        parameters: {
          type: 'object',
          properties: {
            model_id: {
              type: 'string',
              enum: ['Qwen/Qwen3.5-0.8B', 'plain-id'],
            },
          },
        },
      },
    ],
  }
}

describe('API request preflight compatibility rules', () => {
  it('has stable rule ids', () => {
    expect(API_REQUEST_PREFLIGHT_RULES.map(rule => rule.id)).toEqual([
      'grok-responses-strip-service-tier-and-slash-enums',
    ])
  })

  it('strips service_tier and slash enums only for Grok Responses models', () => {
    const result = applyApiRequestPreflight(
      'openai-responses',
      makeBody('grok-4.3'),
    )
    const tools = result.tools as any[]

    expect(result).not.toHaveProperty('service_tier')
    expect(
      tools[0].parameters.properties.model_id,
    ).not.toHaveProperty('enum')
  })

  it('also applies to aggregator-prefixed Grok model names', () => {
    const result = applyApiRequestPreflight(
      'openai-responses',
      makeBody('x-ai/grok-4.3'),
    )
    const tools = result.tools as any[]

    expect(result).not.toHaveProperty('service_tier')
    expect(
      tools[0].parameters.properties.model_id,
    ).not.toHaveProperty('enum')
  })

  it('preserves non-Grok Responses requests', () => {
    const result = applyApiRequestPreflight(
      'openai-responses',
      makeBody('gpt-5.5'),
    )
    const tools = result.tools as any[]

    expect(result.service_tier).toBe('priority')
    expect(
      tools[0].parameters.properties.model_id.enum,
    ).toEqual(['Qwen/Qwen3.5-0.8B', 'plain-id'])
  })

  it('does not apply Grok rules to other protocols', () => {
    const result = applyApiRequestPreflight(
      'openai-chat',
      makeBody('grok-4.3'),
    )
    const tools = result.tools as any[]

    expect(result.service_tier).toBe('priority')
    expect(
      tools[0].parameters.properties.model_id.enum,
    ).toEqual(['Qwen/Qwen3.5-0.8B', 'plain-id'])
  })
})
