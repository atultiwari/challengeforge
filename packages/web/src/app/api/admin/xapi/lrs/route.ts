import { saveLrsEndpoint, setLrsEnabled } from '@challengeforge/db'
import { seal } from '@challengeforge/services'
import { db } from '@/server/db'
import { optionalBool, optionalText, text } from '@/server/body'
import { ok } from '@/server/http'
import { ltiSecret } from '@/server/lti'
import { mutation } from '@/server/route'

/** Connects the site's LRS (the secret is sealed before it is stored), or turns sending on and off. */
export async function POST(request: Request) {
  return mutation(request, async ({ scope, body }) => {
    const enabled = optionalBool(body, 'enabled')
    if (enabled !== undefined && optionalText(body, 'endpoint') === undefined) {
      await setLrsEnabled(db(), scope, enabled)
      return ok({ enabled })
    }
    await saveLrsEndpoint(db(), scope, {
      endpoint: text(body, 'endpoint', 500),
      username: text(body, 'username', 200),
      secretSealed: seal(text(body, 'secret', 500), ltiSecret()),
    })
    return ok({ saved: true })
  })
}
