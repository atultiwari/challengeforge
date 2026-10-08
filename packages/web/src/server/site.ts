import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { findSiteByHost, findSiteBySlug, normaliseHost, type Site } from '@challengeforge/db'
import { db } from './db'
import { env } from './env'

/**
 * Which site a request is for (Phase 4, R4), and the address it lives at.
 * Only hosts registered in `site_domains` select a site; any other host gets
 * the default site (SITE_SLUG) at APP_URL. URLs we build (mail links,
 * redirects, LMS and payment callbacks) always come from here, never from
 * the raw Host header, so a forged header cannot steer them.
 */
export interface SiteContext {
  site: Site
  /** e.g. "https://lab.example.org": no trailing slash. */
  baseUrl: string
  isDefault: boolean
}

const TTL_MS = 30_000
const cacheByHost = new Map<string, { ctx: SiteContext; at: number }>()

async function defaultContext(): Promise<SiteContext> {
  const config = env()
  const site = await findSiteBySlug(db(), config.SITE_SLUG)
  if (!site) throw new Error(`Site "${config.SITE_SLUG}" does not exist. Start the app with AUTO_MIGRATE, or run: challengeforge migrate`)
  return { site, baseUrl: config.APP_URL, isDefault: true }
}

/** The host a request was addressed to (behind a proxy, the forwarded one). */
export function requestHost(source: Headers): string | null {
  const forwarded = source.get('x-forwarded-host')?.split(',')[0]?.trim()
  return forwarded || source.get('host')
}

export async function siteContextForHost(rawHost: string | null): Promise<SiteContext> {
  const host = rawHost ? normaliseHost(rawHost) : null
  const key = host ?? ''
  const hit = cacheByHost.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ctx
  const scheme = new URL(env().APP_URL).protocol
  const site = host ? await findSiteByHost(db(), host) : null
  const ctx = site ? { site, baseUrl: `${scheme}//${host}`, isDefault: false } : await defaultContext()
  if (cacheByHost.size > 1000) cacheByHost.clear()
  cacheByHost.set(key, { ctx, at: Date.now() })
  return ctx
}

/** The current request's site, once per request. */
export const currentSiteContext = cache(async (): Promise<SiteContext> => siteContextForHost(requestHost(await headers())))

export const siteContextForRequest = (request: Request): Promise<SiteContext> => siteContextForHost(requestHost(request.headers))
