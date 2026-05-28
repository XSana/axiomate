import { describe, expect, it, vi } from 'vitest'

import { sideQuery } from '../../../../services/api/capabilities/sideQuery.js'
import { countTokensForMessages } from '../../../../services/api/capabilities/tokenCounter.js'
import type { LLMProvider } from '../../../../services/api/provider.js'
import type { RecoveryTraceEvent } from '../../../../services/api/recoveryTrace.js'

describe('auxiliary API recovery trace plumbing', () => {
  it('passes recovery trace sinks through neutral sideQuery', async () => {
    const onRecoveryTrace = vi.fn()
    const provider = {
      name: 'openai-chat',
      inference: vi.fn().mockResolvedValue({
        id: 'resp_1',
        content: [{ type: 'text', text: 'ok' }],
        model: 'gpt-4o',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    } as unknown as LLMProvider

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
      }),
    )
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
