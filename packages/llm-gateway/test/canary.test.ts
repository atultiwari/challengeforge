import { describe, it, expect } from 'vitest'
import { deriveCanary } from '../src/canary'

const SECRET = 'test-canary-secret'

describe('deriveCanary', () => {
  it('has the CF-CANARY- format', () => {
    expect(deriveCanary('u1', 'c1', SECRET)).toMatch(/^CF-CANARY-[0-9a-f]{16}$/)
  })

  it('is deterministic', () => {
    expect(deriveCanary('u1', 'c1', SECRET)).toBe(deriveCanary('u1', 'c1', SECRET))
  })

  it('differs by user and by challenge', () => {
    const base = deriveCanary('u1', 'c1', SECRET)
    expect(deriveCanary('u2', 'c1', SECRET)).not.toBe(base)
    expect(deriveCanary('u1', 'c2', SECRET)).not.toBe(base)
  })

  it('differs by secret and refuses an empty one', () => {
    expect(deriveCanary('u1', 'c1', 'other')).not.toBe(deriveCanary('u1', 'c1', SECRET))
    expect(() => deriveCanary('u1', 'c1', '')).toThrow()
  })
})
