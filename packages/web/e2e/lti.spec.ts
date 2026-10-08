import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { BASE_URL, E2E_ADMIN, E2E_ENV } from './config'
import { signIn } from './helpers'
import { CLIENT_ID, DEPLOYMENT_ID, PLATFORM, startPlatform, type SimulatedPlatform } from './lti-platform'

const LTI = 'https://purl.imsglobal.org/spec/lti/claim'
let platform: SimulatedPlatform

test.beforeAll(async () => {
  platform = await startPlatform(BASE_URL)
})
test.afterAll(async () => platform.close())

test('an LMS registers the tool, a teacher adds a challenge by deep linking, a learner launches, plays, and the grade goes back', async ({ page }) => {
  // The site admin registers the simulated LMS.
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.goto('/admin/lti')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Name', { exact: true }).fill('E2E Moodle')
  await page.getByLabel('Platform ID / issuer').fill(PLATFORM)
  await page.getByLabel('Client ID').fill(CLIENT_ID)
  await page.getByLabel('Deployment ID(s)').fill(DEPLOYMENT_ID)
  await page.getByLabel('Authentication request URL').fill(`${PLATFORM}/auth`)
  await page.getByLabel('Access token URL').fill(`${PLATFORM}/token`)
  await page.getByLabel('Public keyset URL').fill(`${PLATFORM}/jwks`)
  await page.getByRole('button', { name: 'Save platform' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'E2E Moodle' })).toContainText('active')
  await page.context().clearCookies()

  // A teacher adds a challenge to their course through Deep Linking.
  platform.nextLaunch = {
    sub: 'teacher-1',
    name: 'Course Teacher',
    [`${LTI}/message_type`]: 'LtiDeepLinkingRequest',
    [`${LTI}/roles`]: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'],
    [`${LTI}/context`]: { id: 'course-42', title: 'Pathology 101' },
    'https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings': { deep_link_return_url: `${PLATFORM}/deep-link-return`, accept_types: ['ltiResourceLink'], data: 'e2e-data' },
  }
  await page.goto(`${PLATFORM}/start`)
  await expect(page.getByRole('heading', { name: 'Choose challenges' })).toBeVisible()
  await page.getByLabel(/E2E arithmetic quiz/).check()
  await page.getByRole('button', { name: 'Add to course' }).click()
  await page.getByRole('button', { name: 'Return to your course' }).click()
  await expect(page.getByRole('heading', { name: 'Course updated' })).toBeVisible()
  const item = platform.deepLinkItems?.[0] as { custom: { challenge_id: string }; url: string; lineItem: { scoreMaximum: number } }
  expect(item.url).toBe(`${BASE_URL}/lti/launch`)
  expect(item.lineItem.scoreMaximum).toBe(100)
  const challengeId = item.custom.challenge_id
  await page.context().clearCookies()

  // A learner opens the activity from the course: signed in as their LMS identity, straight to the challenge.
  platform.nextLaunch = {
    sub: 'student-1',
    name: 'LMS Student',
    email: 'someone-else@example.test',
    [`${LTI}/message_type`]: 'LtiResourceLinkRequest',
    [`${LTI}/resource_link`]: { id: 'placement-1' },
    [`${LTI}/roles`]: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
    [`${LTI}/context`]: { id: 'course-42', title: 'Pathology 101' },
    [`${LTI}/custom`]: { challenge_id: challengeId },
    'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint': { scope: ['https://purl.imsglobal.org/spec/lti-ags/scope/score'], lineitem: `${PLATFORM}/lineitems/7` },
  }
  await page.goto(`${PLATFORM}/start`)
  await expect(page).toHaveURL(new RegExp(`/play/${challengeId}$`))
  await expect(page.getByRole('navigation', { name: 'Main' })).toContainText('LMS Student')
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByLabel('Four').check()
  await page.getByLabel('Six times seven?').fill('42')
  await page.getByRole('button', { name: 'Submit answers' }).click()
  await expect(page.getByRole('heading', { name: 'Passed' })).toBeVisible()

  // Cron sends the grade back to the LMS grade book.
  // Asynchronously: the simulated LMS runs in THIS process and must keep answering while the CLI calls it.
  await promisify(execFile)('pnpm', ['--filter', '@challengeforge/cli', 'cf', 'run-jobs', '--max-seconds', '10'], { env: { ...process.env, ...E2E_ENV } })
  expect(platform.scores).toEqual([
    { url: '/lineitems/7/scores', body: expect.objectContaining({ userId: 'student-1', scoreGiven: 100, scoreMaximum: 100, gradingProgress: 'FullyGraded', activityProgress: 'Completed' }) },
  ])
})

test('a launch with a forged token is refused and signs nobody in', async ({ page }) => {
  await page.context().clearCookies()
  const response = await page.request.post('/lti/launch', { form: { id_token: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln', state: 'made-up' } })
  expect(response.status()).toBe(400)
  expect(await response.text()).toContain('could not be matched to its login')
  expect((await page.context().cookies()).some((c) => c.name.includes('session'))).toBe(false)
  // Without the launch's ticket cookie, the hand-off signs nobody in either.
  const handOff = await page.request.get('/lti/session?next=/', { maxRedirects: 0 })
  expect(handOff.status()).toBe(401)
})
