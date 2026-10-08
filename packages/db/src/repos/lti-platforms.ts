/**
 * LTI 1.3 platform registrations and the tool's signing keys (Phase 3, Q7).
 * An admin registers each LMS once: its issuer, our client id there, its
 * login, token and key URLs, and the deployment ids it may launch from.
 */
import type { Db } from '../client'
import { newId } from '../ids'
import { fromJson, toBool, toJson } from '../json'
import { NotFoundError, ValidationError, requireRole, type Scope } from '../scope'
import { recordAudit } from './audit'

export interface LtiPlatform {
  id: string
  name: string
  issuer: string
  clientId: string
  authLoginUrl: string
  authTokenUrl: string
  jwksUrl: string
  deploymentIds: string[]
  active: boolean
}

export type LtiPlatformInput = Omit<LtiPlatform, 'id' | 'active'>

const MAX_DEPLOYMENTS = 20

/** HTTPS only, except a development platform on localhost. */
function checkUrl(label: string, value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new ValidationError(`${label} is not a valid URL.`)
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new ValidationError(`${label} must use https.`)
  if (url.href.length > 500) throw new ValidationError(`${label} is too long.`)
  return url.href
}

type Row = { id: string; name: string; issuer: string; client_id: string; auth_login_url: string; auth_token_url: string; jwks_url: string; deployment_ids: unknown; active: number | boolean }

const toPlatform = (r: Row): LtiPlatform => ({
  id: r.id,
  name: r.name,
  issuer: r.issuer,
  clientId: r.client_id,
  authLoginUrl: r.auth_login_url,
  authTokenUrl: r.auth_token_url,
  jwksUrl: r.jwks_url,
  deploymentIds: fromJson<string[]>(r.deployment_ids),
  active: toBool(r.active),
})

const COLUMNS = ['id', 'name', 'issuer', 'client_id', 'auth_login_url', 'auth_token_url', 'jwks_url', 'deployment_ids', 'active'] as const

/** Registers a platform, or updates the one with the same issuer and client id. Admins only. */
export async function savePlatform(db: Db, scope: Scope, input: LtiPlatformInput): Promise<LtiPlatform> {
  requireRole(scope, 'admin')
  const name = input.name.trim()
  const issuer = input.issuer.trim()
  const clientId = input.clientId.trim()
  if (name === '' || name.length > 200) throw new ValidationError('Give the platform a name.')
  if (issuer === '' || issuer.length > 255) throw new ValidationError('Enter the platform issuer (iss).')
  if (clientId === '' || clientId.length > 255) throw new ValidationError('Enter the client id the platform gave this tool.')
  const deploymentIds = [...new Set(input.deploymentIds.map((d) => d.trim()).filter((d) => d !== ''))]
  if (deploymentIds.length === 0 || deploymentIds.length > MAX_DEPLOYMENTS || deploymentIds.some((d) => d.length > 255)) {
    throw new ValidationError(`Enter between 1 and ${MAX_DEPLOYMENTS} deployment ids.`)
  }
  const values = {
    name,
    issuer,
    client_id: clientId,
    auth_login_url: checkUrl('The login URL', input.authLoginUrl),
    auth_token_url: checkUrl('The token URL', input.authTokenUrl),
    jwks_url: checkUrl('The keyset URL', input.jwksUrl),
    deployment_ids: toJson(deploymentIds),
  }
  const id = await db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom('lti_platforms').select('id').where('site_id', '=', scope.siteId).where('issuer', '=', issuer).where('client_id', '=', clientId).executeTakeFirst()
    const platformId = existing?.id ?? newId()
    if (existing) await trx.updateTable('lti_platforms').set({ ...values, active: true }).where('id', '=', platformId).execute()
    else await trx.insertInto('lti_platforms').values({ id: platformId, site_id: scope.siteId, ...values, active: true, created_at: new Date() }).execute()
    await recordAudit(trx, scope, { action: 'lti.platform_saved', targetType: 'lti_platform', targetId: platformId, details: { issuer, clientId } })
    return platformId
  })
  return (await getPlatform(db, scope.siteId, id))!
}

/** Switching a platform off refuses its launches; its users and links stay. */
export async function setPlatformActive(db: Db, scope: Scope, platformId: string, active: boolean): Promise<void> {
  requireRole(scope, 'admin')
  await db.transaction().execute(async (trx) => {
    const result = await trx.updateTable('lti_platforms').set({ active }).where('id', '=', platformId).where('site_id', '=', scope.siteId).executeTakeFirst()
    if (Number(result.numUpdatedRows) === 0) throw new NotFoundError('Platform not found.')
    await recordAudit(trx, scope, { action: active ? 'lti.platform_saved' : 'lti.platform_removed', targetType: 'lti_platform', targetId: platformId, details: { active } })
  })
}

export async function listPlatforms(db: Db, scope: Scope): Promise<LtiPlatform[]> {
  requireRole(scope, 'admin')
  return (await db.selectFrom('lti_platforms').select(COLUMNS).where('site_id', '=', scope.siteId).orderBy('name').execute()).map(toPlatform)
}

/** @internal: launches look platforms up without a signed-in user. */
export async function getPlatform(db: Db, siteId: string, platformId: string): Promise<LtiPlatform | null> {
  const row = await db.selectFrom('lti_platforms').select(COLUMNS).where('id', '=', platformId).where('site_id', '=', siteId).executeTakeFirst()
  return row ? toPlatform(row) : null
}

/**
 * @internal: the ACTIVE platform for a login request. Without a client id
 * the issuer must identify exactly one registration.
 */
export async function findPlatformForLogin(db: Db, siteId: string, issuer: string, clientId: string | undefined): Promise<LtiPlatform | null> {
  let query = db.selectFrom('lti_platforms').select(COLUMNS).where('site_id', '=', siteId).where('issuer', '=', issuer).where('active', '=', true)
  if (clientId) query = query.where('client_id', '=', clientId)
  const rows = await query.limit(2).execute()
  return rows.length === 1 ? toPlatform(rows[0]!) : null
}

export interface StoredKey {
  kid: string
  publicJwk: Record<string, unknown>
  privateSealed: string
}

/** @internal: the newest active signing key. */
export async function activeToolKey(db: Db, siteId: string): Promise<StoredKey | null> {
  const row = await db
    .selectFrom('lti_keys')
    .select(['kid', 'public_jwk', 'private_jwk_sealed'])
    .where('site_id', '=', siteId)
    .where('active', '=', true)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()
  return row ? { kid: row.kid, publicJwk: fromJson(row.public_jwk), privateSealed: row.private_jwk_sealed } : null
}

/** @internal */
export async function storeToolKey(db: Db, siteId: string, key: StoredKey): Promise<void> {
  await db
    .insertInto('lti_keys')
    .values({ kid: key.kid, site_id: siteId, public_jwk: toJson(key.publicJwk), private_jwk_sealed: key.privateSealed, active: true, created_at: new Date() })
    .execute()
}

/** Public keys platforms use to check what this tool signs (deep links, token requests). */
export async function toolPublicJwks(db: Db, siteId: string): Promise<Record<string, unknown>[]> {
  const rows = await db.selectFrom('lti_keys').select('public_jwk').where('site_id', '=', siteId).where('active', '=', true).execute()
  return rows.map((r) => fromJson<Record<string, unknown>>(r.public_jwk))
}
