import { setPackAccess } from '@challengeforge/db'
import { db } from '@/server/db'
import { oneOf } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

export async function POST(request: Request, ctx: { params: Promise<{ packId: string }> }) {
  const { packId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    const access = oneOf(body, 'access', ['open', 'restricted'] as const)
    await setPackAccess(db(), scope, packId, access)
    return ok({ access })
  })
}
