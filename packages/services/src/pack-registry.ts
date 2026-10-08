/**
 * A pack registry (Phase 5, S1): an https JSON index of packs, each with a
 * download URL and a sha256. A pack is installed only if the downloaded
 * bytes match that checksum, so the registry vouches for the exact file
 * and a tampered mirror is refused. Packs are data; nothing here runs code.
 *
 * Index format:
 *   { "format": 1, "packs": [ { "slug", "title", "description", "version", "url", "sha256" } ] }
 */
import { z } from 'zod'
import { isAllowedOutboundUrl, type LoadedPack } from '@challengeforge/db'
import { OUTBOUND_TIMEOUT_MS } from './payments/types'
import { loadPackFromZip, MAX_PACK_ZIP_BYTES, PackZipError, sha256Hex } from './packs'

const MAX_INDEX_BYTES = 1024 * 1024

export const RegistryEntrySchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).default(''),
  version: z.string().max(40).default(''),
  url: z.string().url().max(500),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
})
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>

const IndexSchema = z.object({ format: z.literal(1), packs: z.array(RegistryEntrySchema).max(500) })

/** Fetches a URL's body, refusing unsafe addresses and anything over `maxBytes` (counted while reading). */
async function fetchCapped(url: string, maxBytes: number, fetchImpl: typeof fetch): Promise<Uint8Array> {
  if (!isAllowedOutboundUrl(url)) throw new PackZipError('That address is not allowed (https on the public internet only).')
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS * 4), redirect: 'error' })
  if (!res.ok || !res.body) throw new PackZipError(`The registry answered HTTP ${res.status}.`)
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw new PackZipError('The download is larger than this site accepts.')
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new PackZipError('The download is larger than this site accepts.')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export async function fetchRegistryIndex(indexUrl: string, fetchImpl: typeof fetch = fetch): Promise<RegistryEntry[]> {
  const body = await fetchCapped(indexUrl, MAX_INDEX_BYTES, fetchImpl)
  let json: unknown
  try {
    json = JSON.parse(Buffer.from(body).toString('utf8'))
  } catch {
    throw new PackZipError('The registry index is not valid JSON.')
  }
  const parsed = IndexSchema.safeParse(json)
  if (!parsed.success) throw new PackZipError('The registry index is not in the expected format.')
  return parsed.data.packs
}

/** Downloads a registry pack and checks it against the index's sha256 before reading it. */
export async function downloadRegistryPack(entry: RegistryEntry, fetchImpl: typeof fetch = fetch): Promise<LoadedPack> {
  const bytes = await fetchCapped(entry.url, MAX_PACK_ZIP_BYTES, fetchImpl)
  if (sha256Hex(bytes) !== entry.sha256) throw new PackZipError('The download does not match the registry checksum, so it was not installed.')
  return loadPackFromZip(bytes)
}
