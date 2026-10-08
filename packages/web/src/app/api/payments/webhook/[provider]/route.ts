import { applyPaymentEvent } from '@challengeforge/db'
import { WebhookSignatureError } from '@challengeforge/services'
import { db } from '@/server/db'
import { fail, ok } from '@/server/http'
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
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_WEBHOOK_BYTES) return fail(413, 'too_large', 'Too large.')
  const raw = await request.text()
  if (raw.length > MAX_WEBHOOK_BYTES) return fail(413, 'too_large', 'Too large.')
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
  const outcome = await applyPaymentEvent(db(), event)
  if (outcome === 'unknown_payment' || outcome === 'rejected') console.error(`[payments] ${name} event ${event.eventId}: ${outcome}`)
  return ok({ outcome })
}
