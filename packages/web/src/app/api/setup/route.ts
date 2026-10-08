import { claimSite, needsSetup, saveSiteSettings, setupTokenValid, userIdByEmail, ValidationError } from '@challengeforge/db'
import { auth } from '@/server/auth'
import { db } from '@/server/db'
import { oneOf, text } from '@/server/body'
import { fail, ok, readJson, sameOrigin, toResponse } from '@/server/http'
import { withinPublicLimit } from '@/server/limits'
import { currentSite } from '@/server/scope'
import { currentSettings } from '@/server/site-settings'
import { PRESETS, type PresetId } from '@/lib/themes'

/**
 * Creates the first admin of a site that has none, given a valid setup token.
 * Anyone can reach this route, so it is rate-limited and refuses as soon as
 * the site has an admin.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail(403, 'bad_origin', 'Request refused.')
  if (!withinPublicLimit('setup', request)) return fail(429, 'rate_limited', 'Too many attempts. Wait a minute and try again.')
  const body = await readJson(request, 8 * 1024)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'bad_request', 'The request body was not valid JSON.')
  try {
    const fields = body as Record<string, unknown>
    const site = await currentSite()
    if (!(await needsSetup(db(), site.id))) return fail(404, 'not_found', 'This site is already set up.')
    if (!(await setupTokenValid(db(), site.id, text(fields, 'token', 200), process.env['SETUP_TOKEN']))) {
      return fail(403, 'bad_token', 'That setup token is not valid (or has expired).')
    }
    const email = text(fields, 'email', 254).trim().toLowerCase()
    const password = text(fields, 'password', 128)
    if (password.length < 10) throw new ValidationError('Choose a password of at least 10 characters.')
    const name = text(fields, 'name', 100).trim()
    const signUp = await auth().api.signUpEmail({ body: { email, password, name }, headers: request.headers, asResponse: true })
    if (!signUp.ok) return fail(422, 'sign_up_failed', 'That account could not be created. If the email is already registered, use another one.')
    const userId = await userIdByEmail(db(), email)
    if (!userId || !(await claimSite(db(), site.id, userId))) return fail(409, 'already_set_up', 'Someone finished setting up this site first.')
    const scope = { siteId: site.id, principal: { userId, role: 'admin' as const } }
    await saveSiteSettings(db(), scope, await currentSettings(), {
      name: text(fields, 'siteName', 100).trim(),
      theme: { preset: oneOf(fields, 'preset', Object.keys(PRESETS) as PresetId[]) },
    })
    // Signed in as the new admin (the sign-up set the session cookie).
    const response = ok({ ok: true })
    for (const cookie of signUp.headers.getSetCookie()) response.headers.append('set-cookie', cookie)
    return response
  } catch (err) {
    return toResponse(err)
  }
}
