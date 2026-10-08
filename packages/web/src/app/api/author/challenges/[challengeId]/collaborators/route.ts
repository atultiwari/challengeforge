import { addCollaborator } from '@challengeforge/db'
import { db } from '@/server/db'
import { fail, ok } from '@/server/http'
import { mutation } from '@/server/route'
import { emailLookup } from '@/server/mail'

/** Adds a co-author by email (the creator or an editor). */
export async function POST(request: Request, ctx: { params: Promise<{ challengeId: string }> }) {
  const { challengeId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    const email = body['email']
    if (typeof email !== 'string' || email.length > 254 || !email.includes('@')) return fail(400, 'bad_email', 'Enter an email address.')
    return ok(await addCollaborator(db(), scope, challengeId, email, emailLookup()))
  })
}
