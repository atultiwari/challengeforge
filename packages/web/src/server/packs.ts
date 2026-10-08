import 'server-only'
import { fetchRegistryIndex, type RegistryEntry } from '@challengeforge/services'

/** The install-wide pack registry (PACK_REGISTRY_URL), or null when none is configured. */
export const registryUrl = (): string | null => process.env['PACK_REGISTRY_URL']?.trim() || null

const TTL_MS = 5 * 60_000
let cached: { url: string; at: number; packs: RegistryEntry[] } | null = null
const ERROR_TTL_MS = 60_000
let failed: { url: string; at: number; error: string } | null = null

/** The registry's packs, cached for a few minutes; a failure is returned as a message, never thrown. */
export async function registryPacks(): Promise<{ packs: RegistryEntry[]; error: string | null }> {
  const url = registryUrl()
  if (!url) return { packs: [], error: null }
  if (cached && cached.url === url && Date.now() - cached.at < TTL_MS) return { packs: cached.packs, error: null }
  if (failed && failed.url === url && Date.now() - failed.at < ERROR_TTL_MS) return { packs: [], error: failed.error }
  try {
    const packs = await fetchRegistryIndex(url)
    cached = { url, at: Date.now(), packs }
    failed = null
    return { packs, error: null }
  } catch (err) {
    // Remembered briefly, so a dead registry does not make every page load wait for the timeout.
    failed = { url, at: Date.now(), error: err instanceof Error ? err.message : 'The registry could not be reached.' }
    return { packs: [], error: failed.error }
  }
}
