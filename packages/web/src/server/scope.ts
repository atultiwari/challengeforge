import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { principalFor, type Scope } from '@challengeforge/db'
import { siteAuth } from './auth'
import { db } from './db'
import { currentSiteContext } from './site'

export interface CurrentUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
}

/** The site this request is for (by host; see server/site.ts). */
export const currentSite = cache(async () => (await currentSiteContext()).site)

/** Who is asking, resolved once per request: their session plus their role on this site. */
export const currentScope = cache(async (): Promise<{ scope: Scope; user: CurrentUser | null }> => {
  const site = await currentSite()
  const session = await (await siteAuth()).api.getSession({ headers: await headers() })
  if (!session) return { scope: { siteId: site.id, principal: null }, user: null }
  const principal = await principalFor(db(), site.id, session.user.id)
  return {
    scope: { siteId: site.id, principal },
    user: { id: session.user.id, name: session.user.name, email: session.user.email, emailVerified: Boolean(session.user.emailVerified) },
  }
})
