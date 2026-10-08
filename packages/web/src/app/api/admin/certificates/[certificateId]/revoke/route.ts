import { revokeCertificate } from '@challengeforge/db'
import { db } from '@/server/db'
import { text } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

export async function POST(request: Request, ctx: { params: Promise<{ certificateId: string }> }) {
  const { certificateId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    await revokeCertificate(db(), scope, certificateId, text(body, 'reason', 500))
    return ok({})
  })
}
