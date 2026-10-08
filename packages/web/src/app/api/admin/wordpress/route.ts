import { randomBytes } from 'node:crypto'
import { saveWpConnection, setWpEnabled } from '@challengeforge/db'
import { seal } from '@challengeforge/services'
import { db } from '@/server/db'
import { optionalBool, optionalText } from '@/server/body'
import { fail, ok } from '@/server/http'
import { ltiSecret } from '@/server/lti'
import { mutation } from '@/server/route'

/**
 * Connects a WordPress site: a new secret is generated, sealed, stored, and
 * returned ONCE for the admin to paste into the plugin. Or pauses/resumes.
 */
export async function POST(request: Request) {
  return mutation(request, async ({ scope, body }) => {
    const wpUrl = optionalText(body, 'wpUrl', 500)
    if (wpUrl === undefined) {
      const enabled = optionalBool(body, 'enabled')
      if (enabled === undefined) return fail(400, 'bad_request', 'Enter the WordPress address.')
      await setWpEnabled(db(), scope, enabled)
      return ok({ enabled })
    }
    const secret = randomBytes(32).toString('base64url')
    await saveWpConnection(db(), scope, wpUrl, seal(secret, ltiSecret()))
    return ok({ secret })
  })
}
