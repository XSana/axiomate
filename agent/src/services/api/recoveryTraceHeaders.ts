export function safeRecoveryTraceHeaders(
  headers: Headers | Record<string, string> | { get(name: string): string | null } | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined
  }

  const names = [
    'retry-after',
    'x-request-id',
    'request-id',
    'x-ratelimit-limit-requests',
    'x-ratelimit-remaining-requests',
    'x-ratelimit-reset-requests',
    'x-ratelimit-limit-tokens',
    'x-ratelimit-remaining-tokens',
    'x-ratelimit-reset-tokens',
    'anthropic-ratelimit-requests-limit',
    'anthropic-ratelimit-requests-remaining',
    'anthropic-ratelimit-requests-reset',
    'anthropic-ratelimit-tokens-limit',
    'anthropic-ratelimit-tokens-remaining',
    'anthropic-ratelimit-tokens-reset',
  ]
  const safe: Record<string, string> = {}
  for (const name of names) {
    const value = readHeader(headers, name)
    if (value !== undefined && value !== '') {
      safe[name] = value.slice(0, 160)
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined
}

function readHeader(
  headers: Headers | Record<string, string> | { get(name: string): string | null },
  name: string,
): string | undefined {
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get(name: string): string | null }).get(name) ??
      undefined
  }

  const record = headers as Record<string, string>
  return record[name] ?? record[name.toLowerCase()]
}
