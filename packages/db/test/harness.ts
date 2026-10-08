/**
 * Each test file gets a throwaway database on the engine named by TEST_DB_URL
 * (a server URL without a database), migrated to the latest schema.
 * `pnpm test:db` runs the whole suite once against MySQL 8 and once against MariaDB.
 */
import { createConnection } from 'mysql2/promise'
import { createTypeRegistry } from '@challengeforge/engine'
import { builtInTypes } from '@challengeforge/types'
import { createDb, migrateToLatest, ensureSite, grantRoleUnchecked, type Db, type Role, type Scope } from '../src'
import { newId } from '../src/ids'

export const registry = createTypeRegistry(builtInTypes)

function serverUrl(): string {
  const url = process.env['TEST_DB_URL']
  if (!url) throw new Error('Set TEST_DB_URL, e.g. mysql://root:devroot@127.0.0.1:33061 (see docker-compose.dev.yml).')
  return url.replace(/\/$/, '')
}

export interface TestDb {
  db: Db
  engine: string
  close(): Promise<void>
}

export async function freshDb(): Promise<TestDb> {
  const base = serverUrl()
  const name = `cf_test_${newId().replace(/-/g, '').slice(0, 16)}`
  const admin = await createConnection(base)
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  const [rows] = await admin.query('SELECT VERSION() AS v')
  const engine = String((rows as { v: string }[])[0]?.v)
  const { db } = createDb({ url: `${base}/${name}`, connectionLimit: 10 })
  const report = await migrateToLatest(db)
  if (report.error) throw new Error(`Migration failed: ${report.error}`)
  return {
    db,
    engine,
    async close() {
      await db.destroy()
      await admin.query(`DROP DATABASE \`${name}\``)
      await admin.end()
    },
  }
}

/** Inserts a user the way Better Auth would, plus a site membership. */
export async function createUser(db: Db, siteId: string, role: Role, label: string = role): Promise<Scope> {
  const id = newId()
  const now = new Date()
  await db
    .insertInto('user')
    .values({ id, name: label, email: `${label}-${id.slice(0, 8)}@example.test`, emailVerified: true, image: null, createdAt: now, updatedAt: now })
    .execute()
  await grantRoleUnchecked(db, siteId, id, role)
  return { siteId, principal: { userId: id, role } }
}

export async function setupSite(db: Db, slug = 'main') {
  const site = await ensureSite(db, slug, `Site ${slug}`)
  return {
    site,
    admin: await createUser(db, site.id, 'admin'),
    author: await createUser(db, site.id, 'author'),
    otherAuthor: await createUser(db, site.id, 'author', 'author2'),
    learner: await createUser(db, site.id, 'learner'),
    otherLearner: await createUser(db, site.id, 'learner', 'learner2'),
    anonymous: { siteId: site.id, principal: null } as Scope,
  }
}
