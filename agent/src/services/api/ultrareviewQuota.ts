// Stub — Anthropic ultrareview quota removed.
export type UltrareviewQuota = {
  reviews_remaining: number
  reviews_used: number
  reviews_limit: number
}
export async function fetchUltrareviewQuota(): Promise<UltrareviewQuota | null> { return null }
