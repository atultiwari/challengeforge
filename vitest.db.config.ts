import { defineConfig } from 'vitest/config'

/** Integration tests against a real database. Run via `pnpm test:db` (both engines). */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.int.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
