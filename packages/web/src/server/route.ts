import 'server-only'
import type { Scope } from '@challengeforge/db'
import { fail, readJson, sameOrigin, toResponse } from './http'
import { currentScope } from './scope'

/**
 * Shared shell for state-changing JSON routes: same-origin check, bounded
 * body, the caller's scope, and domain errors mapped to HTTP.
 */
export async function mutation(
  request: Request,
  handler: (args: { scope: Scope; body: Record<string, unknown> }) => Promise<Response>,
  maxBytes?: number,
): Promise<Response> {
  if (!sameOrigin(request)) return fail(403, 'bad_origin', 'Request refused.')
  const body = await readJson(request, maxBytes)
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'bad_request', 'The request body was not valid JSON.')
  try {
    const { scope } = await currentScope()
    return await handler({ scope, body: body as Record<string, unknown> })
  } catch (err) {
    return toResponse(err)
  }
}
