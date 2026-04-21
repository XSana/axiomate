import path from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Run-everything config — unit + integration + e2e.
 * Used by `bun test:all` and `bun test:coverage:all`.
 */
export default defineConfig({
  resolve: {
    alias: {
      'bun:bundle': path.resolve(__dirname, 'src/__mocks__/bun-bundle.ts'),
    },
  },
  test: {
    // Default vitest include matches all *.test.ts anywhere
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        '**/__tests__/**',
        '**/__mocks__/**',
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'vitest.config.ts',
        'vitest.*.config.ts',
        'build.ts',
        'package-*.ts',
        'dist/**',
        'node_modules/**',
      ],
    },
  },
})
