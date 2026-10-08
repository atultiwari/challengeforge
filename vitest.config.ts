import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'packs/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/**', 'packages/types/src/**'],
      exclude: ['**/index.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
