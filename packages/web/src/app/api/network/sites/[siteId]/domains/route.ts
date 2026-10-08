import { addSiteDomain } from '@challengeforge/db'
import { db } from '@/server/db'
import { text } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'
import { env } from '@/server/env'
import { clearSiteCache } from '@/server/site'

export async function POST(request: Request, ctx: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    const host = await addSiteDomain(db(), scope, siteId, text(body, 'host', 255), new URL(env().APP_URL).host)
    clearSiteCache()
    return ok({ host })
  })
}
