import { defineConfig } from 'vitest/config'

// Headless config: only run tests that don't import native display modules.
// Used by scripts/run-tests.cjs when no display is detected.
export default defineConfig({
  test: {
    include: [
      'src/__tests__/executor.test.ts',
    ],
  },
})
