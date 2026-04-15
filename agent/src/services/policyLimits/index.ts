// Policy limits — Anthropic first-party service removed. All stubs.
import type { PolicyLimitsResponse } from './types.js'
export { type PolicyLimitsFetchResult, type PolicyLimitsResponse, PolicyLimitsResponseSchema } from './types.js'

export function _resetPolicyLimitsForTesting(): void {}
export function initializePolicyLimitsLoadingPromise(): void {}
export function isPolicyLimitsEligible(): boolean { return false }
export async function waitForPolicyLimitsToLoad(): Promise<void> {}
export function isPolicyAllowed(_policy: string): boolean { return true }
export async function loadPolicyLimits(): Promise<void> {}
export async function refreshPolicyLimits(): Promise<void> {}
export async function clearPolicyLimitsCache(): Promise<void> {}
export function startBackgroundPolling(): void {}
export function stopBackgroundPolling(): void {}
export function getPolicyLimitsRestrictions(): PolicyLimitsResponse['restrictions'] | null { return null }
