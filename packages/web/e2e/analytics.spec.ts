import { expect, test } from '@playwright/test'
import { E2E_ADMIN } from './config'
import { signIn } from './helpers'

test('editors see per-pack analytics and can download them as CSV; signed-out requests are refused', async ({ page }) => {
  const anonymous = await page.request.get('/api/analytics/packs/00000000-0000-0000-0000-000000000000/csv')
  expect(anonymous.status()).toBe(401)

  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.goto('/admin/analytics')
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'E2E pack (synthetic)', exact: true }) })
  await expect(section.getByRole('rowheader', { name: 'E2E arithmetic quiz' })).toBeVisible()
  const href = await section.getByRole('link', { name: 'Download CSV' }).getAttribute('href')
  const csv = await page.request.get(href!)
  expect(csv.headers()['content-type']).toContain('text/csv')
  expect(csv.headers()['content-disposition']).toMatch(/attachment; filename="pack-analytics-[a-z0-9-]+\.csv"/)
  const text = await csv.text()
  expect(text.split('\r\n')[0]).toContain('Challenge,Learners,Attempts')
  expect(text).toContain('E2E arithmetic quiz')
})
