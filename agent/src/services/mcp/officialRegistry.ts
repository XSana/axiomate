// axiomate uses user-configured MCP servers only.

export async function prefetchOfficialMcpUrls(): Promise<void> {}

export function isOfficialMcpUrl(_normalizedUrl: string): boolean {
  return false
}

export function resetOfficialMcpUrlsForTesting(): void {}
