/** A FRESH install for the first-run wizard: its own empty database, port and build folder. */
import { E2E_ENV, SERVER_URL } from '../e2e/config'

export const SETUP_DB = 'cf_e2e_setup'
export const SETUP_PORT = 3201
export const SETUP_URL = `http://localhost:${SETUP_PORT}`
/** Test-only; what an owner would set in hPanel. */
export const SETUP_TOKEN = 'e2e-only-setup-token-0123456789abcdef'

export const SETUP_ENV: Record<string, string> = {
  ...E2E_ENV,
  DATABASE_URL: `${SERVER_URL}/${SETUP_DB}`,
  APP_URL: SETUP_URL,
  SITE_SLUG: 'fresh',
  SITE_NAME: 'Fresh install',
  NEXT_DIST_DIR: '.next-e2e-setup',
  SETUP_TOKEN,
  // The server itself migrates on start: nothing is prepared but an empty database.
  AUTO_MIGRATE: 'true',
}
