import { removeAssignment } from '@challengeforge/db'
import { db } from '@/server/db'
import { text } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

export async function POST(request: Request, ctx: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    await removeAssignment(db(), scope, cohortId, text(body, 'assignmentId', 64))
    return ok({})
  })
}
