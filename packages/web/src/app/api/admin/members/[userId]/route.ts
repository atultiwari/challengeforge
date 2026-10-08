import { setRole, type Role } from '@challengeforge/db'
import { db } from '@/server/db'
import { fail, ok } from '@/server/http'
import { mutation } from '@/server/route'

const ROLES: readonly Role[] = ['learner', 'author', 'admin']

export async function POST(request: Request, ctx: { params: Promise<{ userId: string }> }) {
  const { userId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    const role = body['role']
    if (!ROLES.includes(role as Role)) return fail(400, 'bad_role', 'Unknown role.')
    await setRole(db(), scope, userId, role as Role)
    return ok({ userId, role })
  })
}
