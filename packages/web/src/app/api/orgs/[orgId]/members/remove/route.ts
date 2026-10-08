import { removeOrgMember } from '@challengeforge/db'
import { db } from '@/server/db'
import { text } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

export async function POST(request: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    await removeOrgMember(db(), scope, orgId, text(body, 'userId', 64))
    return ok({})
  })
}
