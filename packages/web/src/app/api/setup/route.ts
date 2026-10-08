import { claimSite, discardSetupAccount, needsSetup, saveSiteSettings, setupTokenValid, userIdByEmail, ValidationError } from '@challengeforge/db'
import { authForRequest } from '@/server/auth'
import { clearSiteCache, siteContextForRequest } from '@/server/site'
import { db } from '@/server/db'
import { oneOf, text } from '@/server/body'
import { fail, ok, readJson, sameOrigin, toResponse } from '@/server/http'
import { withinPublicLimit } from '@/server/limits'
import { currentSettings } from '@/server/site-settings'
import { PRESETS, type PresetId } from '@/lib/themes'

/**
 * Creates the first admin of a site that has none, given a valid setup token.
 * Anyone can reach this route, so it is rate-limited and refuses as soon as
 * the site has an admin.
 */
export async function POST(request: Request) {
  if (!(await sameOrigin(request))) return fail(403, 'bad_origin', 'Request refused.')
  if (!withinPublicLimit('setup', request)) return fail(429, 'rate_limited', 'Too many attempts. Wait a minute and try again.')
  const body = await readJson(request, 8 * 1024)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'bad_request', 'The request body was not valid JSON.')
  try {
    const fields = body as Record<string, unknown>
    const ctx = await siteContextForRequest(request)
    const site = ctx.site
    if (!(await needsSetup(db(), site.id))) return fail(404, 'not_found', 'This site is already set up.')
    // Validate EVERYTHING before creating anything: a bad field must not leave a claimed site or an orphan account.
    const input = {
      token: text(fields, 'token', 200),
      siteName: text(fields, 'siteName', 100).trim(),
      preset: oneOf(fields, 'preset', Object.keys(PRESETS) as PresetId[]),
      name: text(fields, 'name', 100).trim(),
      email: text(fields, 'email', 254).trim().toLowerCase(),
      password: text(fields, 'password', 128),
    }
    if (input.password.length < 10) throw new ValidationError('Choose a password of at least 10 characters.')
    if (!/^[^@\s]+@[^@\s]+$/.test(input.email)) throw new ValidationError('Enter a valid email address.')
    // The SETUP_TOKEN environment variable unlocks only the install's default site; other sites use `cli setup-token --site`.
    if (!(await setupTokenValid(db(), site.id, input.token, ctx.isDefault ? process.env['SETUP_TOKEN'] : undefined))) {
      return fail(403, 'bad_token', 'That setup token is not valid (or has expired).')
    }
    const signUp = await (await authForRequest(request)).api.signUpEmail({ body: { email: input.email, password: input.password, name: input.name }, headers: request.headers, asResponse: true })
    if (!signUp.ok) return fail(422, 'sign_up_failed', 'That account could not be created. If the email is already registered, use another one.')
    const userId = await userIdByEmail(db(), input.email)
    if (!userId) return fail(500, 'server_error', 'Something went wrong. Please try again.')
    if (!(await claimSite(db(), site.id, userId))) {
      await discardSetupAccount(db(), userId)
      return fail(409, 'already_set_up', 'This site has just been set up by someone else.')
    }
    const response = ok({ ok: true })
    // Signed in as the new admin (the sign-up set the session cookie), even if saving the look below fails.
    for (const cookie of signUp.headers.getSetCookie()) response.headers.append('set-cookie', cookie)
    try {
      const scope = { siteId: site.id, principal: { userId, role: 'admin' as const } }
      await saveSiteSettings(db(), scope, await currentSettings(), { name: input.siteName, theme: { preset: input.preset } })
      clearSiteCache()
    } catch (cause) {
      console.error('[setup] the site was claimed, but its name and look could not be saved', cause)
    }
    return response
  } catch (err) {
    return toResponse(err)
  }
}
