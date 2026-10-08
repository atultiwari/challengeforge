export type LlmUserFacingErrorCode =
  | 'call_cap_reached'
  | 'budget_reached'
  | 'no_credential'
  | 'byok_disabled'
  | 'oauth_unavailable'
  | 'provider_disabled'
  | 'invalid_key'
  | 'provider_unavailable'

/**
 * Errors whose message is safe to show a learner. Everything else is logged
 * server-side and surfaced as a generic message, so provider internals and key
 * material can never reach a browser.
 */
export class LlmUserFacingError extends Error {
  constructor(
    message: string,
    readonly code: LlmUserFacingErrorCode,
  ) {
    super(message)
    this.name = 'LlmUserFacingError'
  }
}
