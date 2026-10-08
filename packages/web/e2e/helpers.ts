import { expect, type Page } from '@playwright/test'

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
