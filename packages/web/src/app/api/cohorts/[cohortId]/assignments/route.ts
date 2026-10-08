import { addAssignment, ValidationError } from '@challengeforge/db'
import { db } from '@/server/db'
import { optionalDate, text } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

/** Assigns a pack or a challenge. The form sends one "target" field: "pack:<id>" or "challenge:<id>". */
export async function POST(request: Request, ctx: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    const [kind, id] = text(body, 'target', 80).split(':')
    if ((kind !== 'pack' && kind !== 'challenge') || !id) throw new ValidationError('Choose what to assign.')
    const dueAt = optionalDate(body, 'dueAt') ?? null
    return ok(await addAssignment(db(), scope, cohortId, kind === 'pack' ? { packId: id, dueAt } : { challengeId: id, dueAt }))
  })
}
