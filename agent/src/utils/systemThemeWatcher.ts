import type { SystemTheme } from './systemTheme.js'

/**
 * Watches for terminal theme changes via OSC 11 queries.
 * Returns a cleanup function.
 */
export function watchSystemTheme(
  querier: any,
  onChange: (theme: SystemTheme) => void,
): () => void {
  // Stub: no-op watcher
  return () => {}
}
