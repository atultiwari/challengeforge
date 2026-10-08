#!/usr/bin/env node
/**
 * Builds the deployable release (docs/DEPLOY-HOSTINGER.md):
 *
 *   release/
 *     server.js, .next/, node_modules/   the Next.js standalone server
 *     cli.mjs                            the operator CLI (migrate, import-pack, create-admin...)
 *
 * and zips it to challengeforge-release.zip. The host never builds anything:
 * we upload a prebuilt, tested artifact.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
const web = path.join(root, 'packages/web')
const out = path.join(root, 'release')
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, NEXT_DIST_DIR: '.next' } })

rmSync(out, { recursive: true, force: true })
mkdirSync(out)

// 1. The web app, as a standalone Node server.
run('pnpm', ['--filter', '@challengeforge/web', 'build'])
const standalone = path.join(web, '.next/standalone')
cpSync(standalone, out, { recursive: true })
// Static files are not part of standalone output: copy them next to the server.
const serverDir = path.join(out, 'packages/web')
cpSync(path.join(web, '.next/static'), path.join(serverDir, '.next/static'), { recursive: true })
if (existsSync(path.join(web, 'public'))) cpSync(path.join(web, 'public'), path.join(serverDir, 'public'), { recursive: true })
// A root entry file (what Node hosting panels expect) and a package.json that
// makes it an ES module like Next's own server, wherever the release is unpacked.
writeFileSync(path.join(out, 'package.json'), `${JSON.stringify({ name: 'challengeforge-release', private: true, type: 'module', scripts: { start: 'node server.js' } }, null, 2)}\n`)
writeFileSync(
  path.join(out, 'server.js'),
  [
    "import path from 'node:path'",
    "import { fileURLToPath } from 'node:url'",
    "process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), 'packages/web'))",
    "await import('./packages/web/server.js')",
    '',
  ].join('\n'),
)

// 2. The operator CLI, as one file.
await build({
  entryPoints: [path.join(root, 'apps/cli/src/main.ts')],
  outfile: path.join(out, 'cli.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
})

// 3. One archive to upload.
rmSync(path.join(root, 'challengeforge-release.zip'), { force: true })
run('zip', ['-qr', path.join(root, 'challengeforge-release.zip'), '.'], out)
process.stdout.write(`\nRelease ready: challengeforge-release.zip (from ${path.relative(root, out)}/)\n`)
