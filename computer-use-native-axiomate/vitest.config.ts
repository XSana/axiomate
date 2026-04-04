import { defineConfig } from 'vitest/config'

// Test file filtering is done by scripts/run-tests.cjs which probes
// for display availability before launching vitest.
export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
  },
})
