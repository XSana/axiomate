// Stub — Anthropic rate limit infrastructure removed.
export type ClaudeAILimits = {
  status: string
  isUsingOverage: boolean
  unifiedRateLimitFallbackAvailable?: boolean
  resetsAt?: number
  rateLimitType?: string
  utilization?: number
  overageStatus?: string
  overageResetsAt?: number
  overageDisabledReason?: OverageDisabledReason
  surpassedThreshold?: number
}
export type OverageDisabledReason =
  | 'not_subscriber'
  | 'not_supported'
  | 'org_disabled'
  | 'out_of_credits'
  | 'overage_not_provisioned'
  | 'org_level_disabled'
  | 'org_level_disabled_until'
  | 'seat_tier_level_disabled'
  | 'member_level_disabled'
  | 'seat_tier_zero_credit_limit'
  | 'group_zero_credit_limit'
  | 'member_zero_credit_limit'
  | 'org_service_level_disabled'
  | 'org_service_zero_credit_limit'
  | 'no_limits_configured'
  | 'unknown'
export const currentLimits = { status: 'allowed' as const, isUsingOverage: false }
export const statusListeners = new Set<(limits?: ClaudeAILimits) => void>()
export function extractQuotaStatusFromHeaders(_headers: unknown): void {}
export function extractQuotaStatusFromError(_error: unknown): void {}
export async function checkQuotaStatus(): Promise<void> {}
export type RawUtilization = {
  five_hour?: { utilization: number; resets_at: number }
  seven_day?: { utilization: number; resets_at: number }
}
export function getRawUtilization(): RawUtilization | undefined { return undefined }
export function getRateLimitErrorMessage(_limits?: ClaudeAILimits, _model?: string): null { return null }
export function getUsingOverageText(_limits?: ClaudeAILimits): null { return null }
