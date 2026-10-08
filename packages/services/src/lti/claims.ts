/** LTI 1.3 / Advantage claim names and the launch payload we rely on. */
import { z } from 'zod'

const LTI = 'https://purl.imsglobal.org/spec/lti/claim'
export const CLAIM = {
  messageType: `${LTI}/message_type`,
  version: `${LTI}/version`,
  deploymentId: `${LTI}/deployment_id`,
  targetLinkUri: `${LTI}/target_link_uri`,
  resourceLink: `${LTI}/resource_link`,
  roles: `${LTI}/roles`,
  context: `${LTI}/context`,
  custom: `${LTI}/custom`,
  ags: 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint',
  deepLinkingSettings: 'https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings',
  contentItems: 'https://purl.imsglobal.org/spec/lti-dl/claim/content_items',
  deepLinkData: 'https://purl.imsglobal.org/spec/lti-dl/claim/data',
} as const

export const AGS_SCORE_SCOPE = 'https://purl.imsglobal.org/spec/lti-ags/scope/score'

const Str = z.string().min(1).max(2048)

/** The parts of a verified id_token a launch uses. Unknown claims are ignored. */
export const LaunchPayload = z.object({
  sub: Str.max(255),
  name: z.string().max(300).optional(),
  given_name: z.string().max(200).optional(),
  family_name: z.string().max(200).optional(),
  [CLAIM.messageType]: z.enum(['LtiResourceLinkRequest', 'LtiDeepLinkingRequest']),
  [CLAIM.version]: z.literal('1.3.0'),
  [CLAIM.deploymentId]: Str.max(255),
  [CLAIM.targetLinkUri]: Str.optional(),
  [CLAIM.resourceLink]: z.object({ id: Str.max(255), title: z.string().max(300).optional() }).optional(),
  [CLAIM.roles]: z.array(z.string().max(300)).max(100).default([]),
  [CLAIM.context]: z.object({ id: Str.max(255), title: z.string().max(300).optional() }).optional(),
  [CLAIM.custom]: z.record(z.string(), z.unknown()).optional(),
  [CLAIM.ags]: z.object({ scope: z.array(z.string()).default([]), lineitem: Str.optional(), lineitems: Str.optional() }).optional(),
  [CLAIM.deepLinkingSettings]: z
    .object({ deep_link_return_url: Str, accept_types: z.array(z.string()).default([]), data: z.string().max(2048).optional() })
    .optional(),
})
export type LaunchPayload = z.infer<typeof LaunchPayload>

/** Teaching roles (membership or institution): Instructor, Administrator, ContentDeveloper. */
export const isTeachingRole = (roles: readonly string[]): boolean =>
  roles.some((r) => /#(Instructor|Administrator|ContentDeveloper)$/.test(r) || r === 'Instructor' || r === 'Administrator')

export function displayName(p: LaunchPayload): string {
  return (p.name ?? [p.given_name, p.family_name].filter(Boolean).join(' ')).trim() || 'LMS learner'
}
