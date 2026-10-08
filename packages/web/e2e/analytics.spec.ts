import { expect, test } from '@playwright/test'
import { E2E_ADMIN } from './config'
import { signIn, signUp } from './helpers'

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

test('admins download learning records as xAPI statements, without email addresses', async ({ page }) => {
  // A learner passes something first, so there is a record to export.
  await signUp(page, 'xAPI Learner', `xapi-${Date.now()}@example.test`, 'e2e-password-12345')
  await page.getByRole('link', { name: /E2E arithmetic quiz/ }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByLabel('Four').check()
  await page.getByLabel('Six times seven?').fill('42')
  await page.getByRole('button', { name: 'Submit answers' }).click()
  await expect(page.getByRole('heading', { name: 'Passed' })).toBeVisible()

  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.goto('/admin/xapi')
  const href = await page.getByRole('link', { name: 'Download all statements (.json)' }).getAttribute('href')
  const res = await page.request.get(href!)
  expect(res.headers()['content-disposition']).toContain('.xapi.json')
  const statements = (await res.json()) as { verb: { id: string }; actor: { account: { name: string } } }[]
  expect(statements.length).toBeGreaterThan(0)
  expect(statements.some((st) => st.verb.id.endsWith('/passed'))).toBe(true)
  expect(JSON.stringify(statements)).not.toMatch(/@example\.test/)
  const anonymous = await page.request.get(href!, { headers: { cookie: '' } })
  expect([401, 403]).toContain(anonymous.status())
})
