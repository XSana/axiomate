// Stub: promptCacheBreakDetection removed (first-party only feature)
import type { AgentId } from '../../types/ids.js'

export const CACHE_TTL_1HOUR_MS = 60 * 60 * 1000

export type PromptStateSnapshot = Record<string, unknown>

export function recordPromptState(_snapshot: PromptStateSnapshot): void {}

export async function checkResponseForCacheBreak(
  _querySource: string,
  _cacheReadTokens: number,
  _cacheCreationTokens: number,
  _messages: unknown[],
  _agentId?: AgentId,
  _requestId?: string | null,
): Promise<void> {}

export function notifyCacheDeletion(_querySource: string): void {}

export function notifyCompaction(
  _querySource: string,
  _agentId?: AgentId,
): void {}

export function cleanupAgentTracking(_agentId: AgentId): void {}

export function resetPromptCacheBreakDetection(): void {}
