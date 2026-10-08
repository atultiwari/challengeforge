import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { MAIL_OUTBOX } from './config'

interface SentMail {
  to: string
  subject: string
  text: string
}

/** The newest message sent to `to`, waiting for it to arrive (mail is sent in the background). */
async function latestMailTo(to: string): Promise<SentMail> {
  let found: SentMail | undefined
  await expect
    .poll(async () => {
      const files = (await readdir(MAIL_OUTBOX).catch(() => [] as string[])).sort().reverse()
      for (const file of files) {
        const mail = JSON.parse(await readFile(path.join(MAIL_OUTBOX, file), 'utf8')) as SentMail
        if (mail.to === to) return (found = mail)
      }
      return undefined
    }, { timeout: 10_000 })
    .toBeTruthy()
  return found!
}

test('a learner who forgot their password resets it by email, and the link works only once', async ({ page }) => {
  const email = `reset-${Date.now()}@example.test`
  await page.goto('/sign-up')
  await page.getByLabel('Your name').fill('Forgetful Learner')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('original-password-123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Learn by doing' })).toBeVisible()
  await page.context().clearCookies()

  await page.goto('/sign-in')
  await page.getByRole('link', { name: 'Forgot your password?' }).click()
  // The dev server compiles a route on first visit and hot-reloads it; let that settle before typing.
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send me a reset link' }).click()
  await expect(page.getByText('Check your email.')).toBeVisible()

  const mail = await latestMailTo(email)
  expect(mail.subject).toMatch(/Reset your/)
  const link = /https?:\/\/\S+/.exec(mail.text)?.[0]
  expect(link).toBeTruthy()

  await page.goto(link!)
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.getByLabel('New password').fill('brand-new-password-456')
  await page.getByLabel('Type it again').fill('brand-new-password-456')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Your password has been changed.')).toBeVisible()

  // The old password no longer works; the new one does.
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('original-password-123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByLabel('Password').fill('brand-new-password-456')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Learn by doing' })).toBeVisible()

  // A used link is refused.
  await page.context().clearCookies()
  await page.goto(link!)
  await expect(page.getByText(/expired or was already used/)).toBeVisible()
})

test('asking to reset an unknown address looks exactly like a known one', async ({ page }) => {
  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill(`nobody-${Date.now()}@example.test`)
  await page.getByRole('button', { name: 'Send me a reset link' }).click()
  await expect(page.getByText('Check your email.')).toBeVisible()
})
