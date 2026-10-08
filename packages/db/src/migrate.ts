/**
 * Migrations are bundled as code (not read from a folder at runtime), so the
 * deployed standalone build needs no migration files on disk.
 */
import { Migrator, type Migration, type MigrationResultSet } from 'kysely/migration'
import type { Db } from './client'
import * as m0001 from './migrations/0001_init'
import * as m0002 from './migrations/0002_llm'
import * as m0003 from './migrations/0003_jobs'
import * as m0004 from './migrations/0004_job_leases'
import * as m0005 from './migrations/0005_audit'
import * as m0006 from './migrations/0006_editors'
import * as m0007 from './migrations/0007_cohorts'
import * as m0008 from './migrations/0008_access_payments'
import * as m0009 from './migrations/0009_certificates'
import * as m0010 from './migrations/0010_lti'

const MIGRATIONS: Record<string, Migration> = {
  '0001_init': m0001,
  '0002_llm': m0002,
  '0003_jobs': m0003,
  '0004_job_leases': m0004,
  '0005_audit': m0005,
  '0006_editors': m0006,
  '0007_cohorts': m0007,
  '0008_access_payments': m0008,
  '0009_certificates': m0009,
  '0010_lti': m0010,
}

function migratorFor(db: Db): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: async () => MIGRATIONS },
    migrationTableName: 'cf_migrations',
    migrationLockTableName: 'cf_migrations_lock',
  })
}

export interface MigrationReport {
  applied: string[]
  error: string | null
}

function report(set: MigrationResultSet): MigrationReport {
  return {
    applied: (set.results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName),
    error: set.error === undefined ? null : set.error instanceof Error ? set.error.message : String(set.error),
  }
}

export async function migrateToLatest(db: Db): Promise<MigrationReport> {
  return report(await migratorFor(db).migrateToLatest())
}

export async function migrateDownAll(db: Db): Promise<MigrationReport> {
  const migrator = migratorFor(db)
  let last: MigrationReport = { applied: [], error: null }
  for (let i = 0; i < Object.keys(MIGRATIONS).length; i += 1) {
    last = report(await migrator.migrateDown())
    if (last.error) break
  }
  return last
}
