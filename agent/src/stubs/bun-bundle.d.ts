// Stub for bun:bundle — not available outside Bun's bundler.
// All bun:bundle imports resolve to empty strings at runtime.
declare module 'bun:bundle' {
  const content: string
  export default content
}
