export type UrlHandlerConfig = {
  /** URL scheme prefix to match. Default: 'axiomate' (matches 'axiomate://...'). */
  scheme?: string
}

/** Configure the URL scheme prefix. */
export function configure(config: UrlHandlerConfig): void

/**
 * Wait for a macOS URL event (Apple Event kAEGetURL).
 * Returns the URL string if received within timeout and matches the configured scheme.
 * Returns null on timeout, scheme mismatch, or non-macOS platforms.
 */
export function waitForUrlEvent(timeoutMs: number): string | null
