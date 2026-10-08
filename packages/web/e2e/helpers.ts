import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { MAIL_OUTBOX } from './config'

export interface SentMail {
  to: string
  subject: string
  text: string
}

/** The newest message sent to `to` matching `subject`, waiting for it to arrive (mail is sent in the background). */
export async function latestMailTo(to: string, subject: RegExp = /./): Promise<SentMail> {
  let found: SentMail | undefined
  await expect
    .poll(async () => {
      const files = (await readdir(MAIL_OUTBOX).catch(() => [] as string[])).sort().reverse()
      for (const file of files) {
        const mail = JSON.parse(await readFile(path.join(MAIL_OUTBOX, file), 'utf8')) as SentMail
        if (mail.to === to && subject.test(mail.subject)) return (found = mail)
      }
      return undefined
    }, { timeout: 15_000 })
    .toBeTruthy()
  return found!
}

/** The signed-in person confirms their email through the real link (needed before others can give them roles). */
export async function confirmEmail(page: Page, email: string): Promise<void> {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Send confirmation link' }).click()
  await expect(page.getByText('Check your inbox for the link.')).toBeVisible()
  const link = /https?:\/\/\S+/.exec((await latestMailTo(email, /Confirm your email/)).text)![0]
  await page.goto(link)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Send confirmation link' })).toHaveCount(0)
}

export async function signUp(page: Page, name: string, email: string, password: string): Promise<void> {
  await page.context().clearCookies()
  await page.goto('/sign-up')
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Learn by doing' })).toBeVisible()
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.context().clearCookies()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Learn by doing' })).toBeVisible()
}
