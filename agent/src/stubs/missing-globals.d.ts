// Stub declarations for names that are referenced in agent code but whose
// definitions were removed during the extraction.
// These are compile-time stubs only (return inert values / any).

// ---- Constants ----
declare const HOOK_TIMING_DISPLAY_THRESHOLD_MS: number

// ---- Node.js ErrnoException (available in @types/node but sometimes missed) ----
interface ErrnoException extends Error {
  errno?: number | undefined
  code?: string | undefined
  path?: string | undefined
  syscall?: string | undefined
}
