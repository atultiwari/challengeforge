import { performAction } from '@challengeforge/db'
import { db } from '@/server/db'
import { attemptDeps } from '@/server/attempt-deps'
import { fail, ok, readJson, sameOrigin, toResponse } from '@/server/http'
import { withinLimit } from '@/server/limits'
import { currentScope } from '@/server/scope'

const ERROR_STATUS: Readonly<Record<string, number>> = {
  rejected: 409,
  busy: 409,
  service_failed: 502,
  service_unavailable: 503,
}

/**
 * Applies one learner action. The body is `{ action, idempotencyKey }`: the
 * action is validated by the challenge type's own schema in the engine; the
 * key makes a client retry (e.g. after a shared-host timeout) safe.
 */
export async function POST(request: Request, ctx: { params: Promise<{ attemptId: string }> }) {
  if (!sameOrigin(request)) return fail(403, 'bad_origin', 'Request refused.')
  try {
    const { attemptId } = await ctx.params
    const body = (await readJson(request)) as { action?: unknown; idempotencyKey?: unknown } | null
    if (!body || body.action === undefined) return fail(400, 'invalid_action', 'No action was sent.')
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined
    const { scope } = await currentScope()
    if (!withinLimit('action', scope, request)) return fail(429, 'rate_limited', 'Too many requests. Wait a minute and try again.')
    const outcome = await performAction(db(), scope, attemptDeps, attemptId, body.action, idempotencyKey ? { idempotencyKey } : {})
    if (!outcome.ok) {
      const status = ERROR_STATUS[outcome.error.code] ?? 400
      return fail(status, outcome.error.typeCode ?? outcome.error.code, outcome.error.message)
    }
    return ok(outcome.snapshot)
  } catch (err) {
    return toResponse(err)
  }
}
