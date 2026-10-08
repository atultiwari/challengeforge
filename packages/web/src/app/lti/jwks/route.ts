import { toolPublicJwks } from '@challengeforge/db'
import { ensureToolKey } from '@challengeforge/services'
import { db } from '@/server/db'
import { ltiSecret } from '@/server/lti'
import { currentSite } from '@/server/scope'

/** The tool's public keys, for platforms checking deep-link responses and token requests. */
export async function GET() {
  const site = await currentSite()
  await ensureToolKey(db(), site.id, ltiSecret())
  return Response.json({ keys: await toolPublicJwks(db(), site.id) }, { headers: { 'cache-control': 'public, max-age=300' } })
}
