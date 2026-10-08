import { siteLearningFacts } from '@challengeforge/db'
import { db } from '@/server/db'
import { xapiDownload } from '@/server/xapi-response'

/** Every learning record on the site as xAPI statements (admins). */
export async function GET() {
  return xapiDownload('site', (scope) => siteLearningFacts(db(), scope))
}
