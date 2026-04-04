// Node.js polyfill for bun:bundle.
// In Bun, feature() is a compile-time dead code elimination guard.
// Under Node we return false for all flags — gated code paths are skipped.

export function feature(_name: string): boolean {
  return false
}

const content = ''
export default content
