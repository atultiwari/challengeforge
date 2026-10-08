/**
 * The tool's RS256 signing key, created on first use and stored sealed
 * (AES-256-GCM, key derived from BETTER_AUTH_SECRET with HKDF). Platforms
 * fetch the public half from /lti/jwks to check what the tool signs.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { exportJWK, generateKeyPair, importJWK, type CryptoKey, type JWK } from 'jose'
import { activeToolKey, storeToolKey, type Db } from '@challengeforge/db'

export const LTI_ALG = 'RS256'

export interface ToolKey {
  kid: string
  privateKey: CryptoKey
  publicJwk: JWK
}

const sealingKey = (secret: string): Buffer => Buffer.from(hkdfSync('sha256', secret, 'challengeforge', 'challengeforge:lti-keys', 32))

export function seal(plain: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', sealingKey(secret), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64')).join('.')
}

export function open(sealed: string, secret: string): string {
  const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64'))
  if (!iv || !tag || !body) throw new Error('Sealed key is malformed.')
  const decipher = createDecipheriv('aes-256-gcm', sealingKey(secret), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

/** The active key for the site, creating one the first time. */
export async function ensureToolKey(db: Db, siteId: string, secret: string): Promise<ToolKey> {
  const stored = await activeToolKey(db, siteId)
  if (stored) {
    const privateJwk = JSON.parse(open(stored.privateSealed, secret)) as JWK
    return { kid: stored.kid, privateKey: (await importJWK(privateJwk, LTI_ALG)) as CryptoKey, publicJwk: stored.publicJwk as JWK }
  }
  const { publicKey, privateKey } = await generateKeyPair(LTI_ALG, { extractable: true, modulusLength: 2048 })
  const kid = randomBytes(12).toString('base64url')
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: LTI_ALG, use: 'sig' }
  const privateJwk: JWK = { ...(await exportJWK(privateKey)), kid, alg: LTI_ALG }
  await storeToolKey(db, siteId, { kid, publicJwk: publicJwk as Record<string, unknown>, privateSealed: seal(JSON.stringify(privateJwk), secret) })
  return { kid, privateKey, publicJwk }
}
