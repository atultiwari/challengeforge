import 'server-only'
import { ForbiddenError, NotFoundError, ValidationError } from '@challengeforge/db'
import { env } from './env'

/** The one response envelope every API route uses (success, data, error). */
export interface ApiEnvelope<T> {
  success: boolean
  data: T | null
  error: { code: string; message: string; issues?: readonly unknown[] } | null
}

export function ok<T>(data: T, status = 200): Response {
  return Response.json({ success: true, data, error: null } satisfies ApiEnvelope<T>, { status, headers: { 'cache-control': 'no-store' } })
}

export function fail(status: number, code: string, message: string, issues?: readonly unknown[]): Response {
  const error = issues ? { code, message, issues } : { code, message }
  return Response.json({ success: false, data: null, error } satisfies ApiEnvelope<never>, { status, headers: { 'cache-control': 'no-store' } })
}

/**
 * CSRF defence for state-changing requests: browsers always send Origin on
 * POST, and it must be this site. (Session cookies are also SameSite=Lax.)
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  return origin !== null && origin === new URL(env().APP_URL).origin
}

/** Maps domain errors to HTTP; anything unexpected is logged and hidden. */
export function toResponse(err: unknown): Response {
  if (err instanceof ValidationError) return fail(422, 'invalid', err.message, err.issues)
  if (err instanceof ForbiddenError) return fail(403, 'forbidden', err.message)
  if (err instanceof NotFoundError) return fail(404, 'not_found', err.message)
  if ((err as { errno?: number }).errno === 1062) return fail(409, 'duplicate', 'Something with that name already exists.')
  console.error('[api] unexpected error', err)
  return fail(500, 'server_error', 'Something went wrong. Please try again.')
}

/** Reads a JSON body with a size cap; returns null when it is missing, too big or malformed. */
/**
 * Reads a request body as text, STOPPING once it passes `maxBytes` (a chunked
 * body has no Content-Length to refuse early). Null when too big or absent.
 */
export async function readTextCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? '0') > maxBytes) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const text = await readTextCapped(request, maxBytes)
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}
