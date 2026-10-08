import { randomBytes } from 'node:crypto'
import { createChallenge } from '@challengeforge/db'
import { registry, slugify } from '@challengeforge/types'
import { db } from '@/server/db'
import { fail, ok } from '@/server/http'
import { mutation } from '@/server/route'

/** Authors create question sets from the form (other types arrive by pack import in Phase 1). */
const FORM_TYPES = new Set(['question-set'])
const DEFINITION_LIMIT = 512 * 1024

export function POST(request: Request) {
  return mutation(
    request,
    async ({ scope, body }) => {
      const typeId = String(body['typeId'] ?? '')
      if (!FORM_TYPES.has(typeId)) return fail(400, 'bad_type', 'That kind of challenge cannot be created here.')
      const definition = body['definition']
      const title = (definition as { title?: unknown } | null)?.title
      const slug = `${slugify(typeof title === 'string' ? title : 'challenge')}-${randomBytes(3).toString('hex')}`
      const id = await createChallenge(db(), scope, registry, { slug, typeId, typeVersion: 1, definition })
      return ok({ id }, 201)
    },
    DEFINITION_LIMIT,
  )
}
