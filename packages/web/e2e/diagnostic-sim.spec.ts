import { expect, test } from '@playwright/test'

/** The interactive paradigm end to end: a patient worked up step by step, then graded on the path. */
test('a learner works up the DKA case and is graded on the reasoning path', async ({ page }) => {
  // A long journey (two full plays of the case): more than the default 30 s on a cold dev server.
  test.setTimeout(120_000)
  page.on('dialog', (dialog) => void dialog.accept())
  await page.goto('/sign-up')
  await page.getByLabel('Your name').fill('Sim Learner')
  await page.getByLabel('Email').fill(`sim-${Date.now()}@example.test`)
  await page.getByLabel('Password').fill('e2e-password-12345')
  await page.getByRole('button', { name: 'Create account' }).click()

  await page.getByRole('link', { name: /Vomiting and abdominal pain/ }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByText(/T\+0 min/)).toBeVisible()

  // Talking to the patient (simulated, grounded in the case's history list): what it reveals joins the notes.
  await page.getByLabel('Your question to the patient').fill('When did all this start?')
  await page.getByRole('button', { name: 'Ask the patient' }).click()
  await expect(page.getByRole('list', { name: 'Conversation' })).toContainText('When did all this start?')
  await expect(page.getByText('19 questions left')).toBeVisible()

  // Search-to-reveal: nothing is listed until the learner asks for it.
  await page.getByLabel('Search history').fill('insulin')
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(page.getByText(/I stopped it yesterday/)).toBeVisible()

  await page.getByRole('tab', { name: 'Investigate' }).click()
  await page.getByLabel('Search investigate').fill('glucose')
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('button', { name: 'Order' }).click()
  await page.getByRole('button', { name: 'Wait 5 min' }).click()
  await expect(page.getByText('28.4 mmol/L')).toBeVisible()

  // Right diagnosis, careless path: no fluids or insulin. It must not pass.
  await page.getByLabel('Final diagnosis').fill('Diabetic ketoacidosis')
  await page.getByRole('button', { name: /Submit diagnosis/ }).click()
  await expect(page.getByRole('heading', { name: 'Debrief' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Not passed this time' })).toBeVisible()
  await expect(page.getByText(/critical safety step was missed/)).toBeVisible()
  // The result lists each criterion; the diagnosis itself was right.
  await expect(page.getByText(/^Final diagnosis/)).toBeVisible()
})
