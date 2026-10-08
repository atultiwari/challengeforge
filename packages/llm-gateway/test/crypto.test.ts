import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptSecret, decryptSecret, keyHint, secretsMatch } from '../src/credentials/crypto'

const masterKey = randomBytes(32).toString('base64')

describe('BYOK envelope encryption', () => {
  it('round-trips a key', () => {
    const plaintext = 'sk-ant-api03-abcdefghijklmnop'
    const sealed = encryptSecret(plaintext, masterKey)
    expect(decryptSecret(sealed, masterKey)).toBe(plaintext)
  })

  it('never stores the plaintext in the envelope', () => {
    const plaintext = 'sk-ant-api03-abcdefghijklmnop'
    const serialised = JSON.stringify(encryptSecret(plaintext, masterKey))
    expect(serialised).not.toContain(plaintext)
    expect(serialised).not.toContain('sk-ant')
  })

  it('produces a different ciphertext each time, so keys cannot be compared', () => {
    const a = encryptSecret('same-key', masterKey)
    const b = encryptSecret('same-key', masterKey)
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.iv).not.toBe(b.iv)
  })

  it('refuses to decrypt with the wrong master key', () => {
    const sealed = encryptSecret('secret', masterKey)
    expect(() => decryptSecret(sealed, randomBytes(32).toString('base64'))).toThrow()
  })

  it('refuses to decrypt tampered ciphertext (GCM auth tag)', () => {
    const sealed = encryptSecret('secret', masterKey)
    const tampered = { ...sealed, ciphertext: Buffer.from('evil').toString('base64') }
    expect(() => decryptSecret(tampered, masterKey)).toThrow()
  })

  it('refuses to decrypt with a swapped auth tag', () => {
    const a = encryptSecret('secret-a', masterKey)
    const b = encryptSecret('secret-b', masterKey)
    expect(() => decryptSecret({ ...a, authTag: b.authTag }, masterKey)).toThrow()
  })

  it('rejects a master key that is not 32 bytes', () => {
    expect(() => encryptSecret('x', Buffer.from('too-short').toString('base64'))).toThrow()
  })

  it('rejects an empty secret rather than storing a useless row', () => {
    expect(() => encryptSecret('', masterKey)).toThrow()
  })
})

describe('keyHint', () => {
  it('shows only the last four characters', () => {
    expect(keyHint('sk-ant-api03-abcdefghijklmnop')).toBe('mnop')
  })

  it('does not leak a short key', () => {
    expect(keyHint('abc')).toBe('')
  })
})

describe('secretsMatch', () => {
  it('compares equal and unequal secrets, including different lengths', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true)
    expect(secretsMatch('abc', 'abd')).toBe(false)
    expect(secretsMatch('abc', 'abcd')).toBe(false)
  })
})
