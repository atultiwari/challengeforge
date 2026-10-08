import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { getSiteSettings, type SiteSettings } from '@challengeforge/db'
import { db } from './db'
import { env } from './env'
import { currentSite } from './scope'

/** This site's settings, once per request. The environment only provides the defaults. */
export const currentSettings = cache(async (): Promise<SiteSettings> => {
  const site = await currentSite()
  return getSiteSettings(db(), site.id, { name: env().SITE_NAME })
})

/** The CSP nonce the proxy issued for this request, for our own <style> tag. */
export const cspNonce = cache(async (): Promise<string | undefined> => {
  const csp = (await headers()).get('content-security-policy') ?? ''
  return /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1]
})
