import { setPlatformActive } from '@challengeforge/db'
import { db } from '@/server/db'
import { optionalBool } from '@/server/body'
import { fail, ok } from '@/server/http'
import { mutation } from '@/server/route'

export async function POST(request: Request, ctx: { params: Promise<{ platformId: string }> }) {
  const { platformId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    const active = optionalBool(body, 'active')
    if (active === undefined) return fail(400, 'bad_request', 'Say whether the platform is active.')
    await setPlatformActive(db(), scope, platformId, active)
    return ok({ active })
  })
}
