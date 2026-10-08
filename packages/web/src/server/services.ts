import 'server-only'
import { createServiceRunners, servicesConfigFromEnv } from '@challengeforge/services'
import { db } from './db'

/** Model replies, judged grading and background jobs, configured from the environment (see packages/services). */
let runners: ReturnType<typeof createServiceRunners> | null = null

export function serviceRunners(): ReturnType<typeof createServiceRunners> {
  runners ??= createServiceRunners(db(), servicesConfigFromEnv(process.env))
  return runners
}
