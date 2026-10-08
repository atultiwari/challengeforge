import { expect, test } from '@playwright/test'
import { E2E_ADMIN } from './config'
import { signIn, signUp } from './helpers'

const PASSWORD = 'e2e-password-12345'

test('finishing a pack earns a certificate anyone can verify, until an admin revokes it', async ({ page }) => {
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.goto('/admin/access')
  await page.waitForLoadState('networkidle')
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'E2E pack (synthetic)', exact: true }) })
  const toggle = card.getByRole('button', { name: /Certificates: off/ })
  if (await toggle.isVisible()) {
    await toggle.click()
    await expect(card.getByRole('button', { name: /Certificates: on/ })).toBeVisible()
  }

  const name = `Certified Learner ${Date.now()}`
  await signUp(page, name, `cert-${Date.now()}@example.test`, PASSWORD)
  await page.getByRole('link', { name: /E2E arithmetic quiz/ }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByLabel('Four').check()
  await page.getByLabel('Six times seven?').fill('42')
  await page.getByRole('button', { name: 'Submit answers' }).click()
  await expect(page.getByRole('heading', { name: 'Passed' })).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your certificates' })).toHaveCount(0)
  await page.getByRole('link', { name: /E2E scenario mission/ }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByLabel('Allergies').check()
  await page.getByRole('button', { name: /Submit/ }).click()
  await expect(page.getByText('Always ask about allergies.')).toBeVisible()

  await page.goto('/')
  await page.getByRole('link', { name: 'E2E pack (synthetic)' }).click()
  await expect(page.getByRole('heading', { name: 'Certificate of completion' })).toBeVisible()
  await expect(page.getByRole('article').getByText(name)).toBeVisible()
  const certUrl = new URL(page.url()).pathname

  // Anyone with the link can check it, signed in or not.
  await page.context().clearCookies()
  await page.goto(certUrl)
  await expect(page.getByText(/Valid\./)).toBeVisible()

  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.goto('/admin/certificates')
  await page.waitForLoadState('networkidle')
  const row = page.getByRole('listitem').filter({ hasText: name })
  await row.getByText('Revoke…').click()
  await row.getByLabel('Reason (shown publicly)').fill('Issued for a test.')
  await row.getByRole('button', { name: 'Revoke certificate' }).click()
  await expect(row.getByText('revoked')).toBeVisible()
  await page.context().clearCookies()
  await page.goto(certUrl)
  await expect(page.getByRole('alert').filter({ hasText: 'Revoked' })).toContainText('Issued for a test.')
})
