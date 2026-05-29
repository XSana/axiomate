import { describe, expect, it, vi } from 'vitest'

import { sideQuery } from '../../../../services/api/capabilities/sideQuery.js'
import { countTokensForMessages } from '../../../../services/api/capabilities/tokenCounter.js'
import { resolveAuxiliaryRecoveryBudget } from '../../../../services/api/auxiliaryRecovery.js'
import type { LLMProvider } from '../../../../services/api/provider.js'
import type { RecoveryTraceEvent } from '../../../../services/api/recoveryTrace.js'
import { LLMAPIError } from '../../../../services/api/streamTypes.js'

function makeProvider(
  inference: LLMProvider['inference'],
  name: LLMProvider['name'] = 'openai-chat',
): LLMProvider {
  return {
    name,
    inference,
    wrapError(error: unknown): LLMAPIError {
      if (error instanceof LLMAPIError) {
        return error
      }
      return new LLMAPIError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
      )
    },
  } as unknown as LLMProvider
}

describe('auxiliary API recovery trace plumbing', () => {
  it('resolves auxiliary recovery budgets from semantic task context', () => {
    expect(
      resolveAuxiliaryRecoveryBudget({ querySource: 'session_search' }),
    ).toMatchObject({
      maxRecoveryRetries: 0,
      foregroundSource: false,
      reason: 'background-direct',
    })
    expect(
      resolveAuxiliaryRecoveryBudget({ querySource: 'model_validation' }),
    ).toMatchObject({
      maxRecoveryRetries: 1,
      foregroundSource: true,
      reason: 'validation',
    })
    expect(
      resolveAuxiliaryRecoveryBudget({ querySource: 'side_question' }),
    ).toMatchObject({
      maxRecoveryRetries: 2,
      foregroundSource: true,
      reason: 'foreground-side-query',
    })
    expect(
      resolveAuxiliaryRecoveryBudget({
        auxiliaryTask: 'sessionTitle',
        recoveryProfile: 'auxiliary-fast',
      }),
    ).toMatchObject({
      maxRecoveryRetries: 1,
      foregroundSource: true,
      reason: 'task-fast',
    })
    expect(
      resolveAuxiliaryRecoveryBudget({
        auxiliaryTask: 'conversationSummary',
        recoveryProfile: 'auxiliary-quality',
      }),
    ).toMatchObject({
      maxRecoveryRetries: 2,
      foregroundSource: true,
      reason: 'task-quality',
    })
  })

  it('passes recovery trace sinks through neutral sideQuery', async () => {
    const onRecoveryTrace = vi.fn()
    const provider = makeProvider(
      vi.fn().mockResolvedValue({
        id: 'resp_1',
        content: [{ type: 'text', text: 'ok' }],
        model: 'gpt-4o',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    )

    await sideQuery(provider, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      querySource: 'model_validation',
      onRecoveryTrace,
    })

    expect(provider.inference).toHaveBeenCalledWith(
      expect.objectContaining({
        querySource: 'model_validation',
        onRecoveryTrace,
        suppressAuxiliaryRecoveryTrace: true,
      }),
    )
  })

  it('uses the foreground auxiliary recovery budget with semantic traces', async () => {
    const traces: RecoveryTraceEvent[] = []
    const inference = vi.fn()
      .mockRejectedValueOnce(
        new LLMAPIError('side query rate limited', {
          status: 429,
          headers: { 'retry-after': '0', 'x-request-id': 'req_aux_1' },
          request_id: 'req_aux_1',
        }),
      )
      .mockResolvedValueOnce({
        id: 'resp_1',
        content: [{ type: 'text', text: 'ok' }],
        model: 'gpt-4o',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
    const provider = makeProvider(inference)

    const result = await sideQuery(provider, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      querySource: 'side_question',
      onRecoveryTrace: event => traces.push(event),
    })

    expect(result.id).toBe('resp_1')
    expect(inference).toHaveBeenCalledTimes(2)
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      protocol: 'openai-chat',
      operation: 'side_query',
      querySource: 'side_question',
      attempt: 1,
      maxAttempts: 3,
      reason: 'rate_limit',
      intent: 'respect_provider_retry_after',
      action: 'retry_after',
      outcome: 'retrying',
      retryable: true,
      final: false,
      recommendedAction: 'retry_after',
      recommendedIntent: 'respect_provider_retry_after',
      requestId: 'req_aux_1',
      safeHeaders: {
        'retry-after': '0',
        'x-request-id': 'req_aux_1',
      },
    })
  })

  it('does not retry background auxiliary side queries', async () => {
    const traces: RecoveryTraceEvent[] = []
    const inference = vi.fn().mockRejectedValue(
      new LLMAPIError('session search upstream 502', { status: 502 }),
    )
    const provider = makeProvider(inference)

    await expect(
      sideQuery(provider, {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
        querySource: 'session_search',
        onRecoveryTrace: event => traces.push(event),
      }),
    ).rejects.toBeInstanceOf(LLMAPIError)

    expect(inference).toHaveBeenCalledTimes(1)
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      operation: 'side_query',
      querySource: 'session_search',
      attempt: 1,
      maxAttempts: 1,
      reason: 'server_error',
      intent: 'fail_recovery_exhausted',
      action: 'fail_fast',
      outcome: 'failing',
      retryable: true,
      final: true,
      recommendedAction: 'retry_backoff',
      recommendedIntent: 'retry_transient_failure',
    })
  })

  it('classifies auxiliary timeout with timeout policy fields', async () => {
    vi.useFakeTimers()
    try {
      const traces: RecoveryTraceEvent[] = []
      const inference = vi.fn(
        () => new Promise(() => {}),
      ) as unknown as LLMProvider['inference']
      const provider = makeProvider(inference)

      const promise = sideQuery(provider, {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
        querySource: 'generate_session_title',
        onRecoveryTrace: event => traces.push(event),
      })
      const expectation = expect(promise).rejects.toMatchObject({
        name: 'LLMTimeoutError',
        message: 'auxiliary_timeout after 30000ms',
      })

      await vi.advanceTimersByTimeAsync(30_000)
      await expectation

      expect(traces).toHaveLength(1)
      expect(traces[0]).toMatchObject({
        operation: 'side_query',
        querySource: 'generate_session_title',
        reason: 'timeout',
        timeoutKind: 'auxiliary_timeout',
        timeoutMs: 30_000,
        intent: 'fail_recovery_exhausted',
        action: 'fail_fast',
        outcome: 'failing',
        final: true,
        recommendedAction: 'retry_backoff',
        recommendedIntent: 'retry_transient_failure',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies semantic request mutations on the retry attempt', async () => {
    const traces: RecoveryTraceEvent[] = []
    const inference = vi.fn()
      .mockRejectedValueOnce(
        new LLMAPIError(
          "Unsupported parameter: 'temperature' is not supported",
          {
            status: 400,
            error: { param: 'temperature' },
          },
        ),
      )
      .mockResolvedValueOnce({
        id: 'resp_1',
        content: [{ type: 'text', text: 'ok' }],
        model: 'gpt-4o',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
    const provider = makeProvider(inference)

    await sideQuery(provider, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      querySource: 'model_validation',
      onRecoveryTrace: event => traces.push(event),
    })

    expect(inference).toHaveBeenCalledTimes(2)
    expect(inference.mock.calls[0]?.[0]).toMatchObject({
      temperature: 0.2,
    })
    expect(inference.mock.calls[1]?.[0].temperature).toBeUndefined()
    expect(inference.mock.calls[1]?.[0]).toMatchObject({
      providerHints: { omittedRequestFields: ['temperature'] },
    })
    expect(traces[0]).toMatchObject({
      reason: 'unsupported_parameter',
      ruleId: 'omit-unsupported-request-fields',
      mutation: ['omit_request_field:temperature'],
      final: false,
    })
  })

  it('downgrades multimodal tool results on retry', async () => {
    const traces: RecoveryTraceEvent[] = []
    const inference = vi.fn()
      .mockRejectedValueOnce(
        new LLMAPIError('tool message content must be a string', {
          status: 400,
        }),
      )
      .mockResolvedValueOnce({
        id: 'resp_1',
        content: [{ type: 'text', text: 'ok' }],
        model: 'gpt-4o',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
    const provider = makeProvider(inference)

    await sideQuery(provider, {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool_1',
              content: [
                { type: 'text', text: 'partial output' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'abc',
                  },
                },
              ],
            },
          ],
        },
      ],
      querySource: 'side_question',
      onRecoveryTrace: event => traces.push(event),
    })

    expect(inference).toHaveBeenCalledTimes(2)
    expect(inference.mock.calls[1]?.[0].messages[0].content[0]).toMatchObject({
      type: 'tool_result',
      content: 'partial output\n[Image omitted from tool result]',
    })
    expect(traces[0]).toMatchObject({
      reason: 'multimodal_tool_content_unsupported',
      ruleId: 'downgrade-multimodal-tool-result-content',
      mutation: ['downgrade_multimodal_tool_content'],
      final: false,
    })
  })

  it('strips unsupported schema keywords on retry', async () => {
    const traces: RecoveryTraceEvent[] = []
    const inference = vi.fn()
      .mockRejectedValueOnce(
        new LLMAPIError(
          'error parsing grammar: json-schema-to-grammar does not support pattern',
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce({
        id: 'resp_1',
        content: [{ type: 'text', text: 'ok' }],
        model: 'gpt-4o',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
    const provider = makeProvider(inference)

    await sideQuery(provider, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 'Search',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', pattern: '^a', format: 'uri' },
            },
          },
        },
      ],
      querySource: 'model_validation',
      onRecoveryTrace: event => traces.push(event),
    })

    expect(inference).toHaveBeenCalledTimes(2)
    expect(
      inference.mock.calls[1]?.[0].tools[0].inputSchema.properties.query,
    ).toEqual({ type: 'string' })
    expect(traces[0]).toMatchObject({
      reason: 'llama_cpp_grammar_pattern',
      ruleId: 'strip-llama-cpp-schema-keywords',
      mutation: ['strip_json_schema_keywords:pattern,format'],
      final: false,
    })
  })

  it('strips Grok slash enums on retry', async () => {
    const traces: RecoveryTraceEvent[] = []
    const inference = vi.fn()
      .mockRejectedValueOnce(
        new LLMAPIError('Invalid arguments passed to the model', {
          status: 400,
        }),
      )
      .mockResolvedValueOnce({
        id: 'resp_1',
        content: [{ type: 'text', text: 'ok' }],
        model: 'grok-4.3',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
    const provider = makeProvider(inference, 'openai-responses')

    await sideQuery(provider, {
      model: 'grok-4.3',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 'PickModel',
          inputSchema: {
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
      querySource: 'model_validation',
      onRecoveryTrace: event => traces.push(event),
    })

    expect(inference).toHaveBeenCalledTimes(2)
    expect(
      inference.mock.calls[1]?.[0].tools[0].inputSchema.properties.model_id,
    ).not.toHaveProperty('enum')
    expect(
      inference.mock.calls[1]?.[0].providerHints,
    ).toMatchObject({ stripSlashEnums: true })
    expect(traces[0]).toMatchObject({
      reason: 'slash_enum_unsupported',
      ruleId: 'strip-grok-slash-enums',
      mutation: ['strip_slash_enums'],
      final: false,
    })
  })

  it('passes recovery trace sinks through neutral token counting', async () => {
    const onRecoveryTrace = vi.fn((_: RecoveryTraceEvent) => {})
    const provider = {
      countTokens: vi.fn().mockResolvedValue(123),
    } as unknown as LLMProvider

    await countTokensForMessages(
      provider,
      'claude-sonnet-4',
      [{ role: 'user', content: 'hi' }],
      undefined,
      undefined,
      onRecoveryTrace,
    )

    expect(provider.countTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        querySource: 'count_tokens',
        onRecoveryTrace,
      }),
    )
  })
})
