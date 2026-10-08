import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** The public demo pack ships a copy of the DKA fixture; they must never drift apart. */
describe('examples/packs/clinical-demo', () => {
  it('carries exactly the DKA case the engine tests verify', () => {
    const root = path.resolve(import.meta.dirname, '../../..')
    const read = (p: string) => JSON.parse(readFileSync(path.join(root, p), 'utf8')) as unknown
    expect(read('examples/packs/clinical-demo/challenges/dka-young-adult.json')).toEqual(read('packages/types/fixtures/diagnostic-sim/dka-young-adult.json'))
  })
})
