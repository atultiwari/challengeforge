import 'server-only'
import type { LearningFact, Scope } from '@challengeforge/db'
import { statementFor } from '@challengeforge/services'
import { fail, toResponse } from './http'
import { currentScope } from './scope'
import { currentSiteContext } from './site'

/** xAPI statements as a JSON download (GET routes): the caller's scope, errors mapped, never cached. */
export async function xapiDownload(name: string, facts: (scope: Scope) => Promise<LearningFact[]>): Promise<Response> {
  try {
    const { scope } = await currentScope()
    if (!scope.principal) return fail(401, 'sign_in', 'Sign in first.')
    const { baseUrl } = await currentSiteContext()
    const statements = (await facts(scope)).map((f) => statementFor(f, baseUrl))
    return new Response(JSON.stringify(statements, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${name}.xapi.json"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (err) {
    return toResponse(err)
  }
}
