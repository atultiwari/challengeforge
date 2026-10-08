import { setMailPreferences } from '@challengeforge/db'
import { db } from '@/server/db'
import { optionalBool } from '@/server/body'
import { fail, ok } from '@/server/http'
import { mutation } from '@/server/route'

/** The signed-in person turns update emails on or off. */
export async function POST(request: Request) {
  return mutation(request, async ({ scope, body }) => {
    const updates = optionalBool(body, 'updates')
    if (updates === undefined) return fail(400, 'bad_request', 'Say whether you want update emails.')
    await setMailPreferences(db(), scope, { updates })
    return ok({ updates })
  })
}
