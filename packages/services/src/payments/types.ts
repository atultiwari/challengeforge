/**
 * Payment providers behind one small interface (Phase 3, Q4). A provider
 * opens a hosted checkout and turns its own signed webhooks into neutral
 * events; it never decides access (packages/db does, from verified events).
 */
import type { PaymentEvent } from '@challengeforge/db'

export interface CheckoutRequest {
  paymentId: string
  amountMinor: number
  currency: string
  title: string
  customerEmail: string
  /** Where the provider sends the buyer afterwards (our payment status page). */
  returnUrl: string
  cancelUrl: string
}

export interface Checkout {
  /** The provider's checkout id, stored on the payment so webhooks can find it. */
  providerRef: string
  /** The hosted page the buyer is sent to. */
  redirectUrl: string
}

export interface PaymentProvider {
  readonly id: 'mock' | 'stripe' | 'razorpay'
  createCheckout(request: CheckoutRequest): Promise<Checkout>
  /**
   * Verifies a webhook's signature and maps it to an event. Returns null for
   * event types we do not act on. Throws WebhookSignatureError when the
   * signature is missing, wrong or too old.
   */
  verifyWebhook(rawBody: string, headers: Headers, now?: Date): PaymentEvent | null
}

export class WebhookSignatureError extends Error {
  constructor(message = 'Webhook signature could not be verified.') {
    super(message)
    this.name = 'WebhookSignatureError'
  }
}

/** A provider API refused or failed; the message is safe to show (no secrets, no raw bodies). */
export class PaymentProviderError extends Error {
  readonly userMessage = 'The payment provider could not start the checkout. Please try again later.'
  constructor(message: string) {
    super(message)
    this.name = 'PaymentProviderError'
  }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal; redirect?: 'error' | 'follow' | 'manual' }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** Outgoing calls to providers and LMSs never hang a request or a cron run. */
export const OUTBOUND_TIMEOUT_MS = 15_000
