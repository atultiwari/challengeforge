/**
 * Looking people up by email, for the places an admin or teacher gives
 * someone a role or access by typing their address.
 *
 * When the site can send mail, only CONFIRMED addresses count: otherwise
 * someone could sign up first with a colleague's address and receive the
 * role meant for them (review: email squatting). Sites without mail cannot
 * confirm addresses, so there the check is off.
 */
export interface EmailLookup {
  /** Count only accounts whose email has been confirmed. */
  verifiedOnly?: boolean
}

export const normaliseEmail = (email: string): string => email.trim().toLowerCase()
