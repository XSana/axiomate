/**
 * Facade for rate limit header processing
 * Mock rate limits have been removed (were ant-only testing infrastructure).
 * All functions now pass through or return no-op values.
 */

import { APIError } from '@anthropic-ai/sdk'

/**
 * Process headers — no mocks, pass through directly.
 */
export function processRateLimitHeaders(
  headers: unknown,
): unknown {
  return headers
}

/**
 * Check if we should process rate limits (real subscriber only).
 */
export function shouldProcessRateLimits(isSubscriber: boolean): boolean {
  return isSubscriber
}

/**
 * Check if mock rate limits should throw a 429 error.
 * Always returns null (mocks removed).
 */
export function checkMockRateLimitError(
  _currentModel: string,
): APIError | null {
  return null
}

/**
 * Check if this is a mock 429 error that shouldn't be retried.
 * Always returns false (mocks removed).
 */
export function isMockRateLimitError(_error: APIError): boolean {
  return false
}

/**
 * Check if /mock-limits command is currently active (for UI purposes).
 * Always returns false (mocks removed).
 */
export function shouldProcessMockLimits(): boolean {
  return false
}
