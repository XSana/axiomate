import type { SystemTheme } from './systemTheme.js'

/**
 * Watches for terminal theme changes via OSC 11 queries.
 * Currently a no-op — live theme switching is not wired up; consumers fall
 * back to the initial theme query result. Returns a cleanup function.
 */
export function watchSystemTheme(
  _querier: unknown,
  _onChange: (theme: SystemTheme) => void,
): () => void {
  return () => {}
}
