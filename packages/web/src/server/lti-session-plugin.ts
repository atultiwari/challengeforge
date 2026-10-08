import 'server-only'
import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { z } from 'zod'

/**
 * Signs in a user who arrived through a verified LTI launch. The endpoint
 * has NO path, so Better Auth never routes it over HTTP: only our own server
 * can call it (auth().api.ltiSignIn), and only with a one-time ticket that
 * the launch handler created after checking the LMS's signed token.
 */
export function ltiSessionPlugin(redeem: (ticket: string) => Promise<string | null>) {
  return {
    id: 'challengeforge-lti-session',
    endpoints: {
      ltiSignIn: createAuthEndpoint({ method: 'POST', body: z.object({ ticket: z.string().min(1).max(64) }) }, async (ctx) => {
        const userId = await redeem(ctx.body.ticket)
        if (!userId) throw new APIError('UNAUTHORIZED', { message: 'This sign-in link has expired.' })
        const user = await ctx.context.internalAdapter.findUserById(userId)
        if (!user) throw new APIError('UNAUTHORIZED', { message: 'This sign-in link has expired.' })
        const session = await ctx.context.internalAdapter.createSession(userId)
        await setSessionCookie(ctx, { session, user })
        return ctx.json({ ok: true })
      }),
    },
  } satisfies BetterAuthPlugin
}
