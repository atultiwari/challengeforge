import { setCertificatesEnabled } from '@challengeforge/db'
import { db } from '@/server/db'
import { optionalBool } from '@/server/body'
import { fail, ok } from '@/server/http'
import { mutation } from '@/server/route'

/** Turns certificates on (issuing to everyone who already qualifies) or off. */
export async function POST(request: Request, ctx: { params: Promise<{ packId: string }> }) {
  const { packId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    const enabled = optionalBool(body, 'enabled')
    if (enabled === undefined) return fail(400, 'bad_request', 'Say whether certificates are on.')
    return ok({ issued: await setCertificatesEnabled(db(), scope, packId, enabled) })
  })
}
