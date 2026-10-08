import { revokeGrant } from '@challengeforge/db'
import { db } from '@/server/db'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

export async function POST(request: Request, ctx: { params: Promise<{ grantId: string }> }) {
  const { grantId } = await ctx.params
  return mutation(request, async ({ scope }) => {
    await revokeGrant(db(), scope, grantId)
    return ok({})
  })
}
