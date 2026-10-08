/** Operator configuration, from the environment (the same variables the web app uses). */
export interface CliConfig {
  databaseUrl: string
  siteSlug: string
  siteName: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CliConfig {
  const databaseUrl = env['DATABASE_URL']
  if (!databaseUrl) throw new Error('DATABASE_URL is not set. Example: mysql://user:password@localhost:3306/challengeforge')
  return {
    databaseUrl,
    siteSlug: env['SITE_SLUG'] ?? 'main',
    siteName: env['SITE_NAME'] ?? 'ChallengeForge',
  }
}
