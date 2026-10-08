import { archive, publish, submitForReview } from '@challengeforge/db'
import { db } from '@/server/db'
import { fail, ok } from '@/server/http'
import { mutation } from '@/server/route'

/** Workflow transitions. The repository enforces who may do which (authors submit, admins publish). */
export async function POST(request: Request, ctx: { params: Promise<{ challengeId: string }> }) {
  const { challengeId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    switch (body['action']) {
      case 'submit':
        await submitForReview(db(), scope, challengeId)
        return ok({ status: 'in_review' })
      case 'publish':
        await publish(db(), scope, challengeId)
        return ok({ status: 'published' })
      case 'archive':
        await archive(db(), scope, challengeId)
        return ok({ status: 'archived' })
      default:
        return fail(400, 'bad_action', 'Unknown action.')
    }
  })
}
