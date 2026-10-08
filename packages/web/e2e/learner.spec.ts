import { expect, test } from '@playwright/test'

/** The critical learner path: sign up, play both paradigms of static challenge, see progress. */
test('a new learner signs up, plays and passes, and sees their progress', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`
  await page.goto('/sign-up')
  await page.getByLabel('Your name').fill('E2E Learner')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('e2e-password-12345')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Learn by doing' })).toBeVisible()

  // A question set: answer and pass.
  await page.getByRole('link', { name: /E2E arithmetic quiz/ }).click()
  await page.getByLabel('Four').check()
  await page.getByLabel('Six times seven?').fill('42')
  await page.getByRole('button', { name: 'Submit answers' }).click()
  await expect(page.getByRole('heading', { name: 'Passed' })).toBeVisible()

  // A ported Lab mission: wrong first (feedback, no answer leaked), then right.
  await page.goto('/')
  await page.getByRole('link', { name: /E2E scenario mission/ }).click()
  await page.getByLabel('Favourite colour').check()
  await page.getByRole('button', { name: /Submit/ }).click()
  await expect(page.getByText('That is not the answer we are looking for.')).toBeVisible()
  await expect(page.getByText('Always ask about allergies.')).toHaveCount(0)
  await page.getByLabel('Allergies').check()
  await page.getByRole('button', { name: /Submit/ }).click()
  await expect(page.getByText('Always ask about allergies.')).toBeVisible()

  await page.goto('/')
  await expect(page.getByText(/Passed · 100 points/)).toBeVisible()
  await expect(page.getByText(/Passed · 90 points/)).toBeVisible()
})

test('signed-out visitors are sent to sign in, and cannot reach author pages', async ({ page }) => {
  await page.goto('/author')
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fauthor/)
})
