/** Reads a pack directory from disk; refuses any path that escapes it. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { LoadedPack, PackManifest } from '@challengeforge/db'

export function loadPackFromDirectory(dir: string): LoadedPack {
  const root = path.resolve(dir)
  const inside = (relative: string): string => {
    const full = path.resolve(root, relative)
    if (!full.startsWith(`${root}${path.sep}`)) throw new Error(`Pack path escapes the pack directory: ${relative}`)
    return full
  }
  const manifest = JSON.parse(readFileSync(inside('pack.json'), 'utf8')) as PackManifest
  return {
    manifest,
    readJson: (p) => JSON.parse(readFileSync(inside(p), 'utf8')) as unknown,
    readBytes: (p) => readFileSync(inside(p)),
  }
}
