import path from 'node:path'
import type { NextConfig } from 'next'

/**
 * `standalone` emits a minimal Node server that is uploaded to Hostinger as a
 * prebuilt archive (docs/DEPLOY-HOSTINGER.md). Workspace packages are TypeScript
 * sources, so Next compiles them.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  transpilePackages: ['@challengeforge/db', '@challengeforge/engine', '@challengeforge/types'],
  poweredByHeader: false,
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
