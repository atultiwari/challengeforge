import { grantAccess } from '@challengeforge/db'
import { db } from '@/server/db'
import { optionalDate, text } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

export async function POST(request: Request, ctx: { params: Promise<{ packId: string }> }) {
  const { packId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    await grantAccess(db(), scope, packId, text(body, 'email', 254), optionalDate(body, 'expiresAt') ?? null)
    return ok({})
  })
}
