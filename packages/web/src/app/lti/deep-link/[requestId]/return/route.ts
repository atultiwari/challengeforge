import { consumeDeepLinkRequest, getDeepLinkRequest, getPlatform, listPlayable, SCORE_MAXIMUM } from '@challengeforge/db'
import { deepLinkResponse, ensureToolKey } from '@challengeforge/services'
import { db } from '@/server/db'
import { env } from '@/server/env'
import { sameOrigin } from '@/server/http'
import { escapeHtml, ltiError, ltiPage, ltiSecret } from '@/server/lti'
import { currentScope } from '@/server/scope'

const MAX_ITEMS = 50

/**
 * Signs the teacher's choice and hands it back to the LMS. The page posts to
 * the LMS's return URL, so it carries its own CSP allowing exactly that form
 * target (the site-wide CSP only allows forms to post to this site).
 */
export async function POST(request: Request, ctx: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await ctx.params
  if (!sameOrigin(request)) return ltiError('Request refused.', 403)
  const { scope } = await currentScope()
  if (!scope.principal) return ltiError('Your session has ended. Start again from your course.', 401)
  const pending = await getDeepLinkRequest(db(), scope.siteId, requestId, scope.principal.userId)
  if (!pending) return ltiError('This request has expired or was already used. Start again from your course.', 404)
  const chosen = new Set((await request.formData()).getAll('challenge').filter((v): v is string => typeof v === 'string'))
  const items = (await listPlayable(db(), scope)).filter((c) => chosen.has(c.id)).slice(0, MAX_ITEMS).map((c) => ({ id: c.id, title: c.title }))
  const platform = await getPlatform(db(), scope.siteId, pending.platformId)
  if (!platform || !platform.active) return ltiError('This LMS is no longer registered with this site.')
  if (!(await consumeDeepLinkRequest(db(), requestId))) return ltiError('This request was already used. Start again from your course.', 409)
  const key = await ensureToolKey(db(), scope.siteId, ltiSecret())
  const jwt = await deepLinkResponse(key, platform, { deploymentId: pending.deploymentId, data: pending.data, appUrl: env().APP_URL, items, scoreMaximum: SCORE_MAXIMUM })
  const target = new URL(pending.returnUrl)
  const body = `<h1>${items.length === 0 ? 'Nothing chosen' : `Adding ${items.length} activit${items.length === 1 ? 'y' : 'ies'}`}</h1>
<form method="post" action="${escapeHtml(target.href)}"><input type="hidden" name="JWT" value="${escapeHtml(jwt)}"><button type="submit">Return to your course</button></form>`
  return ltiPage('Return to your course', body, {
    headers: { 'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${target.origin}; frame-ancestors 'none'; base-uri 'none'` },
  })
}
