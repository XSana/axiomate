/**
 * Provider-neutral rate limit tracking.
 *
 * Parses rate limit headers from any provider (OpenAI-compatible or
 * Anthropic-compatible) and stores the latest state for UI display.
 */
import { getHeader } from './headerUtils.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RateLimitInfo = {
  requestsLimit?: number
  requestsRemaining?: number
  requestsResetMs?: number
  tokensLimit?: number
  tokensRemaining?: number
  tokensResetMs?: number
  retryAfterMs?: number
  provider: string
  capturedAt: number
}

// ---------------------------------------------------------------------------
// State (module-level singleton)
// ---------------------------------------------------------------------------

let current: RateLimitInfo | null = null

type Listener = (info: RateLimitInfo) => void
const listeners = new Set<Listener>()

export function updateRateLimitInfo(info: RateLimitInfo): void {
  current = info
  for (const l of listeners) {
    try {
      l(info)
    } catch {
      // listener throws shouldn't break the producer; swallow
    }
  }
}

export function getRateLimitInfo(): RateLimitInfo | null {
  return current
}

/**
 * Subscribe to rate limit updates. Returns an unsubscribe function.
 * Listeners are invoked synchronously after `updateRateLimitInfo`.
 */
export function subscribeToRateLimitUpdates(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

/**
 * Parse rate limit headers from any provider's response.
 * Returns null if no rate limit headers are found.
 *
 * Supports:
 * - OpenAI: x-ratelimit-limit-requests, x-ratelimit-remaining-requests, etc.
 * - Anthropic: anthropic-ratelimit-requests-limit, anthropic-ratelimit-requests-remaining, etc.
 * - Standard: retry-after
 */
export function parseRateLimitHeaders(
  headers: unknown,
  provider: string,
): RateLimitInfo | null {
  if (!headers || typeof headers !== 'object') return null

  // Try OpenAI-style headers first (most common for axiomate)
  const openai = parseOpenAIRateLimitHeaders(headers)
  // Then Anthropic-style
  const anthropic = parseAnthropicRateLimitHeaders(headers)
  // Standard retry-after
  const retryAfterMs = parseRetryAfterHeader(headers)

  // Merge: prefer whichever has data
  const merged: RateLimitInfo = {
    ...(openai ?? {}),
    ...(anthropic ?? {}),
    provider,
    capturedAt: Date.now(),
  }
  if (retryAfterMs != null) {
    merged.retryAfterMs = retryAfterMs
  }

  // Only return if we got at least one useful field
  if (
    merged.requestsLimit != null ||
    merged.requestsRemaining != null ||
    merged.tokensLimit != null ||
    merged.tokensRemaining != null ||
    merged.retryAfterMs != null
  ) {
    return merged
  }

  return null
}

// ---------------------------------------------------------------------------
// OpenAI-style headers
// ---------------------------------------------------------------------------

function parseOpenAIRateLimitHeaders(headers: unknown): Partial<RateLimitInfo> | null {
  const requestsLimit = parseNumHeader(headers, 'x-ratelimit-limit-requests')
  const requestsRemaining = parseNumHeader(headers, 'x-ratelimit-remaining-requests')
  const requestsResetMs = parseResetHeader(headers, 'x-ratelimit-reset-requests')
  const tokensLimit = parseNumHeader(headers, 'x-ratelimit-limit-tokens')
  const tokensRemaining = parseNumHeader(headers, 'x-ratelimit-remaining-tokens')
  const tokensResetMs = parseResetHeader(headers, 'x-ratelimit-reset-tokens')

  if (
    requestsLimit == null &&
    requestsRemaining == null &&
    tokensLimit == null &&
    tokensRemaining == null
  ) {
    return null
  }

  return {
    ...(requestsLimit != null && { requestsLimit }),
    ...(requestsRemaining != null && { requestsRemaining }),
    ...(requestsResetMs != null && { requestsResetMs }),
    ...(tokensLimit != null && { tokensLimit }),
    ...(tokensRemaining != null && { tokensRemaining }),
    ...(tokensResetMs != null && { tokensResetMs }),
  }
}

// ---------------------------------------------------------------------------
// Anthropic-style headers
// ---------------------------------------------------------------------------

function parseAnthropicRateLimitHeaders(headers: unknown): Partial<RateLimitInfo> | null {
  const requestsLimit = parseNumHeader(headers, 'anthropic-ratelimit-requests-limit')
  const requestsRemaining = parseNumHeader(headers, 'anthropic-ratelimit-requests-remaining')
  const requestsResetMs = parseResetHeader(headers, 'anthropic-ratelimit-requests-reset')
  const tokensLimit = parseNumHeader(headers, 'anthropic-ratelimit-tokens-limit')
  const tokensRemaining = parseNumHeader(headers, 'anthropic-ratelimit-tokens-remaining')
  const tokensResetMs = parseResetHeader(headers, 'anthropic-ratelimit-tokens-reset')

  if (
    requestsLimit == null &&
    requestsRemaining == null &&
    tokensLimit == null &&
    tokensRemaining == null
  ) {
    return null
  }

  return {
    ...(requestsLimit != null && { requestsLimit }),
    ...(requestsRemaining != null && { requestsRemaining }),
    ...(requestsResetMs != null && { requestsResetMs }),
    ...(tokensLimit != null && { tokensLimit }),
    ...(tokensRemaining != null && { tokensRemaining }),
    ...(tokensResetMs != null && { tokensResetMs }),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseNumHeader(headers: unknown, name: string): number | undefined {
  const value = getHeader(headers, name)
  if (value == null) return undefined
  const num = parseInt(value, 10)
  return Number.isFinite(num) ? num : undefined
}

/**
 * Parse reset headers. Formats vary:
 * - Some: plain seconds number ("60", "12.5")
 * - OpenAI: "6m0s", "1s", "200ms" (duration string)
 * - Anthropic: "2026-04-15T10:00:00Z" (ISO timestamp)
 *
 * Order matters: Date.parse() is permissive enough to interpret bare
 * integers like "60" as a year ("60 AD"), which would make plain-seconds
 * resets silently misparse. Try the strict shapes first, ISO last.
 */
function parseResetHeader(headers: unknown, name: string): number | undefined {
  const value = getHeader(headers, name)
  if (value == null) return undefined

  // Plain seconds (integer or decimal, no other characters)
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const seconds = parseFloat(value)
    if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000
  }

  // Duration string: "6m0s", "1s", "200ms"
  const durationMs = parseDurationString(value)
  if (durationMs != null) return durationMs

  // ISO timestamp (last resort — Date.parse is lenient and may misread
  // shapes that don't look like dates)
  const asDate = Date.parse(value)
  if (!isNaN(asDate)) {
    const ms = asDate - Date.now()
    return ms > 0 ? ms : 0
  }

  return undefined
}

function parseDurationString(value: string): number | undefined {
  let totalMs = 0
  let matched = false

  const hourMatch = value.match(/(\d+)h/)
  if (hourMatch?.[1]) { totalMs += parseInt(hourMatch[1], 10) * 3600_000; matched = true }

  const minMatch = value.match(/(\d+)m(?!s)/)
  if (minMatch?.[1]) { totalMs += parseInt(minMatch[1], 10) * 60_000; matched = true }

  const secMatch = value.match(/(\d+)s/)
  if (secMatch?.[1]) { totalMs += parseInt(secMatch[1], 10) * 1000; matched = true }

  const msMatch = value.match(/(\d+)ms/)
  if (msMatch?.[1]) { totalMs += parseInt(msMatch[1], 10); matched = true }

  return matched ? totalMs : undefined
}

function parseRetryAfterHeader(headers: unknown): number | undefined {
  const value = getHeader(headers, 'retry-after')
  if (value == null) return undefined
  const seconds = parseInt(value, 10)
  return Number.isFinite(seconds) ? seconds * 1000 : undefined
}

// ---------------------------------------------------------------------------
// Convenience: utilization percentage
// ---------------------------------------------------------------------------

export function getRateLimitUtilizationPct(): number | undefined {
  return current ? computeUtilizationPct(current) : undefined
}

/**
 * Compute the highest utilization percentage across requests / tokens
 * dimensions for a given snapshot. Returns undefined when no quota fields
 * are populated.
 */
export function computeUtilizationPct(info: RateLimitInfo): number | undefined {
  let max: number | undefined
  if (info.requestsRemaining != null && info.requestsLimit != null && info.requestsLimit > 0) {
    const pct = Math.round((1 - info.requestsRemaining / info.requestsLimit) * 100)
    if (max == null || pct > max) max = pct
  }
  if (info.tokensRemaining != null && info.tokensLimit != null && info.tokensLimit > 0) {
    const pct = Math.round((1 - info.tokensRemaining / info.tokensLimit) * 100)
    if (max == null || pct > max) max = pct
  }
  return max
}
