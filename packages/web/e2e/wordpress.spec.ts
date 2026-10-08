import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { SignJWT } from 'jose'
import { BASE_URL, E2E_ADMIN } from './config'
import { signIn } from './helpers'

/** Stands in for the WordPress site; the token is what the plugin's PHP builds (same claims, HS256). */
const WP = 'http://localhost:3297'

test('a WordPress member clicks the shortcode button and arrives signed in on the challenge', async ({ page }) => {
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  const quizHref = await page.getByRole('link', { name: /E2E arithmetic quiz/ }).getAttribute('href')
  await page.goto('/admin/wordpress')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('WordPress site address').fill(WP)
  await page.getByRole('button', { name: /Connect/ }).click()
  const secret = (await page.getByTestId('wp-secret').textContent())!.trim()
  expect(secret.length).toBeGreaterThan(30)
  await page.context().clearCookies()

  const token = await new SignJWT({ name: 'Wendy Press', next: quizHref })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(WP)
    .setAudience(BASE_URL)
    .setSubject('42')
    .setJti(randomBytes(16).toString('hex'))
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(new TextEncoder().encode(secret))
  const wordpressPage = `<form method="post" action="${BASE_URL}/sso/wordpress"><input type="hidden" name="token" value="${token}"><button>Start the challenge</button></form>`
  await page.setContent(wordpressPage)
  await page.getByRole('button', { name: 'Start the challenge' }).click()
  await expect(page).toHaveURL(new RegExp(`${quizHref}$`))
  await expect(page.getByRole('navigation', { name: 'Main' })).toContainText('Wendy Press')

  // The same button again (a replayed token) is refused.
  await page.context().clearCookies()
  await page.setContent(wordpressPage)
  await page.getByRole('button', { name: 'Start the challenge' }).click()
  await expect(page.getByText(/already used/)).toBeVisible()
})
