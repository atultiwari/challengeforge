import { removeCollaborator } from '@challengeforge/db'
import { db } from '@/server/db'
import { fail, ok } from '@/server/http'
import { mutation } from '@/server/route'

export async function POST(request: Request, ctx: { params: Promise<{ challengeId: string }> }) {
  const { challengeId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    const userId = body['userId']
    if (typeof userId !== 'string' || userId.length > 64) return fail(400, 'bad_request', 'Missing person.')
    await removeCollaborator(db(), scope, challengeId, userId)
    return ok({ userId })
  })
}
