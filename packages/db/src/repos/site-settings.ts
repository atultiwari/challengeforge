/**
 * Per-site settings (Phase 4, R1). Stored as one validated JSON document per
 * site; anything missing falls back to the defaults (seeded from the
 * environment), so an old row never breaks a newer version of the app.
 * Theme colours are validated for contrast by the web app before saving.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Db } from '../client'
import { fromJson, toJson } from '../json'
import { NotFoundError, ValidationError, requireRole, type Scope } from '../scope'
import { recordAudit } from './audit'

export const SiteSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  tagline: z.string().trim().max(200).default(''),
  footer: z.string().trim().max(500).default(''),
  theme: z.object({ preset: z.string().max(32).default('case-file'), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).default({ preset: 'case-file' }),
  signupsOpen: z.boolean().default(true),
  currency: z.string().regex(/^[A-Z]{3}$/).default('INR'),
  hasLogo: z.boolean().default(false),
})
export type SiteSettings = z.infer<typeof SiteSettingsSchema>

/** Reads a site's settings, falling back field by field to `defaults`. */
export async function getSiteSettings(db: Db, siteId: string, defaults: Pick<SiteSettings, 'name'> & Partial<SiteSettings>): Promise<SiteSettings> {
  const row = await db.selectFrom('site_settings').select('settings').where('site_id', '=', siteId).executeTakeFirst()
  const stored = row ? fromJson<Record<string, unknown>>(row.settings) : {}
  const merged = SiteSettingsSchema.safeParse({ ...defaults, ...stored })
  // A corrupt or outdated row must never take the site down: fall back to the defaults.
  return merged.success ? merged.data : SiteSettingsSchema.parse(defaults)
}

/** Saves the settings an admin edited (merged over what is stored). */
export async function saveSiteSettings(db: Db, scope: Scope, current: SiteSettings, changes: Partial<SiteSettings>): Promise<SiteSettings> {
  requireRole(scope, 'admin')
  const parsed = SiteSettingsSchema.safeParse({ ...current, ...changes })
  if (!parsed.success) throw new ValidationError(`Check the settings: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}.`)
  const now = new Date()
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('site_settings')
      .values({ site_id: scope.siteId, settings: toJson(parsed.data), updated_at: now })
      .onDuplicateKeyUpdate({ settings: toJson(parsed.data), updated_at: now })
      .execute()
    // Keep the site row's name in step: it names the site in auth emails and the network list.
    await trx.updateTable('sites').set({ name: parsed.data.name }).where('id', '=', scope.siteId).execute()
    await recordAudit(trx, scope, { action: 'site.settings_saved', targetType: 'site', targetId: scope.siteId, details: { changed: Object.keys(changes) } })
  })
  return parsed.data
}

export const SITE_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const MAX_SITE_FILE_BYTES = 512 * 1024

export interface SiteFile {
  contentType: string
  bytes: Buffer
  sha256: string
  updatedAt: Date
}

/** Stores a site-wide image (e.g. the logo). PNG, JPEG or WebP only: no SVG (it can carry script). */
export async function putSiteFile(db: Db, scope: Scope, name: 'logo', contentType: string, bytes: Buffer): Promise<void> {
  requireRole(scope, 'admin')
  if (!(SITE_FILE_TYPES as readonly string[]).includes(contentType)) throw new ValidationError('Use a PNG, JPEG or WebP image.')
  if (bytes.length === 0 || bytes.length > MAX_SITE_FILE_BYTES) throw new ValidationError('The image must be under 512 KB.')
  const now = new Date()
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await db
    .insertInto('site_files')
    .values({ site_id: scope.siteId, name, content_type: contentType, bytes, sha256, updated_at: now })
    .onDuplicateKeyUpdate({ content_type: contentType, bytes, sha256, updated_at: now })
    .execute()
}

export async function getSiteFile(db: Db, siteId: string, name: string): Promise<SiteFile> {
  const row = await db.selectFrom('site_files').select(['content_type', 'bytes', 'sha256', 'updated_at']).where('site_id', '=', siteId).where('name', '=', name).executeTakeFirst()
  if (!row) throw new NotFoundError('No such file.')
  return { contentType: row.content_type, bytes: row.bytes, sha256: row.sha256, updatedAt: row.updated_at }
}

export async function deleteSiteFile(db: Db, scope: Scope, name: string): Promise<void> {
  requireRole(scope, 'admin')
  await db.deleteFrom('site_files').where('site_id', '=', scope.siteId).where('name', '=', name).execute()
}

/** The name a site shows (its settings, else the name it was created with). */
export async function siteDisplayName(db: Db, siteId: string): Promise<string> {
  const site = await db.selectFrom('sites').select('name').where('id', '=', siteId).executeTakeFirst()
  return (await getSiteSettings(db, siteId, { name: site?.name ?? 'ChallengeForge' })).name
}
