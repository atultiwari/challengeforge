import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('../src/server/env', () => ({ env: () => ({ APP_URL: 'https://site.test' }) }))

const chunked = (parts: string[]) =>
  new Request('https://site.test/x', {
    method: 'POST',
    body: new ReadableStream({
      start(c) {
        for (const p of parts) c.enqueue(new TextEncoder().encode(p))
        c.close()
      },
    }),
    // @ts-expect-error Node needs this for a streamed request body
    duplex: 'half',
  })

describe('readTextCapped', () => {
  it('reads a chunked body within the cap and stops past it', async () => {
    const { readTextCapped, readJson } = await import('../src/server/http')
    expect(await readTextCapped(chunked(['ab', 'cd']), 10)).toBe('abcd')
    expect(await readTextCapped(chunked(['x'.repeat(8), 'y'.repeat(8)]), 10)).toBeNull()
    expect(await readJson(chunked(['{"a":', '1}']), 100)).toEqual({ a: 1 })
    expect(await readJson(chunked(['not json']), 100)).toBeNull()
  })
})
