import { addMember, type Role } from '@challengeforge/db'
import { db } from '@/server/db'
import { oneOf, text } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

/** An admin adds an existing account to this site, with a role (how people join a closed site). */
export async function POST(request: Request) {
  return mutation(request, async ({ scope, body }) =>
    ok(await addMember(db(), scope, text(body, 'email', 254), oneOf(body, 'role', ['learner', 'author', 'editor', 'admin'] as const satisfies readonly Role[]))),
  )
}
