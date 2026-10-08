import { expect, test } from '@playwright/test'
import { E2E_ADMIN } from './config'
import { confirmEmail, signIn, signUp } from './helpers'

const PASSWORD = 'e2e-password-12345'

test('an organisation runs a cohort: instructor assigns work, a learner joins by code and passes, the grid shows it', async ({ page }) => {
  const stamp = Date.now()
  const teacher = { name: 'Dr Teacher', email: `teacher-${stamp}@example.test` }
  const learner = { name: 'Cohort Learner', email: `student-${stamp}@example.test` }
  await signUp(page, teacher.name, teacher.email, PASSWORD)
  await confirmEmail(page, teacher.email)

  // The site admin creates the organisation and makes the teacher an instructor.
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.goto('/admin/orgs')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Name', { exact: true }).fill(`Medical school ${stamp}`)
  await page.getByLabel('Short name').fill(`med-${stamp}`)
  await page.getByRole('button', { name: 'Create organisation' }).click()
  await expect(page.getByRole('heading', { name: `Medical school ${stamp}` })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(teacher.email)
  await page.getByLabel('Role').selectOption('instructor')
  await page.getByRole('button', { name: 'Save role' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: teacher.email })).toContainText('instructor')

  // The instructor creates a cohort and assigns a challenge with a due date.
  await signIn(page, teacher.email, PASSWORD)
  await page.getByRole('link', { name: 'Teach' }).click()
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Name', { exact: true }).fill('Year 3, 2026')
  await page.getByRole('button', { name: 'Create cohort' }).click()
  await expect(page.getByRole('heading', { name: 'Year 3, 2026' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.getByLabel('What to assign').selectOption({ label: 'Challenge: E2E arithmetic quiz' })
  await page.getByLabel('Due (optional)').fill('2099-12-31T17:00')
  await page.getByRole('button', { name: 'Assign' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'E2E arithmetic quiz' })).toContainText('due 2099-12-31')
  const code = (await page.getByTestId('join-code').textContent())!.trim()
  const cohortUrl = new URL(page.url()).pathname

  // A new learner joins with the link their instructor shared, and plays the assignment.
  await signUp(page, learner.name, learner.email, PASSWORD)
  await page.goto(`/join?code=${code}`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Join' }).click()
  await expect(page.getByRole('heading', { name: 'Year 3, 2026' })).toBeVisible()
  await expect(page.getByText('0 of 1 passed')).toBeVisible()
  await page.getByRole('link', { name: 'E2E arithmetic quiz' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByLabel('Four').check()
  await page.getByLabel('Six times seven?').fill('42')
  await page.getByRole('button', { name: 'Submit answers' }).click()
  await expect(page.getByRole('heading', { name: 'Passed' })).toBeVisible()
  await page.goto('/')
  await page.getByRole('link', { name: 'Year 3, 2026' }).click()
  await expect(page.getByText('1 of 1 passed')).toBeVisible()

  // The instructor sees it in the grid; the learner cannot open the instructor view.
  await page.goto(cohortUrl)
  await expect(page.getByText('This page could not be found')).toBeVisible()
  await signIn(page, teacher.email, PASSWORD)
  await page.goto(cohortUrl)
  const row = page.getByRole('row').filter({ hasText: learner.email })
  await expect(row).toContainText('1/1')
  await expect(row).toContainText('✓')
})
