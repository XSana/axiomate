import path from 'path'
import { defineConfig } from 'vitest/config'

import { relativeRequireJsToTs } from './vitest.plugins.js'

/**
 * E2E test config — includes only `src/__tests__/e2e/`.
 * Used by `pnpm run test:e2e`. These tests spawn the compiled CLI, so
 * `dist/cli.js` must exist before running them.
 *
 * See vitest.integration.config.ts for why this isn't merged with the default.
 */
export default defineConfig({
  plugins: [relativeRequireJsToTs],
  resolve: {
    alias: {
      'bun:bundle': path.resolve(__dirname, 'src/__mocks__/bun-bundle.ts'),
    },
  },
  test: {
    include: ['src/__tests__/e2e/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
