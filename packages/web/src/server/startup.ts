import { createDb, ensureSite, migrateToLatest, needsSetup } from '@challengeforge/db'

/**
 * Migrates and ensures the site exists, on its own short-lived connection.
 * A failure is logged loudly but does not stop the server: an app that keeps
 * restarting is harder to diagnose on shared hosting than one that shows an
 * error page and a clear log line.
 */
export async function prepareDatabase(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) return
  const { db } = createDb({ url, connectionLimit: 1 })
  try {
    const report = await migrateToLatest(db)
    if (report.error) {
      console.error(`[startup] database migration failed: ${report.error}`)
      return
    }
    if (report.applied.length > 0) console.info(`[startup] applied migrations: ${report.applied.join(', ')}`)
    const site = await ensureSite(db, process.env['SITE_SLUG'] ?? 'main', process.env['SITE_NAME'] ?? 'ChallengeForge')
    if (process.env['SETUP_TOKEN'] && !(await needsSetup(db, site.id))) {
      console.warn('[startup] SETUP_TOKEN is still set, but the site already has an admin. Remove it from the environment.')
    }
  } catch (err) {
    console.error('[startup] could not prepare the database', err)
  } finally {
    await db.destroy()
  }
}
