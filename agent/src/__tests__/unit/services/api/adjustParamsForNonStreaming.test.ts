import { describe, expect, it } from 'vitest'

import { adjustParamsForNonStreaming } from '../../../../services/api/llm.js'

// Regression for the parity plan's "调研中发现的、原 plan 没列的"
// adjustParamsForNonStreaming concern — confirm the helper preserves all
// body fields (vendor extraBodyParams, service_tier, etc.) and never
// reintroduces fields stripped by dropFields. Pure function test.
describe('adjustParamsForNonStreaming preserves extra body fields', () => {
  it('keeps vendor-injected fields untouched', () => {
    const result = adjustParamsForNonStreaming(
      {
        max_tokens: 4096,
        service_tier: 'priority',
        do_sample: false,
        thinking: { type: 'adaptive' },
      } as { max_tokens: number; thinking?: { type: string; budget_tokens?: number } } & Record<string, unknown>,
      64_000,
    )
    expect(result.max_tokens).toBe(4096)
    expect((result as Record<string, unknown>).service_tier).toBe('priority')
    expect((result as Record<string, unknown>).do_sample).toBe(false)
    expect(result.thinking).toEqual({ type: 'adaptive' })
  })

  it('does NOT reintroduce dropped fields (only enumerable own props copied)', () => {
    // Build params object that omits stop_sequences (simulating a dropFields
    // strip earlier in the pipeline).
    const params = {
      max_tokens: 4096,
      thinking: { type: 'adaptive' as const },
      service_tier: 'priority',
    } as { max_tokens: number; thinking?: { type: string; budget_tokens?: number } } & Record<string, unknown>
    const result = adjustParamsForNonStreaming(params, 64_000) as Record<
      string,
      unknown
    >
    expect('stop_sequences' in result).toBe(false)
  })

  it('caps max_tokens at MAX_NON_STREAMING_TOKENS', () => {
    const result = adjustParamsForNonStreaming(
      {
        max_tokens: 200_000,
        thinking: { type: 'enabled' as const, budget_tokens: 100_000 },
      },
      64_000,
    )
    expect(result.max_tokens).toBe(64_000)
    // budget reduced to fit under capped max_tokens.
    expect(result.thinking).toEqual({ type: 'enabled', budget_tokens: 63_999 })
  })

  it('leaves adaptive thinking shape unchanged (no budget_tokens to clamp)', () => {
    const result = adjustParamsForNonStreaming(
      {
        max_tokens: 200_000,
        thinking: { type: 'adaptive' as const },
      },
      64_000,
    )
    expect(result.max_tokens).toBe(64_000)
    expect(result.thinking).toEqual({ type: 'adaptive' })
  })

  it('caps a vendor-renamed output-token field and never injects max_tokens', () => {
    // A vendor that renamed the cap field to max_completion_tokens emits that
    // key from paramsFromContext (no max_tokens). The helper must cap the
    // renamed field and must NOT inject a spurious max_tokens: NaN.
    const result = adjustParamsForNonStreaming(
      {
        max_completion_tokens: 200_000,
        thinking: { type: 'enabled' as const, budget_tokens: 100_000 },
      } as { thinking?: { type: string; budget_tokens?: number } } & Record<
        string,
        unknown
      >,
      64_000,
      'max_completion_tokens',
    ) as Record<string, unknown>
    expect(result.max_completion_tokens).toBe(64_000)
    expect('max_tokens' in result).toBe(false)
    expect(result.thinking).toEqual({ type: 'enabled', budget_tokens: 63_999 })
  })

  it('returns params untouched when the cap field is absent', () => {
    // Defensive: if neither max_tokens nor the configured field is a number,
    // the helper leaves the body alone rather than writing NaN.
    const params = {
      thinking: { type: 'adaptive' as const },
      service_tier: 'priority',
    } as { thinking?: { type: string; budget_tokens?: number } } & Record<
      string,
      unknown
    >
    const result = adjustParamsForNonStreaming(params, 64_000) as Record<
      string,
      unknown
    >
    expect('max_tokens' in result).toBe(false)
    expect(result.service_tier).toBe('priority')
  })
})
