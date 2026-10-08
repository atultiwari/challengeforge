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
/** Registered hosts (few). Unknown hosts are cached apart, so random Host headers cannot evict real sites. */
const known = new Map<string, { ctx: SiteContext; at: number }>()
const unknown = new Map<string, number>()
const MAX_UNKNOWN = 500

/** Forget cached site lookups (after a site, domain or name changes). */
export function clearSiteCache(): void {
  known.clear()
  unknown.clear()
}

async function defaultContext(): Promise<SiteContext> {
  const config = env()
  const site = await findSiteBySlug(db(), config.SITE_SLUG)
  if (!site) throw new Error(`Site "${config.SITE_SLUG}" does not exist. Start the app with AUTO_MIGRATE, or run: challengeforge migrate`)
  return { site, baseUrl: config.APP_URL, isDefault: true }
}

/**
 * The host a request was addressed to. X-Forwarded-Host is used only when
 * TRUST_FORWARDED_HOST=true (a proxy that rewrites Host); otherwise a client
 * could set it to make a cache store one site's answer under another's address.
 */
export function requestHost(source: Headers): string | null {
  if (process.env['TRUST_FORWARDED_HOST'] === 'true') {
    const forwarded = source.get('x-forwarded-host')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  return source.get('host')
}

export async function siteContextForHost(rawHost: string | null): Promise<SiteContext> {
  const host = rawHost ? normaliseHost(rawHost) : null
  const now = Date.now()
  const hit = host ? known.get(host) : undefined
  if (hit && now - hit.at < TTL_MS) return hit.ctx
  const seenUnknown = host ? unknown.get(host) : undefined
  if (host && (seenUnknown === undefined || now - seenUnknown >= TTL_MS)) {
    const site = await findSiteByHost(db(), host)
    if (site) {
      const ctx = { site, baseUrl: `${new URL(env().APP_URL).protocol}//${host}`, isDefault: false }
      known.set(host, { ctx, at: now })
      unknown.delete(host)
      return ctx
    }
    if (unknown.size >= MAX_UNKNOWN) unknown.clear()
    unknown.set(host, now)
  }
  const fallback = known.get('')
  if (fallback && now - fallback.at < TTL_MS) return fallback.ctx
  const ctx = await defaultContext()
  known.set('', { ctx, at: now })
  return ctx
}

/** The current request's site, once per request. */
export const currentSiteContext = cache(async (): Promise<SiteContext> => siteContextForHost(requestHost(await headers())))

export const siteContextForRequest = (request: Request): Promise<SiteContext> => siteContextForHost(requestHost(request.headers))
