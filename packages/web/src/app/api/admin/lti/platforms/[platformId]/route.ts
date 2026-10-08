import { setPlatformActive, setPlatformGrantsAccess } from '@challengeforge/db'
import { db } from '@/server/db'
import { optionalBool } from '@/server/body'
import { fail, ok } from '@/server/http'
import { mutation } from '@/server/route'

export async function POST(request: Request, ctx: { params: Promise<{ platformId: string }> }) {
  const { platformId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    const active = optionalBool(body, 'active')
    const grantsAccess = optionalBool(body, 'grantsAccess')
    if (active === undefined && grantsAccess === undefined) return fail(400, 'bad_request', 'Nothing to change.')
    if (active !== undefined) await setPlatformActive(db(), scope, platformId, active)
    if (grantsAccess !== undefined) await setPlatformGrantsAccess(db(), scope, platformId, grantsAccess)
    return ok({ active, grantsAccess })
  })
}
