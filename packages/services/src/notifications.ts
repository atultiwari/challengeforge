/**
 * Sends queued notifications (Phase 4, R3), from `run-jobs`. Each message
 * names the site, links back to the thing it is about, and says how to turn
 * these emails off. Nothing is sent to people who opted out, to LMS
 * placeholder addresses, or when the site has no outgoing mail.
 */
import { claimDueNotifications, failNotification, finishNotification, siteBaseUrl, siteDisplayName, type Db, type DueNotification } from '@challengeforge/db'
import { linkMessage, type MailMessage, type Mailer } from './mail'

const BATCH = 50

export function notificationMessage(n: DueNotification, siteName: string, appUrl: string): MailMessage {
  const footer = `You get these updates from ${siteName}. Turn them off at ${appUrl}/account.`
  const greeting = `Hello ${n.name},`
  const p = n.payload
  switch (n.kind) {
    case 'certificate_issued':
      return linkMessage({
        to: n.email,
        subject: `Your certificate: ${String(p['packTitle'] ?? '')}`,
        greeting,
        body: `Congratulations: you completed every challenge in ${String(p['packTitle'] ?? 'the pack')}. Your certificate is ready, and anyone you share the link with can check it.`,
        action: 'View your certificate',
        url: `${appUrl}/certificates/${encodeURIComponent(String(p['certificateId'] ?? ''))}`,
        footer,
      })
    case 'review_decided':
      return linkMessage({
        to: n.email,
        subject: `Your result on ${String(p['challengeTitle'] ?? 'a challenge')} was reviewed`,
        greeting,
        body: p['passed'] === true ? 'A reviewer checked your attempt and it passed.' : 'A reviewer checked your attempt and it did not pass this time. You can try again.',
        action: 'Open the challenge',
        url: `${appUrl}/play/${encodeURIComponent(String(p['challengeId'] ?? ''))}`,
        footer,
      })
    case 'cohort_joined':
      return linkMessage({
        to: n.email,
        subject: `You joined ${String(p['cohortName'] ?? 'a cohort')}`,
        greeting,
        body: `You are now in ${String(p['cohortName'] ?? 'the cohort')} (${String(p['orgName'] ?? '')}). Your assignments and due dates are on the cohort page.`,
        action: 'See your assignments',
        url: `${appUrl}/cohorts/${encodeURIComponent(String(p['cohortId'] ?? ''))}`,
        footer,
      })
  }
}

/** Sends every due notification once; failures back off and retry. Returns counts. */
/** `appUrl` is the install's default address; sites with their own domain get links to it (multi-site). */
export async function sendDueNotifications(db: Db, mailer: Mailer, appUrl: string, options: { now?: Date; limit?: number } = {}): Promise<{ sent: number; skipped: number; failed: number }> {
  const now = options.now ?? new Date()
  const counts = { sent: 0, skipped: 0, failed: 0 }
  const siteNames = new Map<string, string>()
  const siteUrls = new Map<string, string>()
  // No outgoing mail configured (e.g. cron's environment lacks MAIL_*): leave everything queued for when it is.
  if (!mailer.enabled) return counts
  for (const n of await claimDueNotifications(db, options.limit ?? BATCH, now)) {
    if (!n.wantsUpdates || n.email.endsWith('@lti.invalid')) {
      await finishNotification(db, n.id, 'skipped', now)
      counts.skipped += 1
      continue
    }
    try {
      let siteName = siteNames.get(n.siteId)
      if (!siteName) {
        siteName = await siteDisplayName(db, n.siteId)
        siteNames.set(n.siteId, siteName)
      }
      let siteUrl = siteUrls.get(n.siteId)
      if (!siteUrl) {
        siteUrl = await siteBaseUrl(db, n.siteId, appUrl)
        siteUrls.set(n.siteId, siteUrl)
      }
      await mailer.send(notificationMessage(n, siteName, siteUrl))
      await finishNotification(db, n.id, 'sent', now)
      counts.sent += 1
    } catch (err) {
      await failNotification(db, n.id, err instanceof Error ? err.message : 'Unknown error', now).catch(() => undefined)
      counts.failed += 1
    }
  }
  return counts
}
