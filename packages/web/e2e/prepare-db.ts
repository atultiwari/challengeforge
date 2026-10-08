/**
 * Fresh database for every E2E run: create it, migrate, import the synthetic
 * pack and publish it, all through the real operator CLI. Runs BEFORE
 * Playwright, because Playwright starts the web server before any global setup.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { createConnection } from 'mysql2/promise'
import { E2E_ADMIN, E2E_DB, E2E_ENV, SERVER_URL } from './config'

async function prepare() {
  const admin = await createConnection(SERVER_URL)
  await admin.query(`DROP DATABASE IF EXISTS \`${E2E_DB}\``)
  await admin.query(`CREATE DATABASE \`${E2E_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  await admin.end()
  const cli = (...args: string[]) =>
    execFileSync('pnpm', ['--filter', '@challengeforge/cli', 'cf', ...args], { env: { ...process.env, ...E2E_ENV, ADMIN_PASSWORD: E2E_ADMIN.password }, stdio: 'inherit' })
  cli('migrate')
  cli('create-admin', '--email', E2E_ADMIN.email, '--name', 'E2E Admin')
  cli('import-pack', path.resolve(import.meta.dirname, 'fixtures/pack'), '--publish')
  cli('import-pack', path.resolve(import.meta.dirname, 'fixtures/premium'), '--publish')
  cli('import-pack', path.resolve(import.meta.dirname, '../../../examples/packs/clinical-demo'), '--publish')
}

await prepare()
