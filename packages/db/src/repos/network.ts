/**
 * Multi-site (Phase 4, R4). One install serves several sites; each request
 * finds its site by Host. Only REGISTERED hosts select a site, so a forged
 * Host header can never steer links (password resets, redirects) anywhere:
 * an unknown host simply gets the default site at its configured URL.
 *
 * Network admins (an install-level role, granted from the CLI) create sites,
 * attach domains and name each new site's first admin.
 */
import type { Db } from '../client'
import { newId } from '../ids'
import { ForbiddenError, NotFoundError, ValidationError, requireSignedIn, type Scope } from '../scope'
import { recordAudit } from './audit'
import type { Site } from './sites'

/** "Host" header value as stored: lowercase, with a port only if not the default. */
export function normaliseHost(host: string): string | null {
  const h = host.trim().toLowerCase().replace(/\.$/, '')
  if (!/^[a-z0-9.-]{1,253}(:\d{1,5})?$/.test(h) && !/^\[[0-9a-f:]+\](:\d{1,5})?$/.test(h)) return null
  return h.replace(/:(80|443)$/, '')
}

export async function findSiteByHost(db: Db, host: string): Promise<Site | null> {
  const normalised = normaliseHost(host)
  if (!normalised) return null
  const row = await db
    .selectFrom('site_domains')
    .innerJoin('sites', 'sites.id', 'site_domains.site_id')
    .select(['sites.id as id', 'sites.slug as slug', 'sites.name as name'])
    .where('site_domains.host', '=', normalised)
    .executeTakeFirst()
  return row ?? null
}

/** The first registered host of a site (its canonical address), or null for the default site. */
export async function primaryHostOf(db: Db, siteId: string): Promise<string | null> {
  const row = await db.selectFrom('site_domains').select('host').where('site_id', '=', siteId).orderBy('created_at').executeTakeFirst()
  return row?.host ?? null
}

export async function isNetworkAdmin(db: Db, userId: string): Promise<boolean> {
  return (await db.selectFrom('network_admins').select('user_id').where('user_id', '=', userId).executeTakeFirst()) !== undefined
}

/** Bootstrap only (CLI `grant-network-admin`). */
export async function grantNetworkAdminUnchecked(db: Db, userId: string): Promise<void> {
  await db.insertInto('network_admins').values({ user_id: userId, created_at: new Date() }).ignore().execute()
}

async function requireNetworkAdmin(db: Db, scope: Scope): Promise<string> {
  const p = requireSignedIn(scope)
  if (!(await isNetworkAdmin(db, p.userId))) throw new ForbiddenError()
  return p.userId
}

export interface NetworkSite extends Site {
  hosts: string[]
  admins: number
}

export async function listSites(db: Db, scope: Scope): Promise<NetworkSite[]> {
  await requireNetworkAdmin(db, scope)
  const [sites, domains, admins] = await Promise.all([
    db.selectFrom('sites').select(['id', 'slug', 'name']).orderBy('name').execute(),
    db.selectFrom('site_domains').select(['site_id', 'host']).orderBy('created_at').execute(),
    db.selectFrom('memberships').select(['site_id']).where('role', '=', 'admin').execute(),
  ])
  return sites.map((s) => ({
    ...s,
    hosts: domains.filter((d) => d.site_id === s.id).map((d) => d.host),
    admins: admins.filter((a) => a.site_id === s.id).length,
  }))
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/

async function addHost(trx: Db, siteId: string, host: string): Promise<string> {
  const normalised = normaliseHost(host)
  if (!normalised) throw new ValidationError('Enter a host name such as lab.example.org.')
  const taken = await trx.selectFrom('site_domains').select('site_id').where('host', '=', normalised).executeTakeFirst()
  if (taken) throw new ValidationError('That host already serves a site.')
  await trx.insertInto('site_domains').values({ host: normalised, site_id: siteId, created_at: new Date() }).execute()
  return normalised
}

/** Creates a site served at `host`, with `adminEmail`'s account (or the creator) as its first admin. */
export async function createSite(db: Db, scope: Scope, input: { slug: string; name: string; host: string; adminEmail?: string }): Promise<Site> {
  const creator = await requireNetworkAdmin(db, scope)
  const slug = input.slug.trim().toLowerCase()
  const name = input.name.trim()
  if (!SLUG.test(slug)) throw new ValidationError('The short name must be 2–63 lowercase letters, digits or hyphens.')
  if (name === '' || name.length > 200) throw new ValidationError('Give the site a name.')
  let adminId = creator
  if (input.adminEmail?.trim()) {
    const person = await db.selectFrom('user').select('id').where('email', '=', input.adminEmail.trim().toLowerCase()).executeTakeFirst()
    if (!person) throw new ValidationError('No account has that email. Ask them to sign up on any site first.')
    adminId = person.id
  }
  const site: Site = { id: newId(), slug, name }
  await db.transaction().execute(async (trx) => {
    if (await trx.selectFrom('sites').select('id').where('slug', '=', slug).executeTakeFirst()) throw new ValidationError('That short name is already used.')
    await trx.insertInto('sites').values({ ...site, created_at: new Date() }).execute()
    const host = await addHost(trx, site.id, input.host)
    await trx.insertInto('memberships').values({ site_id: site.id, user_id: adminId, role: 'admin', created_at: new Date() }).execute()
    await recordAudit(trx, { siteId: site.id, principal: scope.principal }, { action: 'site.created', targetType: 'site', targetId: site.id, details: { slug, host, adminId } })
  })
  return site
}

export async function addSiteDomain(db: Db, scope: Scope, siteId: string, host: string): Promise<string> {
  await requireNetworkAdmin(db, scope)
  return db.transaction().execute(async (trx) => {
    if (!(await trx.selectFrom('sites').select('id').where('id', '=', siteId).executeTakeFirst())) throw new NotFoundError('Site not found.')
    const added = await addHost(trx, siteId, host)
    await recordAudit(trx, { siteId, principal: scope.principal }, { action: 'site.domain_added', targetType: 'site', targetId: siteId, details: { host: added } })
    return added
  })
}

/**
 * A site's public address for links sent by mail from cron: its first
 * registered host (with the default URL's scheme), or the default URL for
 * the install's default site.
 */
export async function siteBaseUrl(db: Db, siteId: string, defaultUrl: string): Promise<string> {
  const host = await primaryHostOf(db, siteId)
  return host ? `${new URL(defaultUrl).protocol}//${host}` : defaultUrl.replace(/\/$/, '')
}
