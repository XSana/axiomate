// ESM preload: provides global `require` for Node.js.
// claude-code uses require() extensively for lazy loading. In Bun, require()
// works in ESM natively. In Node.js, we inject it as a global.
//
// Usage: node --import ./dist/runtime/register.js dist/main.js

import { createRequire } from 'module'

// @ts-ignore — globalThis.require
if (typeof globalThis.require === 'undefined') {
  // Use the preload script's own URL as the base for require resolution.
  // This works because node_modules is resolved upward from any file.
  globalThis.require = createRequire(import.meta.url)
}
