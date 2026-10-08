/**
 * Runs once when the server starts (Next.js instrumentation). With
 * AUTO_MIGRATE (on unless set to "false"), it brings the database schema up
 * to date and creates the site, so an install needs no command line: upload,
 * set the environment, open /setup (Phase 4, R2).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env['AUTO_MIGRATE'] === 'false') return
  const { prepareDatabase } = await import('./server/startup')
  await prepareDatabase()
}
