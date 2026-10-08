import { expect, test } from '@playwright/test'
import { E2E_ADMIN } from './config'
import { signIn } from './helpers'

test('an admin renames the site, picks a theme, adds a footer, and closes sign-ups', async ({ page }) => {
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')

  // A pale accent is refused for contrast; a strong one is accepted.
  await page.getByLabel('Theme').selectOption('night')
  await page.getByLabel('Custom accent colour (optional)').fill('#123456')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'too hard to read' })).toBeVisible()
  // A refused save keeps what was typed.
  await expect(page.getByLabel('Theme')).toHaveValue('night')

  await page.getByLabel('Site name').fill('Pathology Practice')
  await page.getByLabel('Footer text').fill('Run by the E2E department.')
  await page.getByLabel('Custom accent colour (optional)').fill('')
  await page.getByLabel('Anyone can create an account').selectOption('no')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('link', { name: 'Pathology Practice' })).toBeVisible()
  await expect(page.getByText('Run by the E2E department.')).toBeVisible()
  await page.reload()
  const paper = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-paper').trim())
  expect(paper).toBe('#12161c')

  // Signed out: no "Create account", and the API refuses sign-ups too.
  await page.context().clearCookies()
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Create account' })).toHaveCount(0)
  const refused = await page.request.post('/api/auth/sign-up/email', {
    data: { email: `closed-${Date.now()}@example.test`, password: 'e2e-password-12345', name: 'Nope' },
    headers: { origin: new URL(page.url()).origin },
  })
  expect(refused.status()).toBe(403)

  // Put things back for the other specs.
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Site name').fill('ChallengeForge E2E')
  await page.getByLabel('Footer text').fill('')
  await page.getByLabel('Theme').selectOption('case-file')
  await page.getByLabel('Anyone can create an account').selectOption('yes')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('link', { name: 'ChallengeForge E2E' })).toBeVisible()
})
