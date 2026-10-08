import 'server-only'
import type { Scope } from '@challengeforge/db'
import { csvFileName, toCsv, type CsvValue } from '@/lib/csv'
import { fail, toResponse } from './http'
import { currentScope } from './scope'

/** A CSV download for a GET route: the caller's scope, domain errors mapped to HTTP, never cached. */
export async function csvDownload(
  name: string,
  build: (scope: Scope) => Promise<{ header: readonly string[]; rows: readonly (readonly CsvValue[])[] }>,
): Promise<Response> {
  try {
    const { scope } = await currentScope()
    if (!scope.principal) return fail(401, 'sign_in', 'Sign in first.')
    const { header, rows } = await build(scope)
    return new Response(toCsv(header, rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${csvFileName(name)}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (err) {
    return toResponse(err)
  }
}
