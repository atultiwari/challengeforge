import { defineConfig, devices } from '@playwright/test'
import { BASE_URL, E2E_ENV, PORT } from './e2e/config'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env['CI'] ? 1 : 0,
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: BASE_URL,
    env: E2E_ENV,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
