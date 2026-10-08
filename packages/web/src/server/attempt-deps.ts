import 'server-only'
import type { AttemptDeps } from '@challengeforge/db'
import { registry } from '@challengeforge/types'
import { serviceRunner } from './services'

/** Model calls and judged grading go through the service runner (and so through the gateway). */
export const attemptDeps: AttemptDeps = {
  registry,
  runService: serviceRunner,
  onError: (cause) => console.error('[attempt] step failed', cause),
}
