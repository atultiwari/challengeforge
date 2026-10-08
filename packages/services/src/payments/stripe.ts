/**
 * Stripe Checkout (hosted page) and Stripe webhooks.
 * Checkout: POST /v1/checkout/sessions (form-encoded), mode=payment.
 * Webhooks: `Stripe-Signature: t=<unix>,v1=<hex>`, HMAC-SHA256 of `${t}.${body}`
 * with the endpoint's signing secret, within a 5-minute tolerance.
 */
import type { PaymentEvent } from '@challengeforge/db'
import { hmacHex, sameHex } from './hmac'
import { OUTBOUND_TIMEOUT_MS, PaymentProviderError, WebhookSignatureError, type FetchLike, type PaymentProvider } from './types'

const API = 'https://api.stripe.com/v1/checkout/sessions'
const TOLERANCE_SECONDS = 300

export interface StripeConfig {
  secretKey: string
  webhookSecret: string
}

interface StripeObject {
  id?: string
  client_reference_id?: string | null
  metadata?: Record<string, string> | null
  payment_status?: string
  amount_total?: number
  amount?: number
  amount_refunded?: number
  currency?: string
  payment_intent?: string | null
}

export function stripeProvider(config: StripeConfig, fetchImpl: FetchLike = fetch as unknown as FetchLike): PaymentProvider {
  return {
    id: 'stripe',

    async createCheckout(req) {
      const form = new URLSearchParams({
        mode: 'payment',
        success_url: req.returnUrl,
        cancel_url: req.cancelUrl,
        client_reference_id: req.paymentId,
        customer_email: req.customerEmail,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': req.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(req.amountMinor),
        'line_items[0][price_data][product_data][name]': req.title.slice(0, 250),
        'metadata[payment_id]': req.paymentId,
      })
      const res = await fetchImpl(API, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
          // A retried request returns the same session instead of a second one.
          'idempotency-key': `cf-${req.paymentId}`,
        },
        body: form.toString(),
        signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
      })
      const json = (await res.json().catch(() => ({}))) as { id?: unknown; url?: unknown }
      if (!res.ok || typeof json.id !== 'string' || typeof json.url !== 'string') throw new PaymentProviderError(`Stripe checkout failed (HTTP ${res.status}).`)
      return { providerRef: json.id, redirectUrl: json.url }
    },

    verifyWebhook(rawBody, headers, now = new Date()) {
      const header = headers.get('stripe-signature') ?? ''
      const parts = header.split(',').map((p) => p.split('=') as [string, string])
      const t = parts.find(([k]) => k === 't')?.[1]
      const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v)
      if (!t || !/^\d+$/.test(t) || signatures.length === 0) throw new WebhookSignatureError()
      if (Math.abs(now.getTime() / 1000 - Number(t)) > TOLERANCE_SECONDS) throw new WebhookSignatureError('Webhook timestamp is outside the tolerance.')
      const expected = hmacHex(config.webhookSecret, `${t}.${rawBody}`)
      if (!signatures.some((sig) => sameHex(sig, expected))) throw new WebhookSignatureError()

      const event = JSON.parse(rawBody) as { id?: string; type?: string; data?: { object?: StripeObject } }
      const obj = event.data?.object ?? {}
      if (typeof event.id !== 'string') return null
      const ourId = obj.client_reference_id ?? obj.metadata?.['payment_id']
      const base = { provider: 'stripe', eventId: event.id, ...(ourId ? { paymentId: ourId } : {}) }
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
          // A completed session can still be unpaid (delayed methods): wait for async_payment_succeeded.
          if (obj.payment_status !== 'paid' || !obj.id) return null
          return {
            ...base,
            type: 'paid',
            providerRef: obj.id,
            ...(obj.payment_intent ? { providerPaymentRef: obj.payment_intent } : {}),
            ...(obj.amount_total !== undefined ? { amountMinor: obj.amount_total } : {}),
            ...(obj.currency ? { currency: obj.currency } : {}),
          } satisfies PaymentEvent
        case 'checkout.session.async_payment_failed':
        case 'checkout.session.expired':
          return obj.id ? { ...base, type: 'failed', providerRef: obj.id } : null
        case 'charge.refunded':
          // Only a FULL refund ends access; a partial refund is a goodwill gesture.
          if (!obj.payment_intent || obj.amount === undefined || (obj.amount_refunded ?? 0) < obj.amount) return null
          return { ...base, type: 'refunded', providerPaymentRef: obj.payment_intent }
        default:
          return null
      }
    },
  }
}
