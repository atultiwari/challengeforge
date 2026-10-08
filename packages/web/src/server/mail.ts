import 'server-only'
import { createMailer, linkMessage, mailConfigFromEnv, type Mailer } from '@challengeforge/services'
import { env } from './env'

/** Outgoing mail, configured from MAIL_* / SMTP_* (see packages/services/src/mail.ts). */
let instance: Mailer | null = null

export function mailer(): Mailer {
  instance ??= createMailer(mailConfigFromEnv(process.env))
  return instance
}

/** Email-keyed grants count only confirmed addresses when this site can confirm them (review: email squatting). */
export const emailLookup = (): { verifiedOnly: boolean } => ({ verifiedOnly: mailer().enabled })

/**
 * Sends without making the caller wait. Auth emails must not reveal, by how
 * long a request takes, whether an account exists; failures are logged.
 */
export function sendInBackground(message: Parameters<Mailer['send']>[0], what: string): void {
  mailer()
    .send(message)
    .catch((cause: unknown) => console.error(`[mail] could not send ${what}`, cause))
}

export function passwordResetMessage(to: string, name: string, url: string) {
  return linkMessage({
    to,
    subject: `Reset your ${env().SITE_NAME} password`,
    greeting: `Hello ${name},`,
    body: 'Someone (hopefully you) asked to reset the password for this account. The link works once, for one hour.',
    action: 'Choose a new password',
    url,
    footer: 'If you did not ask for this, ignore this email; your password stays the same.',
  })
}

export function verificationMessage(to: string, name: string, url: string) {
  return linkMessage({
    to,
    subject: `Confirm your email for ${env().SITE_NAME}`,
    greeting: `Hello ${name},`,
    body: 'Confirm this address to finish creating your account.',
    action: 'Confirm my email',
    url,
    footer: 'If you did not create an account, ignore this email.',
  })
}
