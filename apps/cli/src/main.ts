#!/usr/bin/env node
/**
 * ChallengeForge operator CLI. Every command reads DATABASE_URL and SITE_SLUG
 * from the environment.
 *
 *   challengeforge migrate                 create/upgrade the schema and the site
 *   challengeforge import-pack <dir>       import a pack (add --publish to publish it)
 */
import { Command } from 'commander'
import { createDb, ensureSite, importPack, migrateToLatest, ValidationError, type Scope } from '@challengeforge/db'
import { registry } from '@challengeforge/types'
import { loadConfig } from './config'
import { loadPackFromDirectory } from './pack-loader'

/** The CLI acts as the system operator, with admin rights on the configured site. */
const systemScope = (siteId: string): Scope => ({ siteId, principal: { userId: 'system:cli', role: 'admin' } })

async function withDb<T>(work: (db: ReturnType<typeof createDb>['db'], config: ReturnType<typeof loadConfig>) => Promise<T>): Promise<T> {
  const config = loadConfig()
  const { db } = createDb({ url: config.databaseUrl, connectionLimit: 2 })
  try {
    return await work(db, config)
  } finally {
    await db.destroy()
  }
}

const program = new Command().name('challengeforge').description('ChallengeForge operator commands')

program
  .command('migrate')
  .description('Apply database migrations and make sure the site exists')
  .action(() =>
    withDb(async (db, config) => {
      const report = await migrateToLatest(db)
      if (report.error) throw new Error(`Migration failed: ${report.error}`)
      const site = await ensureSite(db, config.siteSlug, config.siteName)
      process.stdout.write(`Migrations applied: ${report.applied.join(', ') || 'none (already up to date)'}\nSite: ${site.slug}\n`)
    }),
  )

program
  .command('import-pack')
  .argument('<dir>', 'pack directory containing pack.json')
  .option('--publish', 'publish every challenge after importing')
  .description('Import (or re-import) a content pack')
  .action((dir: string, options: { publish?: boolean }) =>
    withDb(async (db, config) => {
      const site = await ensureSite(db, config.siteSlug, config.siteName)
      const report = await importPack(db, systemScope(site.id), registry, loadPackFromDirectory(dir), { publish: options.publish === true })
      process.stdout.write(
        `Imported pack: created ${report.created.length}, updated ${report.updated.length}, unchanged ${report.unchanged.length}, published ${report.published.length}\n`,
      )
    }),
  )

program.parseAsync().catch((err: unknown) => {
  if (err instanceof ValidationError) {
    process.stderr.write(`${err.message}\n${err.issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}\n`)
  } else {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  }
  process.exitCode = 1
})
