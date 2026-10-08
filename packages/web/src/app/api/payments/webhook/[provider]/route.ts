import { applyPaymentEvent, PaymentNotFoundYetError } from '@challengeforge/db'
import { WebhookSignatureError } from '@challengeforge/services'
import { db } from '@/server/db'
import { fail, ok, readTextCapped } from '@/server/http'
import { withinPublicLimit } from '@/server/limits'
import { paymentProvider } from '@/server/payments'

const MAX_WEBHOOK_BYTES = 256 * 1024

/**
 * Provider webhooks. No session and no same-origin check (the provider is the
 * caller): the SIGNATURE is the authentication. Each event is applied once.
 */
export async function POST(request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: name } = await ctx.params
  const provider = paymentProvider()
  if (!provider || provider.id !== name || provider.id === 'mock') return fail(404, 'not_found', 'Not found.')
  if (!withinPublicLimit('webhook', request)) return fail(429, 'rate_limited', 'Too many requests.')
  const raw = await readTextCapped(request, MAX_WEBHOOK_BYTES)
  if (raw === null) return fail(413, 'too_large', 'Too large.')
  let event
  try {
    event = provider.verifyWebhook(raw, request.headers)
  } catch (err) {
    if (err instanceof WebhookSignatureError) return fail(400, 'bad_signature', 'Signature could not be verified.')
    if (err instanceof SyntaxError) return fail(400, 'bad_request', 'Malformed body.')
    throw err
  }
  // Acknowledge events we do not act on, so the provider stops retrying them.
  if (!event) return ok({ outcome: 'ignored' })
  let outcome
  try {
    outcome = await applyPaymentEvent(db(), event)
  } catch (err) {
    // Our payment, not recorded yet (the webhook beat checkout): ask the provider to retry later.
    if (err instanceof PaymentNotFoundYetError) return fail(503, 'retry_later', 'Not ready; retry.')
    throw err
  }
  if (outcome === 'unknown_payment' || outcome === 'rejected') console.error(`[payments] ${name} event ${event.eventId}: ${outcome}`)
  return ok({ outcome })
}
