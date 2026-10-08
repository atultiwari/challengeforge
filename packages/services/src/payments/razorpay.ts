/**
 * Razorpay Payment Links (a hosted page, so no checkout script on our pages
 * and no CSP exception) and Razorpay webhooks.
 * Link: POST /v1/payment_links (JSON, Basic auth key_id:key_secret).
 * Webhooks: `X-Razorpay-Signature` = hex HMAC-SHA256 of the raw body with the
 * webhook secret; `X-Razorpay-Event-Id` identifies the delivery.
 */
import type { PaymentEvent } from '@challengeforge/db'
import { hmacHex, sameHex } from './hmac'
import { OUTBOUND_TIMEOUT_MS, PaymentProviderError, WebhookSignatureError, type FetchLike, type PaymentProvider } from './types'

const API = 'https://api.razorpay.com/v1/payment_links'

export interface RazorpayConfig {
  keyId: string
  keySecret: string
  webhookSecret: string
}

interface Entity {
  id?: string
  reference_id?: string
  notes?: Record<string, string> | null
  amount?: number
  amount_paid?: number
  currency?: string
  payment_id?: string
  refund_status?: string | null
}

export function razorpayProvider(config: RazorpayConfig, fetchImpl: FetchLike = fetch as unknown as FetchLike): PaymentProvider {
  return {
    id: 'razorpay',

    async createCheckout(req) {
      const res = await fetchImpl(API, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          amount: req.amountMinor,
          currency: req.currency.toUpperCase(),
          accept_partial: false,
          description: req.title.slice(0, 2048),
          customer: { email: req.customerEmail },
          notify: { email: false, sms: false },
          reference_id: req.paymentId,
          callback_url: req.returnUrl,
          callback_method: 'get',
          notes: { payment_id: req.paymentId },
        }),
        signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
      })
      const json = (await res.json().catch(() => ({}))) as { id?: unknown; short_url?: unknown }
      if (!res.ok || typeof json.id !== 'string' || typeof json.short_url !== 'string') throw new PaymentProviderError(`Razorpay payment link failed (HTTP ${res.status}).`)
      return { providerRef: json.id, redirectUrl: json.short_url }
    },

    verifyWebhook(rawBody, headers) {
      const signature = headers.get('x-razorpay-signature') ?? ''
      if (!sameHex(signature, hmacHex(config.webhookSecret, rawBody))) throw new WebhookSignatureError()
      const event = JSON.parse(rawBody) as { event?: string; payload?: Record<string, { entity?: Entity } | undefined> }
      const eventId = headers.get('x-razorpay-event-id')
      if (!eventId) return null
      const link = event.payload?.['payment_link']?.entity
      const payment = event.payload?.['payment']?.entity
      const refund = event.payload?.['refund']?.entity
      const ourId = link?.reference_id ?? link?.notes?.['payment_id']
      const base = { provider: 'razorpay', eventId, ...(ourId ? { paymentId: ourId } : {}) }
      switch (event.event) {
        case 'payment_link.paid':
          if (!link?.id) return null
          return {
            ...base,
            type: 'paid',
            providerRef: link.id,
            ...(payment?.id ? { providerPaymentRef: payment.id } : {}),
            ...(link.amount_paid !== undefined ? { amountMinor: link.amount_paid } : {}),
            ...(link.currency ? { currency: link.currency } : {}),
          } satisfies PaymentEvent
        case 'payment_link.expired':
        case 'payment_link.cancelled':
          return link?.id ? { ...base, type: 'failed', providerRef: link.id } : null
        case 'refund.processed': {
          // Only a FULL refund ends access.
          const paymentId = refund?.payment_id ?? payment?.id
          if (!paymentId || payment?.refund_status !== 'full') return null
          return { ...base, type: 'refunded', providerPaymentRef: paymentId }
        }
        default:
          return null
      }
    },
  }
}
