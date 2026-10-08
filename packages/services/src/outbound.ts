/**
 * Before this server calls an address someone else supplied (a pack
 * registry, an LRS, an LMS grade book), the name must resolve only to public
 * addresses. A hostname that points at 127.0.0.1 or a cloud metadata address
 * would otherwise let a registry or LRS owner probe the host's own network.
 * (Calls are also made with redirect: 'error', so a public host cannot bounce
 * the request inward.)
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isAllowedOutboundUrl, isPrivateAddress } from '@challengeforge/db'

export class OutboundRefusedError extends Error {
  constructor(message = 'That address is not allowed (https on the public internet only).') {
    super(message)
    this.name = 'OutboundRefusedError'
  }
}

/** Throws unless `url` is allowed and its host resolves only to public addresses. */
export async function assertPublicDestination(url: string): Promise<void> {
  if (!isAllowedOutboundUrl(url)) throw new OutboundRefusedError()
  const { hostname } = new URL(url)
  const host = hostname.replace(/^\[|\]$/g, '')
  // Development: http://localhost is permitted by isAllowedOutboundUrl outside production only.
  if (host === 'localhost' || isIP(host) !== 0) return
  let addresses: { address: string }[]
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    throw new OutboundRefusedError('That address could not be found.')
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) throw new OutboundRefusedError()
}
