#!/usr/bin/env node
/**
 * ChallengeForge operator CLI. Every command reads DATABASE_URL and SITE_SLUG
 * from the environment.
 *
 *   challengeforge migrate                 create/upgrade the schema and the site
 *   challengeforge import-pack <dir>       import a pack (add --publish to publish it)
 *   challengeforge publish-pack <slug>     publish every challenge in an imported pack
 *   challengeforge create-admin            create (or promote) the site's administrator
 */
import { Command } from 'commander'
import { createDb, ensureSite, grantRoleUnchecked, importPack, migrateToLatest, publish, ValidationError, type Scope } from '@challengeforge/db'
import { registry } from '@challengeforge/types'
import { loadConfig } from './config'
import { loadPackFromDirectory } from './pack-loader'
import { createUserWithPassword } from './users'

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

program
  .command('publish-pack')
  .argument('<slug>', 'pack slug, e.g. clinical-ai')
  .description('Publish the latest version of every challenge in a pack')
  .action((slug: string) =>
    withDb(async (db, config) => {
      const site = await ensureSite(db, config.siteSlug, config.siteName)
      const challenges = await db
        .selectFrom('challenges')
        .innerJoin('packs', 'packs.id', 'challenges.pack_id')
        .select(['challenges.id as id', 'challenges.slug as slug'])
        .where('packs.slug', '=', slug)
        .where('challenges.site_id', '=', site.id)
        .execute()
      if (challenges.length === 0) throw new Error(`No challenges found in pack "${slug}".`)
      for (const c of challenges) await publish(db, systemScope(site.id), c.id)
      process.stdout.write(`Published ${challenges.length} challenges from ${slug}.\n`)
    }),
  )

program
  .command('create-admin')
  .requiredOption('--email <email>', 'administrator email')
  .requiredOption('--name <name>', 'display name')
  .description('Create the administrator account (password read from ADMIN_PASSWORD), or promote an existing user')
  .action((options: { email: string; name: string }) =>
    withDb(async (db, config) => {
      const site = await ensureSite(db, config.siteSlug, config.siteName)
      const existing = await db.selectFrom('user').select('id').where('email', '=', options.email.toLowerCase()).executeTakeFirst()
      const userId = existing?.id ?? (await createUserWithPassword(db, options.email, options.name, process.env['ADMIN_PASSWORD']))
      await grantRoleUnchecked(db, site.id, userId, 'admin')
      process.stdout.write(`${existing ? 'Promoted' : 'Created'} ${options.email} as admin of ${site.slug}.\n`)
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
