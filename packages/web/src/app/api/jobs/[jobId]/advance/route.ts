import { advanceJob, getJob } from '@challengeforge/db'
import { attemptDeps } from '@/server/attempt-deps'
import { db } from '@/server/db'
import { fail, ok, sameOrigin, toResponse } from '@/server/http'
import { withinLimit } from '@/server/limits'
import { currentScope } from '@/server/scope'

/**
 * The learner's page polls this while a background job (e.g. an evaluation
 * run) is in progress: each call runs at most one bounded slice of the job,
 * so no request ever runs long, then returns the job and the attempt.
 */
export async function POST(request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  if (!sameOrigin(request)) return fail(403, 'bad_origin', 'Request refused.')
  try {
    const { jobId } = await ctx.params
    const { scope } = await currentScope()
    // Ownership first: only the learner whose job it is may advance it.
    await getJob(db(), scope, jobId)
    if (!withinLimit('action', scope, request)) return fail(429, 'rate_limited', 'Too many requests. Wait a minute and try again.')
    await advanceJob(db(), attemptDeps, jobId)
    return ok(await getJob(db(), scope, jobId, attemptDeps))
  } catch (err) {
    return toResponse(err)
  }
}
