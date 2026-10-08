import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { loadPackFromZip, packToZip, PackZipError, safeEntryName, sha256Hex, unzipLimited } from '../src/packs'

const DEMO = path.resolve(import.meta.dirname, '../../../examples/packs/clinical-demo')

function filesOf(dir: string, base = dir): { path: string; contents: Buffer }[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? filesOf(full, base) : [{ path: path.relative(base, full).split(path.sep).join('/'), contents: readFileSync(full) }]
  })
}

describe('pack zips', () => {
  it('round-trips the demo pack', () => {
    const zip = packToZip(filesOf(DEMO))
    const pack = loadPackFromZip(zip)
    expect(pack.manifest.slug).toBe(JSON.parse(readFileSync(path.join(DEMO, 'pack.json'), 'utf8')).slug)
    const first = pack.manifest.challenges[0]!
    expect(pack.readJson(first.definition)).toEqual(JSON.parse(readFileSync(path.join(DEMO, first.definition), 'utf8')))
    expect(sha256Hex(zip)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('accepts a pack zipped inside one folder', () => {
    const zip = zipSync({ 'my-pack/pack.json': strToU8('{"format":1,"slug":"x","title":"X","challenges":[]}'), 'my-pack/notes.txt': strToU8('hi') })
    expect(loadPackFromZip(zip).manifest.slug).toBe('x')
  })

  it('refuses unsafe paths, inside the zip and in what the pack refers to', () => {
    for (const bad of ['../evil.json', '/etc/passwd', 'a\\b.json', 'a/./b.json']) expect(safeEntryName(bad)).toBeNull()
    expect(() => unzipLimited(zipSync({ '../escape.txt': strToU8('x') }))).toThrow(PackZipError)
    const pack = loadPackFromZip(zipSync({ 'pack.json': strToU8('{"format":1,"slug":"x","title":"X","challenges":[]}') }))
    expect(() => pack.readBytes('../../secret')).toThrow(/not in the zip/)
  })

  it('stops a zip bomb while inflating, and refuses too many entries', () => {
    const bomb = zipSync({ 'pack.json': [new Uint8Array(8 * 1024 * 1024), { level: 9 }] })
    expect(bomb.length).toBeLessThan(64 * 1024)
    expect(() => unzipLimited(bomb, { maxEntries: 10, maxFileBytes: 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 })).toThrow(/more than this site accepts/)
    const many = zipSync(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}.txt`, strToU8('x')])))
    expect(() => unzipLimited(many, { maxEntries: 10, maxFileBytes: 1024, maxTotalBytes: 4096 })).toThrow(/more than 10 files/)
  })

  it('refuses things that are not zips, or have no pack.json', () => {
    expect(() => loadPackFromZip(strToU8('not a zip at all'))).toThrow(PackZipError)
    expect(() => loadPackFromZip(zipSync({ 'readme.txt': strToU8('x') }))).toThrow(/No pack.json/)
  })
})
