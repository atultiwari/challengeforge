/**
 * Migrations are bundled as code (not read from a folder at runtime), so the
 * deployed standalone build needs no migration files on disk.
 */
import { Migrator, type Migration, type MigrationResultSet } from 'kysely/migration'
import type { Db } from './client'
import * as m0001 from './migrations/0001_init'

const MIGRATIONS: Record<string, Migration> = {
  '0001_init': m0001,
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
