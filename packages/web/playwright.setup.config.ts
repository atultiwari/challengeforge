import { defineConfig, devices } from '@playwright/test'
import { SETUP_ENV, SETUP_PORT, SETUP_URL } from './e2e-setup/config'

/** The first-run wizard on a fresh, empty install (separate from the main E2E site). */
export default defineConfig({
  testDir: './e2e-setup',
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  expect: { timeout: 15_000 },
  use: { baseURL: SETUP_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next dev --port ${SETUP_PORT}`,
    url: SETUP_URL,
    env: SETUP_ENV,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
