import { describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) => {
    if (host === 'rebind.example.test') return [{ address: '93.184.216.34' }, { address: '127.0.0.1' }]
    if (host === 'metadata.example.test') return [{ address: '169.254.169.254' }]
    if (host === 'mapped.example.test') return [{ address: '::ffff:10.0.0.1' }]
    if (host === 'public.example.test') return [{ address: '93.184.216.34' }]
    throw new Error('ENOTFOUND')
  },
}))

const { assertPublicDestination } = await import('../src/outbound')

describe('outbound destinations (review: SSRF through DNS)', () => {
  it('allows a public https host', async () => {
    await expect(assertPublicDestination('https://public.example.test/x')).resolves.toBeUndefined()
  })

  it('refuses names that resolve to private, loopback, metadata or mapped addresses, and unknown names', async () => {
    for (const host of ['rebind', 'metadata', 'mapped', 'nowhere']) {
      await expect(assertPublicDestination(`https://${host}.example.test/x`)).rejects.toThrow()
    }
    await expect(assertPublicDestination('https://[::ffff:127.0.0.1]/x')).rejects.toThrow()
    await expect(assertPublicDestination('http://public.example.test/x')).rejects.toThrow()
  })
})
