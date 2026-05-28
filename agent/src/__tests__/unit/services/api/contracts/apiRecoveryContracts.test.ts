import { describe, expect, it } from 'vitest'

import {
  classifyError,
  type ClassifiedError,
  type ErrorClassificationContext,
} from '../../../../../services/api/errorClassifier.js'
import { resolveRecoveryAction } from '../../../../../services/api/recoveryAction.js'
import { LLMAPIError } from '../../../../../services/api/streamTypes.js'

type ContractCase = {
  name: string
  protocol: ErrorClassificationContext['provider']
  error: unknown
  expectedReason: ClassifiedError['reason']
  expectedAction: ReturnType<typeof resolveRecoveryAction>
  context?: Partial<ErrorClassificationContext>
}

const cases: ContractCase[] = [
  {
    name: 'OpenAI Chat: 400 unsupported temperature can omit field',
    protocol: 'openai-chat',
    error: new LLMAPIError('Unsupported parameter: temperature', {
      status: 400,
      error: { error: { code: 'unsupported_parameter', param: 'temperature' } },
    }),
    expectedReason: 'unsupported_parameter',
    expectedAction: 'omit_request_fields',
  },
  {
    name: 'OpenAI Chat: 502 request validation is not server retry',
    protocol: 'openai-chat',
    error: new LLMAPIError('Bad Gateway: unknown parameter stream_options', {
      status: 502,
      error: { error: { code: 'unknown_parameter', param: 'stream_options' } },
    }),
    expectedReason: 'unsupported_parameter',
    expectedAction: 'omit_request_fields',
  },
  {
    name: 'OpenAI Responses: invalid encrypted reasoning replay strips replay',
    protocol: 'openai-responses',
    error: new LLMAPIError(
      'Encrypted content for item rs_123 could not be verified',
      {
        status: 400,
        error: { error: { code: 'invalid_encrypted_content' } },
      },
    ),
    expectedReason: 'invalid_encrypted_content',
    expectedAction: 'strip_reasoning_replay',
  },
  {
    name: 'OpenAI-compatible: multimodal tool output can downgrade',
    protocol: 'openai-chat',
    error: new LLMAPIError('tool message content must be a string', {
      status: 400,
    }),
    expectedReason: 'multimodal_tool_content_unsupported',
    expectedAction: 'downgrade_multimodal_tool_content',
  },
  {
    name: 'OpenAI-compatible local: llama.cpp grammar strips schema keywords',
    protocol: 'openai-chat',
    error: new LLMAPIError('error parsing grammar: json-schema-to-grammar', {
      status: 400,
    }),
    expectedReason: 'llama_cpp_grammar_pattern',
    expectedAction: 'strip_json_schema_keywords',
  },
  {
    name: 'Anthropic: long-context tier delegates to tier lowering',
    protocol: 'anthropic',
    error: new LLMAPIError(
      'Rate limited: extra usage tier required for long context requests',
      { status: 429 },
    ),
    expectedReason: 'long_context_tier',
    expectedAction: 'lower_context_tier',
  },
  {
    name: 'Anthropic: OAuth long-context beta can be disabled once',
    protocol: 'anthropic',
    error: new LLMAPIError(
      'The long context beta is not yet available for this subscription.',
      { status: 400 },
    ),
    expectedReason: 'oauth_long_context_beta_forbidden',
    expectedAction: 'disable_long_context_beta',
  },
  {
    name: 'Anthropic: image size delegates to image shrink path',
    protocol: 'anthropic',
    error: new LLMAPIError('image exceeds 5 MB maximum', { status: 400 }),
    expectedReason: 'image_too_large',
    expectedAction: 'shrink_image_payload',
  },
  {
    name: 'OpenRouter: policy block fails fast without fallback',
    protocol: 'openai-chat',
    error: new LLMAPIError(
      'No endpoints available matching your guardrail restrictions and data policy.',
      { status: 400 },
    ),
    expectedReason: 'provider_policy_blocked',
    expectedAction: 'fail_fast',
  },
  {
    name: 'Transport: SSL alert remains timeout even on large session',
    protocol: 'anthropic',
    error: new Error('SSL alert bad record mac'),
    expectedReason: 'timeout',
    expectedAction: 'retry_backoff',
    context: { approxTokens: 160_000, contextLength: 200_000 },
  },
]

describe('API recovery contracts', () => {
  it.each(cases)('$name', contract => {
    const classified = classifyError(contract.error, {
      provider: contract.protocol,
      model: 'provider-main-model',
      ...contract.context,
    })

    expect(classified.reason).toBe(contract.expectedReason)
    expect(resolveRecoveryAction(classified)).toBe(contract.expectedAction)
  })
})
