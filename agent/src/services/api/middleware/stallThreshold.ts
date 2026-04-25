/**
 * Compute an adaptive stall-warning threshold for the streaming middleware.
 *
 * Priority chain:
 *   1. Per-model `stallTimeoutMs` config wins (handles DNS-rewrite / private
 *      DNS / Tailscale cases the hostname heuristic can't see).
 *   2. Hostname heuristic — if the URL looks unambiguously like loopback /
 *      Docker bridge, disable stall warnings (Infinity).
 *   3. Adaptive: max(absolute-token bucket, context-ratio bucket). Wider
 *      buckets are more conservative; this layer is purely observational
 *      (we never kill the connection) so erring long only reduces log noise.
 */
import { getGlobalConfig } from '../../../utils/config.js'
import { getContextWindowForModel } from '../../../utils/context.js'

export interface ComputeStallThresholdInput {
  /** Provider base URL (e.g. https://api.openai.com/v1). Optional — omit to skip the local-hostname heuristic. */
  baseUrl?: string
  /** Model name (looked up against ~/.axiomate.json for stallTimeoutMs override + contextWindow). */
  model: string
  /** Rough estimate of how many tokens the request payload contains. See estimateInputTokens. */
  estimatedInputTokens: number
}

const DEFAULT_THRESHOLD_MS = 30_000

export function computeStallThreshold(input: ComputeStallThresholdInput): number {
  // 1) Explicit per-model override wins. 0 means "disable" (caller can't see
  // local DNS / VPN trickery; let the user say "this one is local").
  const cfg = getGlobalConfig().models?.[input.model]
  if (cfg?.stallTimeoutMs != null) {
    return cfg.stallTimeoutMs === 0
      ? Number.POSITIVE_INFINITY
      : cfg.stallTimeoutMs
  }

  // 2) Hostname heuristic for the unambiguous local cases.
  if (input.baseUrl && isObviouslyLocalHostname(input.baseUrl)) {
    return Number.POSITIVE_INFINITY
  }

  // 3) Adaptive threshold = max(absolute, ratio). Both passes start from
  // the default and can only widen it.
  const ctxWindow = getContextWindowForModel(input.model)
  const ratio =
    ctxWindow > 0 ? input.estimatedInputTokens / ctxWindow : 0

  let t = DEFAULT_THRESHOLD_MS
  // Absolute (token count) — protects large-context models with big inputs
  // (e.g. 1M Gemini sending 100k tokens — ratio is small but prefill is real).
  if (input.estimatedInputTokens > 100_000) {
    t = Math.max(t, 600_000) // 10 min
  } else if (input.estimatedInputTokens > 50_000) {
    t = Math.max(t, 300_000) // 5 min
  } else if (input.estimatedInputTokens > 20_000) {
    t = Math.max(t, 120_000) // 2 min
  }
  // Ratio (relative to declared window) — protects small-context models that
  // are running near full (e.g. a 32k model packed to 28k tokens).
  if (ratio > 0.8) {
    t = Math.max(t, 300_000)
  } else if (ratio > 0.5) {
    t = Math.max(t, 180_000)
  }
  return t
}

/**
 * Returns true only for hostnames that unambiguously point at the local
 * machine. We deliberately exclude:
 *   - `*.local` (could be Bonjour/mDNS but also corp internal cloud).
 *   - RFC1918 ranges (10.x, 172.16-31.x, 192.168.x) — common for VPN /
 *     Kubernetes / corp cloud and not always actually-local.
 *
 * Edge cases the user knows about (DNS rewrites, tailscale mesh, etc.)
 * are expected to use per-model `stallTimeoutMs` config to disable warnings.
 */
export function isObviouslyLocalHostname(baseUrl: string): boolean {
  let hostname: string
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  if (!hostname) return false
  // URL parses IPv6 hostnames as `[::1]` strip brackets.
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1)
  }
  if (hostname === 'localhost') return true
  if (hostname === '0.0.0.0') return true
  // IPv4 loopback: the entire 127.0.0.0/8 block is loopback.
  if (hostname === '127.0.0.1' || hostname.startsWith('127.')) return true
  // IPv6 loopback / unspecified.
  if (hostname === '::1') return true
  if (hostname === '::') return true
  // Docker Desktop's bridge; this name has only one meaning.
  if (hostname === 'host.docker.internal') return true
  return false
}

/**
 * Cheap input-size estimator. Rough rule of thumb: 4 chars per token.
 * Off by ±20% in either direction, which doesn't matter — buckets are
 * 30s / 120s / 300s / 600s, so an estimate that's ~25% wrong still picks
 * the right bucket near the boundaries.
 *
 * Accepts the provider-bound message shape — we only inspect the JSON
 * length of the content payload, so tool calls / images / mixed blocks
 * all count toward the estimate proportionally.
 */
export function estimateInputTokens(
  messages: ReadonlyArray<{ message?: unknown } | { content?: unknown }>,
): number {
  let chars = 0
  for (const m of messages) {
    const inner = (m as { message?: { content?: unknown } }).message?.content
    const content = inner !== undefined ? inner : (m as { content?: unknown }).content
    if (content === undefined) continue
    chars += stringifyLen(content)
  }
  return Math.floor(chars / 4)
}

function stringifyLen(value: unknown): number {
  if (typeof value === 'string') return value.length
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}
