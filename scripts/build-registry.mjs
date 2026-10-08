/**
 * Builds the public pack registry (registry/index.json + one .zip per pack)
 * from the example packs. Zips are deterministic (fixed timestamps, sorted
 * entries), so the sha256 in the index only changes when a pack does.
 *
 *   node scripts/build-registry.mjs
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(path.join(root, 'packages/services/package.json'))
const { zipSync } = require('fflate')

const BASE_URL = 'https://raw.githubusercontent.com/atultiwari/challengeforge/main/registry'
const PACKS = ['examples/packs/clinical-demo']
const FIXED_TIME = new Date('2026-01-01T00:00:00Z')

function filesOf(dir, base = dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = path.join(dir, name)
      return statSync(full).isDirectory() ? filesOf(full, base) : [[path.relative(base, full).split(path.sep).join('/'), readFileSync(full)]]
    })
}

const entries = PACKS.map((rel) => {
  const dir = path.join(root, rel)
  const manifest = JSON.parse(readFileSync(path.join(dir, 'pack.json'), 'utf8'))
  const tree = Object.fromEntries(filesOf(dir).map(([p, bytes]) => [p, [new Uint8Array(bytes), { level: 9, mtime: FIXED_TIME }]]))
  const zip = zipSync(tree)
  const file = `${manifest.slug}.zip`
  writeFileSync(path.join(root, 'registry', file), zip)
  return {
    slug: manifest.slug,
    title: manifest.title,
    description: manifest.description ?? '',
    version: manifest.version ?? '1',
    url: `${BASE_URL}/${file}`,
    sha256: createHash('sha256').update(zip).digest('hex'),
  }
})
writeFileSync(path.join(root, 'registry', 'index.json'), `${JSON.stringify({ format: 1, packs: entries }, null, 2)}\n`)
process.stdout.write(`Wrote ${entries.length} pack(s) to registry/.\n`)
