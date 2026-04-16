// Compile-time stub declarations for names referenced in agent code
// but not defined in this package (return inert values / any).

// ---- Constants ----
declare const HOOK_TIMING_DISPLAY_THRESHOLD_MS: number

// ---- Node.js ErrnoException (available in @types/node but sometimes missed) ----
interface ErrnoException extends Error {
  errno?: number | undefined
  code?: string | undefined
  path?: string | undefined
  syscall?: string | undefined
}
