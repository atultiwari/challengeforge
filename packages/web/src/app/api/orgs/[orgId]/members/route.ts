import { setOrgMember } from '@challengeforge/db'
import { db } from '@/server/db'
import { oneOf, text } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

/** Gives someone a role in the organisation, by email. */
export async function POST(request: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params
  return mutation(request, async ({ scope, body }) =>
    ok(await setOrgMember(db(), scope, orgId, text(body, 'email', 254), oneOf(body, 'role', ['member', 'instructor', 'org_admin'] as const))),
  )
}
