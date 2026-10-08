import { savePlatform } from '@challengeforge/db'
import { db } from '@/server/db'
import { text } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

/** Registers (or updates) an LMS. Deployment ids are comma- or space-separated. */
export async function POST(request: Request) {
  return mutation(request, async ({ scope, body }) =>
    ok(
      await savePlatform(db(), scope, {
        name: text(body, 'name'),
        issuer: text(body, 'issuer', 255),
        clientId: text(body, 'clientId', 255),
        authLoginUrl: text(body, 'authLoginUrl', 500),
        authTokenUrl: text(body, 'authTokenUrl', 500),
        jwksUrl: text(body, 'jwksUrl', 500),
        deploymentIds: text(body, 'deploymentIds', 2000).split(/[\s,]+/),
      }),
    ),
  )
}
