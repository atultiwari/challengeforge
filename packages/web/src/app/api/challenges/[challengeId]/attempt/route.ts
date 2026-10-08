import { startOrResume } from '@challengeforge/db'
import { db } from '@/server/db'
import { attemptDeps } from '@/server/attempt-deps'
import { fail, ok, readJson, sameOrigin, toResponse } from '@/server/http'
import { withinLimit } from '@/server/limits'
import { currentScope } from '@/server/scope'

/** Starts (or resumes) the learner's attempt. `{ "preview": true }` lets an author play the latest draft. */
export async function POST(request: Request, ctx: { params: Promise<{ challengeId: string }> }) {
  if (!(await sameOrigin(request))) return fail(403, 'bad_origin', 'Request refused.')
  try {
    const { challengeId } = await ctx.params
    const body = (await readJson(request)) as { preview?: unknown } | null
    const { scope } = await currentScope()
    if (!withinLimit('start', scope, request)) return fail(429, 'rate_limited', 'Too many requests. Wait a minute and try again.')
    return ok(await startOrResume(db(), scope, attemptDeps, challengeId, { preview: body?.preview === true }))
  } catch (err) {
    return toResponse(err)
  }
}
