#!/usr/bin/env node
/**
 * ChallengeForge operator CLI. Every command reads DATABASE_URL and SITE_SLUG
 * from the environment.
 *
 *   challengeforge migrate                 create/upgrade the schema and the site
 *   challengeforge import-pack <dir>       import a pack (add --publish to publish it)
 *   challengeforge publish-pack <slug>     publish every challenge in an imported pack
 *   challengeforge create-admin            create (or promote) the site's administrator
 *   challengeforge setup-token             print a one-hour token for the /setup wizard (fresh sites only)
 *   challengeforge reset-password          set a new password (from NEW_PASSWORD) and sign the person out
 *   challengeforge run-jobs                advance background jobs (run from cron every few minutes)
 *   challengeforge export-pack <slug> <dir> write a pack (latest versions + assets) to a directory
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import { advanceJob, closeStaleReservations, createDb, createSetupToken, needsSetup, purgeExpiredLti, exportFiles, exportPack, ensureSite, grantRoleUnchecked, importPack, listRunnableJobIds, migrateToLatest, publish, ValidationError, type Scope } from '@challengeforge/db'
import { createMailer, createServiceRunners, mailConfigFromEnv, sendDueLtiScores, sendDueNotifications, servicesConfigFromEnv } from '@challengeforge/services'
import { registry } from '@challengeforge/types'
import { loadConfig } from './config'
import { loadPackFromDirectory } from './pack-loader'
import { createUserWithPassword, resetPassword } from './users'

/** The nearest enclosing git work tree, if any. */
function gitWorkTreeOf(start: string): string | null {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) return dir
    if (path.dirname(dir) === dir) return null
  }
}

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
        .where('challenges.status', '!=', 'archived')
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

program
  .command('setup-token')
  .description('Print a one-hour token for the browser setup wizard at /setup (only while the site has no admin)')
  .action(() =>
    withDb(async (db, config) => {
      const site = await ensureSite(db, config.siteSlug, config.siteName)
      if (!(await needsSetup(db, site.id))) {
        process.stdout.write('This site already has an admin; the setup wizard is closed.\n')
        return
      }
      process.stdout.write(`Setup token (valid for one hour): ${await createSetupToken(db, site.id)}\nOpen /setup on your site and paste it there.\n`)
    }),
  )

program
  .command('reset-password')
  .requiredOption('--email <email>', 'the account to reset')
  .description('Set a new password (read from NEW_PASSWORD) and end all of that person\'s sessions')
  .action((options: { email: string }) =>
    withDb(async (db) => {
      await resetPassword(db, options.email, process.env['NEW_PASSWORD'])
      process.stdout.write(`Password reset for ${options.email}; existing sessions ended.\n`)
    }),
  )

program
  .command('run-jobs')
  .option('--max-seconds <n>', 'stop starting new slices after this long', '240')
  .description('Advance queued background jobs (e.g. evaluation runs) slice by slice; run from cron')
  .action((options: { maxSeconds: string }) =>
    withDb(async (db) => {
      const deadline = Date.now() + Math.max(10, Number(options.maxSeconds) || 240) * 1000
      const deps = { registry, ...createServiceRunners(db, servicesConfigFromEnv(process.env)), onError: (e: unknown) => process.stderr.write(`${String(e)}\n`) }
      let slices = 0
      for (let ids = await listRunnableJobIds(db, 50); ids.length > 0 && Date.now() < deadline; ids = await listRunnableJobIds(db, 50)) {
        for (const id of ids) {
          if (Date.now() >= deadline) break
          await advanceJob(db, deps, id)
          slices += 1
        }
      }
      const closed = await closeStaleReservations(db)
      const purged = await purgeExpiredLti(db)
      const secret = process.env['BETTER_AUTH_SECRET']
      const scores = secret ? await sendDueLtiScores(db, secret) : { sent: 0, failed: 0 }
      const appUrl = process.env['APP_URL']?.replace(/\/$/, '')
      const mail = appUrl ? await sendDueNotifications(db, createMailer(mailConfigFromEnv(process.env)), appUrl) : { sent: 0, skipped: 0, failed: 0 }
      process.stdout.write(
        `Advanced ${slices} job slices; closed ${closed} stale AI call reservations; ` +
          `sent ${scores.sent} LMS scores (${scores.failed} to retry); sent ${mail.sent} notification emails ` +
          `(${mail.skipped} skipped, ${mail.failed} to retry); removed ${purged} expired LMS launch records.\n`,
      )
    }),
  )

program
  .command('export-pack')
  .argument('<slug>', 'pack slug, e.g. clinical-ai')
  .argument('<dir>', 'an empty or new directory to write the pack to')
  .option('--allow-in-repo', 'write inside a git work tree anyway (the export contains answer keys)')
  .description('Export a pack (published version of each challenge, sections, assets) for import elsewhere')
  .action((slug: string, dir: string, options: { allowInRepo?: boolean }) =>
    withDb(async (db, config) => {
      // An export holds answer keys and hidden prompts: never drop one into a (possibly public) repo by accident.
      const repo = gitWorkTreeOf(path.resolve(dir))
      if (repo && !path.resolve(dir).startsWith(path.join(repo, 'packs') + path.sep) && !options.allowInRepo) {
        throw new Error(`${dir} is inside the git work tree ${repo}. Exports contain answer keys: write outside it, under ${path.join(repo, 'packs')}, or pass --allow-in-repo.`)
      }
      const site = await ensureSite(db, config.siteSlug, config.siteName)
      const files = exportFiles(await exportPack(db, systemScope(site.id), slug))
      const root = path.resolve(dir)
      if (existsSync(root) && readdirSync(root).length > 0) throw new Error(`${dir} is not empty; choose a new directory.`)
      for (const file of files) {
        const target = path.join(root, file.path)
        mkdirSync(path.dirname(target), { recursive: true })
        writeFileSync(target, file.contents)
      }
      process.stdout.write(`Exported ${files.length} files to ${root}\n`)
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
