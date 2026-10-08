import { addSiteDomain } from '@challengeforge/db'
import { db } from '@/server/db'
import { text } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

export async function POST(request: Request, ctx: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await ctx.params
  return mutation(request, async ({ scope, body }) => ok({ host: await addSiteDomain(db(), scope, siteId, text(body, 'host', 255)) }))
}
