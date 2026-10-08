import { expect, test } from '@playwright/test'
import { SETUP_TOKEN } from './config'

test('a fresh install is set up entirely in the browser, and the wizard then disappears', async ({ page }) => {
  // The first visitor is sent to the wizard.
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup$/)
  await expect(page.getByRole('heading', { name: 'Set up your site' })).toBeVisible()
  await page.waitForLoadState('networkidle')

  await page.getByLabel('Setup token').fill('a-wrong-token-that-is-long-enough')
  await page.getByLabel('Site name').fill('Clinical Reasoning Lab')
  await page.getByLabel('Look').selectOption('clinic')
  await page.getByLabel('Your name').fill('Site Owner')
  await page.getByLabel('Your email').fill('owner@example.test')
  await page.getByLabel('Password (at least 10 characters)').fill('owner-password-123')
  await page.getByRole('button', { name: 'Create my site' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'not valid' })).toBeVisible()

  await page.getByLabel('Setup token').fill(SETUP_TOKEN)
  await page.getByRole('button', { name: 'Create my site' }).click()
  await expect(page.getByRole('heading', { name: 'Site administration' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Clinical Reasoning Lab' })).toBeVisible()
  await page.reload()
  const paper = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-paper').trim())
  expect(paper).toBe('#f5f7fa')

  // Gone for good, for everyone.
  await page.context().clearCookies()
  const again = await page.goto('/setup')
  expect(again?.status()).toBe(404)
  const api = await page.request.post('/api/setup', { data: { token: SETUP_TOKEN }, headers: { origin: new URL(page.url()).origin } })
  expect(api.status()).toBe(404)
})
