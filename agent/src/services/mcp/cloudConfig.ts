// Stub — axiomate doesn't sync MCP configs from claude.ai.
import type { ScopedMcpServerConfig } from './types.js'

export async function fetchClaudeAIMcpConfigsIfEligible(): Promise<
  Record<string, ScopedMcpServerConfig>
> {
  return {}
}

export function clearClaudeAIMcpConfigsCache(): void {
  // no-op
}
