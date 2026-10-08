import { expect, test } from '@playwright/test'
import { E2E_ADMIN, PORT } from './config'
import { signIn } from './helpers'

/** The same server answers on a second host; registering that host makes it a separate site. */
const SECOND = `http://127.0.0.1:${PORT}`

test('a network admin creates a second site on its own host; it is separate, and accounts are shared', async ({ page }) => {
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.getByRole('link', { name: 'Network' }).click()
  await expect(page.getByRole('heading', { name: 'Sites on this installation' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const name = `Second Campus ${Date.now()}`
  if (!(await page.getByText(`127.0.0.1:${PORT}`).isVisible())) {
    await page.getByLabel('Name', { exact: true }).fill(name)
    await page.getByLabel('Short name').fill(`second-${Date.now()}`)
    await page.getByLabel('Domain', { exact: true }).fill(`127.0.0.1:${PORT}`)
    await page.getByRole('button', { name: 'Create site' }).click()
    await expect(page.getByRole('heading', { name })).toBeVisible()
  }

  // The second host is its own site: own name, no content, and not signed in (cookies are per domain).
  await page.goto(`${SECOND}/`)
  await expect(page.getByText('No challenges have been published yet.')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByRole('link', { name: /E2E arithmetic quiz/ })).toHaveCount(0)

  // The same account signs in there, and is that site's admin (the creator became its first admin).
  await page.goto(`${SECOND}/sign-in`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(E2E_ADMIN.email)
  await page.getByLabel('Password').fill(E2E_ADMIN.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Learn by doing' })).toBeVisible()
  await page.goto(`${SECOND}/admin`)
  await expect(page.getByRole('heading', { name: 'Site administration' })).toBeVisible()
  // Its people list is its own: the main site's learners are not here.
  await expect(page.getByText('e2e-admin@example.test')).toBeVisible()
  await expect(page.getByText(/^lead-\d+@example\.test$/)).toHaveCount(0)

  // A request from the main site's origin is refused on the second site (same-origin is per site).
  const crossSite = await page.request.post(`${SECOND}/api/account/mail`, { data: { updates: false }, headers: { origin: `http://localhost:${PORT}` } })
  expect(crossSite.status()).toBe(403)
})
