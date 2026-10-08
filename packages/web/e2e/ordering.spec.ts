import { expect, test } from '@playwright/test'
import { E2E_ADMIN } from './config'
import { signIn } from './helpers'

const CORRECT = ['The first step', 'The second step', 'The third step']

test('an author creates an ordering challenge from the form; a learner puts the steps in order and passes', async ({ page }) => {
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.goto('/author/new?type=ordering')
  await expect(page.getByRole('heading', { name: 'New ordering challenge' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page).toHaveURL(/\/author\/[0-9a-f-]{36}\?saved=1/)
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Publish this version' }).click()
  await expect(page.getByText('Published: learners can play it.')).toBeVisible()
  const challengeId = new URL(page.url()).pathname.split('/')[2]!

  await page.goto(`/play/${challengeId}`)
  await page.getByRole('button', { name: 'Start' }).click()
  const list = page.getByRole('list', { name: 'Steps, in your order' })
  await expect(list).toBeVisible()
  // Move each step up until it sits in its place, using only the accessible buttons.
  for (const [target, text] of CORRECT.entries()) {
    for (;;) {
      const items = await list.getByRole('listitem').allInnerTexts()
      const at = items.findIndex((t) => t.includes(text))
      if (at <= target) break
      await page.getByRole('button', { name: `Move “${text}” up` }).click()
    }
  }
  await page.getByRole('button', { name: 'Submit order' }).click()
  await expect(page.getByRole('heading', { name: 'The right order' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Passed' })).toBeVisible()
})
