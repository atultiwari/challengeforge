import { expect, test } from '@playwright/test'
import { E2E_ADMIN } from './config'
import { signIn, signUp } from './helpers'

const PASSWORD = 'e2e-password-12345'

test('an admin makes two authors; one creates a case and adds the other as co-author', async ({ page }) => {
  const stamp = Date.now()
  const lead = { name: 'Lead Author', email: `lead-${stamp}@example.test` }
  const coauthor = { name: 'Co Author', email: `co-${stamp}@example.test` }
  await signUp(page, lead.name, lead.email, PASSWORD)
  await signUp(page, coauthor.name, coauthor.email, PASSWORD)

  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.goto('/admin')
  await page.waitForLoadState('networkidle')
  for (const person of [lead, coauthor]) {
    const row = page.getByRole('listitem').filter({ hasText: person.email })
    const saved = page.waitForResponse((r) => r.url().includes('/api/admin/members/') && r.request().method() === 'POST')
    await row.getByLabel('Role').selectOption('author')
    expect((await saved).ok()).toBe(true)
  }
  await page.goto('/admin/audit')
  await expect(page.getByText('Changed a role').first()).toBeVisible()

  await signIn(page, lead.email, PASSWORD)
  await page.goto('/author/new?type=diagnostic-sim')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page).toHaveURL(/\/author\/[0-9a-f-]{36}\?saved=1/)
  const challengeUrl = new URL(page.url()).pathname
  await page.getByText(/Co-authors \(0\)/).click()
  await page.getByLabel('Add a co-author by email').fill(coauthor.email)
  const added = page.waitForResponse((r) => r.url().endsWith('/collaborators') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Add co-author' }).click()
  expect((await added).ok()).toBe(true)
  await expect(page.getByText(coauthor.email)).toBeVisible()

  await signIn(page, coauthor.email, PASSWORD)
  await page.goto('/author')
  await page.locator(`a[href="${challengeUrl}"]`).click()
  await expect(page.getByRole('heading', { name: 'New diagnostic case' })).toBeVisible()
  // A co-author sees the list but does not manage it, and cannot publish.
  const panel = page.locator('details').filter({ hasText: /Co-authors \(1\)/ })
  await panel.getByText(/Co-authors \(1\)/).click()
  await expect(panel.getByText(coauthor.email)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Remove' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Publish/ })).toHaveCount(0)
})
