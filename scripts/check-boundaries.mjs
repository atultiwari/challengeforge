#!/usr/bin/env node
/**
 * Enforces PLAN.md §4: `engine` and `types` are pure. They may not reach the
 * filesystem, the network, a database, a UI framework, or any pack.
 * Fails the build with one line per offending import.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const PURE_PACKAGES = ['packages/engine/src', 'packages/types/src']
const FORBIDDEN = [
  { pattern: /^node:/, reason: 'Node built-ins (fs, net, crypto...) belong in server packages' },
  { pattern: /^(fs|path|http|https|net|child_process|crypto)$/, reason: 'Node built-ins belong in server packages' },
  { pattern: /^(mysql2|kysely|better-auth)/, reason: 'database/auth code belongs in packages/db' },
  { pattern: /^(next|react|react-dom)(\/|$)/, reason: 'UI code belongs in packages/web' },
  { pattern: /^@challengeforge\/(db|web|llm-gateway|pack-)/, reason: 'pure packages may not depend on server packages or packs' },
]
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) yield* files(full)
    else if (/\.(ts|tsx|mts)$/.test(entry)) yield full
  }
}

const violations = []
for (const root of PURE_PACKAGES) {
  for (const file of files(root)) {
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const spec = match[1] ?? match[2]
      const rule = FORBIDDEN.find((f) => f.pattern.test(spec))
      if (rule) violations.push(`${file}: imports "${spec}" - ${rule.reason}`)
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Boundary check failed:\n${violations.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write(`Boundary check passed (${PURE_PACKAGES.join(', ')}).\n`)
