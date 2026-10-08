import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { archive, getAssetForPlay, importPack, listPlayable, listForAuthoring, type LoadedPack } from '../src'
import { freshDb, registry, setupSite, type TestDb } from './harness'
import { quizMission } from './fixtures'

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
})
afterAll(async () => t.close())

function pack(files: Record<string, unknown>, manifestOverrides: Record<string, unknown> = {}): LoadedPack {
  return {
    manifest: {
      format: 1,
      slug: 'synthetic-pack',
      title: 'Synthetic pack',
      sections: [{ slug: 'level-1', title: 'Level 1' }],
      challenges: [
        {
          slug: 'mission-one',
          section: 'level-1',
          type: 'lab-legacy@1',
          definition: 'challenges/one.json',
          assets: [{ path: 'artifacts/one/data.json', file: 'assets/one.json', content_type: 'application/json' }],
        },
      ],
      ...manifestOverrides,
    } as LoadedPack['manifest'],
    readJson: (p) => {
      if (!(p in files)) throw new Error(`missing ${p}`)
      return files[p]
    },
    readBytes: (p) => Buffer.from(JSON.stringify(files[p] ?? {})),
  }
}

describe('importPack', () => {
  it('creates sections, challenges and assets, and can publish them', async () => {
    const report = await importPack(t.db, s.admin, registry, pack({ 'challenges/one.json': quizMission, 'assets/one.json': { rows: [1] } }), { publish: true })
    expect(report).toMatchObject({ created: ['mission-one'], published: ['mission-one'] })
    const playable = await listPlayable(t.db, s.learner)
    expect(playable).toEqual([expect.objectContaining({ slug: 'mission-one', sectionTitle: 'Level 1', packTitle: 'Synthetic pack' })])
    const asset = await getAssetForPlay(t.db, s.learner, playable[0]!.id, 'artifacts/one/data.json')
    expect(JSON.parse(asset.bytes.toString())).toEqual({ rows: [1] })
  })

  it('is idempotent: re-importing an unchanged pack creates no new versions', async () => {
    const report = await importPack(t.db, s.admin, registry, pack({ 'challenges/one.json': quizMission, 'assets/one.json': { rows: [1] } }))
    expect(report).toMatchObject({ created: [], updated: [], unchanged: ['mission-one'] })
  })

  it('turns a changed definition into a new draft version, keeping the published one live', async () => {
    const report = await importPack(t.db, s.admin, registry, pack({ 'challenges/one.json': { ...quizMission, title: 'Revised' }, 'assets/one.json': {} }))
    expect(report.updated).toEqual(['mission-one'])
    expect((await listForAuthoring(t.db, s.admin)).find((c) => c.slug === 'mission-one')?.status).toBe('draft')
    expect((await listPlayable(t.db, s.learner)).map((c) => c.slug)).toEqual(['mission-one'])
  })

  it('refuses invalid packs before writing anything', async () => {
    await expect(importPack(t.db, s.admin, registry, pack({}, { format: 2 }))).rejects.toThrow()
    await expect(importPack(t.db, s.admin, registry, pack({ 'challenges/one.json': { title: 'no rule' } }))).rejects.toMatchObject({ code: 'invalid' })
  })

  it('refuses to let one pack take over another pack\'s challenge', async () => {
    const intruder = pack({ 'challenges/one.json': quizMission, 'assets/one.json': {} }, { slug: 'other-pack' })
    await expect(importPack(t.db, s.admin, registry, intruder)).rejects.toThrow(/belongs to another pack/)
  })

  it('checks every asset before writing anything', async () => {
    const missing: LoadedPack = { ...pack({ 'challenges/one.json': quizMission }), readBytes: () => { throw new Error('ENOENT: no such file') } }
    await expect(importPack(t.db, s.admin, registry, missing)).rejects.toMatchObject({ code: 'invalid' })
    const html = pack({ 'challenges/one.json': quizMission, 'assets/one.json': {} })
    const withHtml: LoadedPack = {
      ...html,
      manifest: { ...html.manifest, challenges: [{ ...html.manifest.challenges[0]!, assets: [{ path: 'page.html', file: 'assets/one.json', content_type: 'text/html', visibility: 'public' }] }] },
    }
    await expect(importPack(t.db, s.admin, registry, withHtml)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('skips archived challenges instead of failing the whole import', async () => {
    const [mission] = await listForAuthoring(t.db, s.admin)
    await archive(t.db, s.admin, mission!.id)
    const report = await importPack(t.db, s.admin, registry, pack({ 'challenges/one.json': { ...quizMission, title: 'Again' }, 'assets/one.json': {} }), { publish: true })
    expect(report).toMatchObject({ skipped: ['mission-one'], published: [] })
  })

  it('only admins import', async () => {
    await expect(importPack(t.db, s.author, registry, pack({ 'challenges/one.json': quizMission }))).rejects.toMatchObject({ code: 'forbidden' })
  })
})
