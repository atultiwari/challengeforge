import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * AES-256-GCM envelope encryption for learner-supplied API keys (BYOK).
 *
 * A learner's API key is their property and their liability. It is encrypted
 * with a server-side master key before it touches the database, the row must
 * be unreachable from any client, and the plaintext is never logged, never
 * returned to the browser, and never put in an error message. The UI only
 * ever sees the last four characters.
 */
const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12

export interface SealedSecret {
  readonly ciphertext: string
  readonly iv: string
  readonly authTag: string
}

function masterKeyBuffer(masterKeyBase64: string): Buffer {
  const key = Buffer.from(masterKeyBase64, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be ${KEY_BYTES} bytes (base64). Generate with: openssl rand -base64 32`)
  }
  return key
}

export function encryptSecret(plaintext: string, masterKeyBase64: string): SealedSecret {
  if (plaintext === '') throw new Error('Refusing to encrypt an empty secret.')
  const key = masterKeyBuffer(masterKeyBase64)
  const iv = randomBytes(IV_BYTES)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

export function decryptSecret(sealed: SealedSecret, masterKeyBase64: string): string {
  const key = masterKeyBuffer(masterKeyBase64)
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'))
  // Throws on a wrong key or tampered ciphertext - GCM authenticates for us.
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()]).toString('utf8')
}

/** Last four characters, so the settings page can say which key is stored. */
export function keyHint(plaintext: string): string {
  return plaintext.length >= 8 ? plaintext.slice(-4) : ''
}

/** Constant-time comparison, for anything that compares secret material. */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
