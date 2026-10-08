import { expect, test } from '@playwright/test'
import { E2E_ADMIN } from './config'
import { signIn, signUp } from './helpers'

const PASSWORD = 'e2e-password-12345'

test('an admin restricts and prices a pack; a learner sees it locked, buys it, and can play', async ({ page }) => {
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.goto('/admin/access')
  await page.waitForLoadState('networkidle')
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'E2E premium pack (synthetic)' }) })
  page.once('dialog', (d) => void d.accept())
  await card.getByRole('button', { name: 'Restrict' }).click()
  await expect(card.getByText('restricted', { exact: true })).toBeVisible()
  await card.getByLabel('Price').fill('499')
  await card.getByLabel('Currency').fill('INR')
  await card.getByRole('button', { name: 'Save price' }).click()
  await expect(card.getByText(/₹499\.00 · on sale/)).toBeVisible()

  await signUp(page, 'Paying Learner', `payer-${Date.now()}@example.test`, PASSWORD)
  const tile = page.getByRole('link', { name: /E2E premium quiz/ })
  await expect(tile).toContainText('Locked')
  await tile.click()
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /Buy access/ }).click()
  await expect(page.getByRole('heading', { name: /Pay for E2E premium pack/ })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Pay (test)' }).click()
  await expect(page.getByRole('link', { name: 'See payment' })).toBeVisible()
  await page.getByRole('link', { name: 'See payment' }).click()
  await expect(page.getByText('Payment received.')).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('link', { name: /E2E premium quiz/ })).toContainText('Not started')
  await page.getByRole('link', { name: /E2E premium quiz/ }).click()
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible()
})
