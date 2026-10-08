import 'server-only'
import type { AttemptDeps } from '@challengeforge/db'
import { registry } from '@challengeforge/types'
import { serviceRunners } from './services'

/** Model calls, judged grading and background jobs go through the shared service runners (and so through the gateway). */
export const attemptDeps: AttemptDeps = {
  registry,
  runService: (request, context) => serviceRunners().runService(request, context),
  runJobSlice: (request, progress, context) => serviceRunners().runJobSlice(request, progress, context),
  onError: (cause) => console.error('[attempt] step failed', cause),
}
