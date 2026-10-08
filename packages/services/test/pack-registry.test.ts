import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { downloadRegistryPack, fetchRegistryIndex, sha256Hex } from '../src'

const zip = zipSync({ 'pack.json': strToU8('{"format":1,"slug":"reg-pack","title":"Registry pack","challenges":[]}') })
const entry = { slug: 'reg-pack', title: 'Registry pack', description: '', version: '1', url: 'https://registry.example.test/reg-pack.zip', sha256: sha256Hex(zip) }

const serve = (routes: Record<string, Uint8Array | string>): typeof fetch =>
  (async (input: string | URL | Request) => {
    const body = routes[String(input)]
    if (body === undefined) return new Response('missing', { status: 404 })
    return new Response(typeof body === 'string' ? body : new Uint8Array(body), { status: 200 })
  }) as typeof fetch

describe('pack registry', () => {
  it('reads an index and installs a pack whose checksum matches', async () => {
    const fetchImpl = serve({ 'https://registry.example.test/index.json': JSON.stringify({ format: 1, packs: [entry] }), [entry.url]: zip })
    const packs = await fetchRegistryIndex('https://registry.example.test/index.json', fetchImpl)
    expect(packs.map((p) => p.slug)).toEqual(['reg-pack'])
    expect((await downloadRegistryPack(packs[0]!, fetchImpl)).manifest.slug).toBe('reg-pack')
  })

  it('refuses a tampered download, a bad index, and unsafe addresses', async () => {
    const tampered = zipSync({ 'pack.json': strToU8('{"format":1,"slug":"reg-pack","title":"Evil","challenges":[]}') })
    await expect(downloadRegistryPack(entry, serve({ [entry.url]: tampered }))).rejects.toThrow(/checksum/)
    await expect(fetchRegistryIndex('https://r.example.test/i.json', serve({ 'https://r.example.test/i.json': '{"format":2}' }))).rejects.toThrow(/expected format/)
    await expect(fetchRegistryIndex('https://10.0.0.1/index.json', serve({}))).rejects.toThrow(/not allowed/)
    await expect(fetchRegistryIndex('http://registry.example.test/index.json', serve({}))).rejects.toThrow(/not allowed/)
  })
})
