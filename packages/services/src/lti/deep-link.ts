/**
 * LTI Deep Linking 2.0: a teacher picks challenges inside the LMS; we answer
 * with a signed LtiDeepLinkingResponse that the browser posts back to the
 * platform. Each item launches our launch URL with the challenge id as a
 * custom parameter, and asks for a grade column (lineItem) out of 100.
 */
import { randomBytes } from 'node:crypto'
import { SignJWT } from 'jose'
import type { LtiPlatform } from '@challengeforge/db'
import { CLAIM } from './claims'
import { LTI_ALG, type ToolKey } from './keys'

export interface PickedChallenge {
  id: string
  title: string
}

export async function deepLinkResponse(
  key: ToolKey,
  platform: LtiPlatform,
  input: { deploymentId: string; data: string | null; appUrl: string; items: readonly PickedChallenge[]; scoreMaximum: number },
): Promise<string> {
  const contentItems = input.items.map((c) => ({
    type: 'ltiResourceLink',
    title: c.title.slice(0, 250),
    url: `${input.appUrl}/lti/launch`,
    custom: { challenge_id: c.id },
    lineItem: { scoreMaximum: input.scoreMaximum, label: c.title.slice(0, 250), resourceId: c.id },
  }))
  return new SignJWT({
    nonce: randomBytes(16).toString('base64url'),
    [CLAIM.messageType]: 'LtiDeepLinkingResponse',
    [CLAIM.version]: '1.3.0',
    [CLAIM.deploymentId]: input.deploymentId,
    [CLAIM.contentItems]: contentItems,
    ...(input.data ? { [CLAIM.deepLinkData]: input.data } : {}),
  })
    .setProtectedHeader({ alg: LTI_ALG, kid: key.kid, typ: 'JWT' })
    .setIssuer(platform.clientId)
    .setAudience(platform.issuer)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key.privateKey)
}
