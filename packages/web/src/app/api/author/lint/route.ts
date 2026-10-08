import { requireRole } from '@challengeforge/db'
import { registry } from '@challengeforge/types'
import { fail, ok } from '@/server/http'
import { mutation } from '@/server/route'

/** "Lint as you type": schema + type lint for a draft, without saving it. */
export function POST(request: Request) {
  return mutation(
    request,
    async ({ scope, body }) => {
      requireRole(scope, 'author')
      const typeId = String(body['typeId'] ?? '')
      if (!registry.get(typeId, 1)) return fail(400, 'bad_type', 'Unknown challenge type.')
      const parsed = registry.parseDefinition(typeId, 1, body['definition'])
      return ok(parsed.ok ? { valid: true, issues: parsed.warnings } : { valid: false, issues: parsed.issues })
    },
    512 * 1024,
  )
}
