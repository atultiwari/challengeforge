import { overrideAssessment } from '@challengeforge/db'
import { db } from '@/server/db'
import { fail, ok } from '@/server/http'
import { mutation } from '@/server/route'

/** An admin confirms or overturns a result in the review queue. */
export async function POST(request: Request, ctx: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    const passed = body['passed']
    const points = Number(body['points'])
    if (typeof passed !== 'boolean' || !Number.isFinite(points) || points < 0 || points > 100_000) {
      return fail(400, 'bad_request', 'Give a pass or fail and a points value.')
    }
    await overrideAssessment(db(), scope, attemptId, { passed, points })
    return ok({ attemptId })
  })
}
