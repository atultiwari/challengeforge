import 'server-only'
import type { AttemptDeps } from '@challengeforge/db'
import { registry } from '@challengeforge/types'

/** Phase 1 types call no services (no model calls), so none are wired. */
export const attemptDeps: AttemptDeps = {
  registry,
  onError: (cause) => console.error('[attempt] step failed', cause),
}
