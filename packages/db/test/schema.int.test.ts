import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { migrateDownAll, migrateToLatest } from '../src'
import { freshDb, type TestDb } from './harness'

let t: TestDb
beforeAll(async () => {
  t = await freshDb()
})
afterAll(async () => t.close())

describe(`schema on ${process.env['TEST_DB_URL'] ?? '?'}`, () => {
  it('creates every table', async () => {
    const tables = (await t.db.introspection.getTables()).map((x) => x.name).sort()
    expect(tables).toEqual(
      expect.arrayContaining([
        'account', 'assessments', 'assets', 'attempt_events', 'attempts', 'challenge_versions', 'challenges',
        'memberships', 'pack_sections', 'packs', 'progress', 'session', 'sites', 'user', 'verification',
      ]),
    )
  })

  it('round-trips JSON identically on both engines', async () => {
    await sql`CREATE TEMPORARY TABLE json_probe (v JSON NOT NULL)`.execute(t.db)
    const value = { a: [1, 'two', { three: true }], unicode: 'Ménière’s – 37 °C' }
    await sql`INSERT INTO json_probe (v) VALUES (${JSON.stringify(value)})`.execute(t.db)
    const { rows } = await sql<{ v: unknown }>`SELECT v FROM json_probe`.execute(t.db)
    const { fromJson } = await import('../src/json')
    expect(fromJson(rows[0]?.v)).toEqual(value)
  })

  it('migrates down cleanly and back up again', async () => {
    expect((await migrateDownAll(t.db)).error).toBeNull()
    const report = await migrateToLatest(t.db)
    expect(report).toEqual({ applied: ['0001_init', '0002_llm', '0003_jobs', '0004_job_leases', '0005_audit', '0006_editors', '0007_cohorts', '0008_access_payments', '0009_certificates', '0010_lti'], error: null })
  })
})
