/**
 * Safe header access utilities.
 *
 * The Anthropic SDK's `createResponseHeaders()` returns a Proxy object
 * that supports bracket access (`headers['key']`) but does NOT have a
 * `.get()` method. Standard `Headers` objects have `.get()`. This module
 * provides a unified accessor that works with both shapes.
 */

/**
 * Safely read a header value from any headers shape:
 * - Standard `Headers` (has `.get()`)
 * - Anthropic SDK Proxy (bracket access only, no `.get()`)
 * - Plain `Record<string, string>`
 *
 * Returns `null` if the header is not found or headers is nullish.
 */
export function getHeader(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null

  // Standard Headers or any object with a .get() method
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get(name: string): string | null }).get(name)
  }

  // Proxy / plain object — bracket access (case-insensitive fallback)
  const record = headers as Record<string, string | undefined>
  return record[name] ?? record[name.toLowerCase()] ?? null
}
