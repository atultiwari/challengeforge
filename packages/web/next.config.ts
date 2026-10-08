import path from 'node:path'
import type { NextConfig } from 'next'

/**
 * `standalone` emits a minimal Node server that is uploaded to Hostinger as a
 * prebuilt archive (docs/DEPLOY-HOSTINGER.md). Workspace packages are TypeScript
 * sources, so Next compiles them.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  // E2E runs build into their own folder so they never disturb a running dev server.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  transpilePackages: ['@challengeforge/db', '@challengeforge/engine', '@challengeforge/llm-gateway', '@challengeforge/services', '@challengeforge/types'],
  poweredByHeader: false,
  // Development only: the dev server serves its scripts to these extra hosts too (the multi-site E2E uses 127.0.0.1).
  allowedDevOrigins: ['127.0.0.1'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
