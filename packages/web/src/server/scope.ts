import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { findSiteBySlug, principalFor, type Scope } from '@challengeforge/db'
import { auth } from './auth'
import { db } from './db'
import { env } from './env'

export interface CurrentUser {
  id: string
  name: string
  email: string
}

/** The site this deployment serves (one per install in Phase 1; site_id is already everywhere). */
export const currentSite = cache(async () => {
  const site = await findSiteBySlug(db(), env().SITE_SLUG)
  if (!site) throw new Error(`Site "${env().SITE_SLUG}" does not exist. Run: challengeforge migrate`)
  return site
})

/** Who is asking, resolved once per request: their session plus their role on this site. */
export const currentScope = cache(async (): Promise<{ scope: Scope; user: CurrentUser | null }> => {
  const site = await currentSite()
  const session = await auth().api.getSession({ headers: await headers() })
  if (!session) return { scope: { siteId: site.id, principal: null }, user: null }
  const principal = await principalFor(db(), site.id, session.user.id)
  return {
    scope: { siteId: site.id, principal },
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
  }
})
