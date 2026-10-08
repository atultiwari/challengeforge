import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canonicalJson, ensureSite, exportPack, importPack, saveDraftVersion, type LoadedPack, type Scope } from '../src'
import { createUser, freshDb, registry, setupSite, type TestDb } from './harness'
import { quizMission } from './fixtures'

const source: LoadedPack = {
  manifest: {
    format: 1,
    slug: 'round-trip',
    title: 'Round trip',
    description: 'Exported and imported again.',
    sections: [{ slug: 'one', title: 'One' }],
    challenges: [
      {
        slug: 'rt-quiz',
        section: 'one',
        type: 'lab-legacy@1',
        definition: 'challenges/q.json',
        assets: [{ path: 'artifacts/rt/data.json', file: 'assets/d.json', content_type: 'application/json', visibility: 'public' }],
      },
    ],
  },
  readJson: () => quizMission,
  readBytes: () => Buffer.from('{"rows":[1,2,3]}'),
}

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
let otherAdmin: Scope
beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
  const other = await ensureSite(t.db, 'second', 'Second site')
  otherAdmin = await createUser(t.db, other.id, 'admin', 'other-admin')
  await importPack(t.db, s.admin, registry, source, { publish: true })
})
afterAll(async () => t.close())

describe('exportPack', () => {
  it('writes the latest version of every challenge, with sections and assets', async () => {
    const id = (await t.db.selectFrom('challenges').select('id').where('slug', '=', 'rt-quiz').executeTakeFirstOrThrow()).id
    await saveDraftVersion(t.db, s.admin, registry, id, { ...quizMission, title: 'Edited after import' })
    const exported = await exportPack(t.db, s.admin, 'round-trip')
    expect(exported.manifest).toMatchObject({ format: 1, slug: 'round-trip', sections: [{ slug: 'one', title: 'One' }], challenges: [{ slug: 'rt-quiz', type: 'lab-legacy@1' }] })
    expect((exported.readJson('challenges/rt-quiz.json') as { title: string }).title).toBe('Edited after import')
    expect(exported.readBytes(exported.manifest.challenges[0]!.assets[0]!.file).toString()).toBe('{"rows":[1,2,3]}')
  })

  it('round-trips: importing the export into another site reproduces the same definitions', async () => {
    const exported = await exportPack(t.db, s.admin, 'round-trip')
    const report = await importPack(t.db, otherAdmin, registry, exported)
    expect(report.created).toEqual(['rt-quiz'])
    const rows = await t.db
      .selectFrom('challenge_versions')
      .innerJoin('challenges', 'challenges.id', 'challenge_versions.challenge_id')
      .select(['challenges.site_id as site', 'challenge_versions.definition as def', 'challenge_versions.version as v'])
      .where('challenges.slug', '=', 'rt-quiz')
      .orderBy('challenge_versions.version', 'desc')
      .execute()
    const latest = (site: string) => rows.find((r) => r.site === site)
    const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)
    expect(canonicalJson(parse(latest(otherAdmin.siteId)?.def))).toBe(canonicalJson(parse(latest(s.site.id)?.def)))
    // And re-importing the same export into the source site changes nothing.
    expect((await importPack(t.db, s.admin, registry, exported)).unchanged).toEqual(['rt-quiz'])
  })

  it('only admins export, and only their own site\'s packs', async () => {
    await expect(exportPack(t.db, s.author, 'round-trip')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(exportPack(t.db, otherAdmin, 'nope')).rejects.toMatchObject({ code: 'not_found' })
  })
})
