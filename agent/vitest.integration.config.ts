import path from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Integration test config — includes only `src/__tests__/integration/`.
 * Used by `bun test:integration`.
 *
 * NOTE: we deliberately do NOT mergeConfig with the default vitest.config —
 * mergeConfig concatenates `exclude` arrays, which would re-exclude the
 * integration folder defined in the default. Instead we declare the full
 * config inline, only inheriting the 'bun:bundle' alias.
 */
export default defineConfig({
  resolve: {
    alias: {
      'bun:bundle': path.resolve(__dirname, 'src/__mocks__/bun-bundle.ts'),
    },
  },
  test: {
    include: ['src/__tests__/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
