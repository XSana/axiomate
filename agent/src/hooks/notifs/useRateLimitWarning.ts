import { useEffect, useRef } from 'react'
import { useNotifications } from '../../context/notifications.js'
import {
  type RateLimitInfo,
  subscribeToRateLimitUpdates,
} from '../../services/api/rateLimitTracker.js'

const WARN_THRESHOLD = 80
const CRITICAL_THRESHOLD = 95

type Tier = 'normal' | 'warn' | 'critical'

/**
 * Surface a transient toast when the most-recent provider response indicates
 * the request or token quota is approaching exhaustion. Notifications fire
 * once per tier escalation (normal → warn → critical) to avoid spamming.
 * Going back below the warn threshold resets the latch so future spikes
 * notify again.
 */
export function useRateLimitWarning(): void {
  const { addNotification } = useNotifications()
  const lastTierRef = useRef<Tier>('normal')

  useEffect(() => {
    return subscribeToRateLimitUpdates(info => {
      const breakdown = computeBreakdown(info)
      if (!breakdown) return

      const tier: Tier =
        breakdown.pct >= CRITICAL_THRESHOLD
          ? 'critical'
          : breakdown.pct >= WARN_THRESHOLD
            ? 'warn'
            : 'normal'

      const previousTier = lastTierRef.current
      lastTierRef.current = tier

      // Don't fire on normal or on staying at the same elevated tier.
      // Crossing from warn → critical re-fires; critical → warn doesn't.
      if (tier === 'normal') return
      if (tier === previousTier) return
      if (tier === 'warn' && previousTier === 'critical') return

      const resetText = breakdown.resetMs != null
        ? `, resets in ${formatDuration(breakdown.resetMs)}`
        : ''

      addNotification({
        key: 'rate-limit-warning',
        priority: tier === 'critical' ? 'high' : 'medium',
        timeoutMs: tier === 'critical' ? 12_000 : 8_000,
        text: `${tier === 'critical' ? '⚠⚠' : '⚠'} ${info.provider} ${breakdown.dim} quota ${breakdown.pct}%${resetText}`,
        color: tier === 'critical' ? 'error' : 'warning',
        fold: (_prev, incoming) => incoming,
      })
    })
  }, [addNotification])
}

type Breakdown = {
  pct: number
  dim: 'requests' | 'tokens'
  resetMs?: number
}

function computeBreakdown(info: RateLimitInfo): Breakdown | null {
  const requestsPct =
    info.requestsRemaining != null &&
    info.requestsLimit != null &&
    info.requestsLimit > 0
      ? Math.round((1 - info.requestsRemaining / info.requestsLimit) * 100)
      : undefined
  const tokensPct =
    info.tokensRemaining != null &&
    info.tokensLimit != null &&
    info.tokensLimit > 0
      ? Math.round((1 - info.tokensRemaining / info.tokensLimit) * 100)
      : undefined

  if (requestsPct == null && tokensPct == null) return null

  // Pick the more saturated dimension.
  if (
    tokensPct != null &&
    (requestsPct == null || tokensPct >= requestsPct)
  ) {
    return { pct: tokensPct, dim: 'tokens', resetMs: info.tokensResetMs }
  }
  return { pct: requestsPct!, dim: 'requests', resetMs: info.requestsResetMs }
}

function formatDuration(ms: number): string {
  if (ms <= 0) return 'now'
  if (ms < 1000) return '<1s'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.round(m / 60)}h`
}
