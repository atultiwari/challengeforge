/**
 * Packs as .zip files (Phase 5, S1): upload, download and registry installs
 * in the browser. A pack is data only (PLAN.md §3.7); this module only turns
 * bytes into the same LoadedPack the CLI's directory loader produces, so the
 * one importer and its validators decide everything.
 *
 * Untrusted zips are read defensively:
 *   - entries are inflated as a STREAM and counted as they come out, so a
 *     zip bomb is stopped at the limit instead of exhausting memory;
 *   - names must be plain relative paths (no "..", no absolute paths, no
 *     backslashes or NUL), so nothing can point outside the pack;
 *   - a pack zipped inside one top-level folder is accepted too.
 */
import { createHash } from 'node:crypto'
import { Unzip, UnzipInflate, zipSync, type Zippable } from 'fflate'
import type { LoadedPack, PackManifest } from '@challengeforge/db'

export interface ZipLimits {
  maxEntries: number
  maxFileBytes: number
  maxTotalBytes: number
}

export const PACK_ZIP_LIMITS: ZipLimits = { maxEntries: 2000, maxFileBytes: 16 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 }
/** Compressed upload or download size limit. */
export const MAX_PACK_ZIP_BYTES = 32 * 1024 * 1024
const PUSH_CHUNK = 64 * 1024

export class PackZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackZipError'
  }
}

/** A safe relative path, or null. */
export function safeEntryName(name: string): string | null {
  if (name.length === 0 || name.length > 300 || /[\\\0]/.test(name) || name.startsWith('/')) return null
  const parts = name.split('/')
  if (parts.some((p) => p === '..' || p === '.')) return null
  return name
}

/** Inflates a zip into memory, enforcing the limits while inflating. */
export function unzipLimited(data: Uint8Array, limits: ZipLimits = PACK_ZIP_LIMITS): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  let entries = 0
  let total = 0
  const seen = new Set<string>()
  let failure: Error | null = null
  const unzip = new Unzip((file) => {
    if (failure) return
    if (file.name.endsWith('/')) return // a directory entry
    entries += 1
    const name = safeEntryName(file.name)
    if (entries > limits.maxEntries) failure = new PackZipError(`The zip has more than ${limits.maxEntries} files.`)
    else if (!name) failure = new PackZipError(`The zip contains an unsafe path: ${file.name.slice(0, 80)}`)
    if (failure || !name) return
    // The same name twice: the second would silently replace the first.
    if (seen.has(name)) {
      failure = new PackZipError(`The zip contains ${name.slice(0, 80)} twice.`)
      return
    }
    seen.add(name)
    const chunks: Uint8Array[] = []
    let size = 0
    file.ondata = (err, chunk, final) => {
      if (failure) return
      if (err) {
        failure = new PackZipError('The zip is damaged.')
        return
      }
      size += chunk.length
      total += chunk.length
      if (size > limits.maxFileBytes || total > limits.maxTotalBytes) {
        failure = new PackZipError('The zip unpacks to more than this site accepts.')
        file.terminate()
        return
      }
      chunks.push(chunk)
      if (final) files.set(name, Buffer.concat(chunks))
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  try {
    for (let offset = 0; offset < data.length && !failure; offset += PUSH_CHUNK) {
      unzip.push(data.subarray(offset, offset + PUSH_CHUNK), offset + PUSH_CHUNK >= data.length)
    }
  } catch {
    failure ??= new PackZipError('The file is not a valid zip.')
  }
  if (failure) throw failure
  return files
}

/** Reads a pack from a zip (pack.json at the root, or inside one top-level folder). */
export function loadPackFromZip(data: Uint8Array): LoadedPack {
  if (data.length > MAX_PACK_ZIP_BYTES) throw new PackZipError('The zip is too large.')
  const files = unzipLimited(data)
  let prefix = ''
  if (!files.has('pack.json')) {
    const nested = [...files.keys()].filter((k) => /^[^/]+\/pack\.json$/.test(k))
    if (nested.length !== 1) throw new PackZipError('No pack.json found in the zip.')
    prefix = nested[0]!.slice(0, -'pack.json'.length)
  }
  const read = (p: string): Uint8Array => {
    const name = safeEntryName(p)
    const bytes = name ? files.get(prefix + name) : undefined
    if (!bytes) throw new PackZipError(`The pack refers to a file that is not in the zip: ${p.slice(0, 120)}`)
    return bytes
  }
  const json = (p: string): unknown => {
    try {
      return JSON.parse(Buffer.from(read(p)).toString('utf8')) as unknown
    } catch (err) {
      if (err instanceof PackZipError) throw err
      throw new PackZipError(`${p.slice(0, 120)} is not valid JSON.`)
    }
  }
  return { manifest: json('pack.json') as PackManifest, readJson: json, readBytes: (p) => Buffer.from(read(p)) }
}

/** Zips a pack's files (from exportFiles) for download. */
export function packToZip(files: readonly { path: string; contents: Buffer }[]): Uint8Array {
  const tree: Zippable = {}
  for (const f of files) tree[f.path] = [new Uint8Array(f.contents), { level: 6 }]
  return zipSync(tree)
}

export const sha256Hex = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
