/**
 * WordPress single sign-on (Phase 5, S4). The WordPress plugin signs a
 * short-lived token (HS256, the secret both sites share) for the signed-in
 * WordPress user; we verify it and sign them in here. Checks: signature,
 * issuer (the connected WordPress URL), audience (this site), expiry at most
 * five minutes ahead, a token id never seen before (no replay), and a safe
 * local `next` path.
 */
import { errors, jwtVerify } from 'jose'
import { z } from 'zod'

const MAX_LIFETIME_S = 5 * 60

export class WordPressSsoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WordPressSsoError'
  }
}

const Claims = z.object({
  sub: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  name: z.string().max(200).optional(),
  jti: z.string().min(8).max(64),
  exp: z.number(),
  iat: z.number(),
  next: z.string().max(500).optional(),
})

export interface WordPressSignOn {
  wpUserId: string
  name: string
  jti: string
  expiresAt: Date
  /** A local path to continue to (validated by the caller with safeNext). */
  next: string | null
}

export async function verifyWordPressToken(token: string, options: { secret: string; issuer: string; audience: string; now?: Date }): Promise<WordPressSignOn> {
  let payload: Record<string, unknown>
  try {
    const verified = await jwtVerify(token, new TextEncoder().encode(options.secret), {
      issuer: options.issuer,
      audience: options.audience,
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'iat', 'jti', 'sub'],
      clockTolerance: 60,
      ...(options.now ? { currentDate: options.now } : {}),
    })
    payload = verified.payload as Record<string, unknown>
  } catch (err) {
    const reason = err instanceof errors.JOSEError ? err.code : 'invalid'
    throw new WordPressSsoError(`The sign-in link from WordPress was not accepted (${reason}).`)
  }
  const claims = Claims.safeParse(payload)
  if (!claims.success) throw new WordPressSsoError('The sign-in link from WordPress is incomplete.')
  const nowS = Math.floor((options.now ?? new Date()).getTime() / 1000)
  if (claims.data.exp - nowS > MAX_LIFETIME_S + 60) throw new WordPressSsoError('The sign-in link from WordPress is valid for too long; it must expire within five minutes.')
  return {
    wpUserId: claims.data.sub,
    name: claims.data.name ?? '',
    jti: claims.data.jti,
    expiresAt: new Date(claims.data.exp * 1000),
    next: claims.data.next ?? null,
  }
}
