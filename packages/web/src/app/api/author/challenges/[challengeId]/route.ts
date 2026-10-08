import { saveDraftVersion } from '@challengeforge/db'
import { registry } from '@challengeforge/types'
import { db } from '@/server/db'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

/** Saves the form as a new immutable version (the challenge returns to draft). */
export async function PUT(request: Request, ctx: { params: Promise<{ challengeId: string }> }) {
  const { challengeId } = await ctx.params
  return mutation(
    request,
    async ({ scope, body }) => ok({ version: await saveDraftVersion(db(), scope, registry, challengeId, body['definition']) }),
    512 * 1024,
  )
}
