import { describe, expect, it } from 'vitest'
import { hmacHex } from '../src/payments/hmac'
import { paymentProviderFromEnv, razorpayProvider, stripeProvider, WebhookSignatureError, type CheckoutRequest, type FetchLike } from '../src/payments'

// Synthetic test values only.
const STRIPE = { secretKey: 'sk_test_synthetic_000000', webhookSecret: 'whsec_synthetic_000000' }
const RAZORPAY = { keyId: 'rzp_test_synthetic', keySecret: 'synthetic_secret_000', webhookSecret: 'synthetic_whsec' }
const REQUEST: CheckoutRequest = {
  paymentId: '11111111-2222-3333-4444-555555555555',
  amountMinor: 49900,
  currency: 'INR',
  title: 'Premium pack',
  customerEmail: 'buyer@example.test',
  returnUrl: 'https://site.test/payments/1',
  cancelUrl: 'https://site.test/',
}

function recorder(reply: { ok: boolean; status: number; body: unknown }) {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return { ok: reply.ok, status: reply.status, json: async () => reply.body }
  }
  return { calls, fetchImpl }
}

const stripeSigned = (body: string, t = Math.floor(Date.now() / 1000), secret = STRIPE.webhookSecret) =>
  new Headers({ 'stripe-signature': `t=${t},v1=${hmacHex(secret, `${t}.${body}`)}` })

describe('Stripe', () => {
  it('opens a Checkout Session at our price, idempotently', async () => {
    const { calls, fetchImpl } = recorder({ ok: true, status: 200, body: { id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' } })
    const checkout = await stripeProvider(STRIPE, fetchImpl).createCheckout(REQUEST)
    expect(checkout).toEqual({ providerRef: 'cs_test_1', redirectUrl: 'https://checkout.stripe.test/cs_test_1' })
    const form = new URLSearchParams(calls[0]!.init.body)
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('49900')
    expect(form.get('line_items[0][price_data][currency]')).toBe('inr')
    expect(form.get('client_reference_id')).toBe(REQUEST.paymentId)
    expect(calls[0]!.init.headers['idempotency-key']).toBe(`cf-${REQUEST.paymentId}`)
  })

  it('a failed API call becomes a safe error', async () => {
    const { fetchImpl } = recorder({ ok: false, status: 401, body: { error: { message: 'Invalid API Key provided: sk_test_***' } } })
    await expect(stripeProvider(STRIPE, fetchImpl).createCheckout(REQUEST)).rejects.toThrow(/HTTP 401/)
  })

  it('maps a signed paid session to a paid event', () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 49900, currency: 'inr', payment_intent: 'pi_1' } } })
    expect(stripeProvider(STRIPE).verifyWebhook(body, stripeSigned(body))).toEqual({
      provider: 'stripe', eventId: 'evt_1', type: 'paid', providerRef: 'cs_test_1', providerPaymentRef: 'pi_1', amountMinor: 49900, currency: 'inr',
    })
  })

  it('refuses a wrong secret, a tampered body, an old timestamp, or no signature', () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } })
    const p = stripeProvider(STRIPE)
    expect(() => p.verifyWebhook(body, stripeSigned(body, undefined, 'whsec_wrong_000000'))).toThrow(WebhookSignatureError)
    expect(() => p.verifyWebhook(`${body} `, stripeSigned(body))).toThrow(WebhookSignatureError)
    expect(() => p.verifyWebhook(body, stripeSigned(body, Math.floor(Date.now() / 1000) - 3600))).toThrow(/tolerance/)
    expect(() => p.verifyWebhook(body, new Headers())).toThrow(WebhookSignatureError)
  })

  it('waits for delayed payments, ignores partial refunds, maps full refunds', () => {
    const p = stripeProvider(STRIPE)
    const unpaid = JSON.stringify({ id: 'evt_2', type: 'checkout.session.completed', data: { object: { id: 'cs_2', payment_status: 'unpaid' } } })
    expect(p.verifyWebhook(unpaid, stripeSigned(unpaid))).toBeNull()
    const partial = JSON.stringify({ id: 'evt_3', type: 'charge.refunded', data: { object: { payment_intent: 'pi_1', amount: 49900, amount_refunded: 100 } } })
    expect(p.verifyWebhook(partial, stripeSigned(partial))).toBeNull()
    const full = JSON.stringify({ id: 'evt_4', type: 'charge.refunded', data: { object: { payment_intent: 'pi_1', amount: 49900, amount_refunded: 49900 } } })
    expect(p.verifyWebhook(full, stripeSigned(full))).toEqual({ provider: 'stripe', eventId: 'evt_4', type: 'refunded', providerPaymentRef: 'pi_1' })
    const other = JSON.stringify({ id: 'evt_5', type: 'customer.created', data: { object: {} } })
    expect(p.verifyWebhook(other, stripeSigned(other))).toBeNull()
  })
})

const razorpaySigned = (body: string, eventId = 'evt_rzp_1', secret = RAZORPAY.webhookSecret) =>
  new Headers({ 'x-razorpay-signature': hmacHex(secret, body), 'x-razorpay-event-id': eventId })

describe('Razorpay', () => {
  it('creates a payment link at our price with our reference', async () => {
    const { calls, fetchImpl } = recorder({ ok: true, status: 200, body: { id: 'plink_1', short_url: 'https://rzp.test/i/abc' } })
    expect(await razorpayProvider(RAZORPAY, fetchImpl).createCheckout(REQUEST)).toEqual({ providerRef: 'plink_1', redirectUrl: 'https://rzp.test/i/abc' })
    const sent = JSON.parse(calls[0]!.init.body) as Record<string, unknown>
    expect(sent).toMatchObject({ amount: 49900, currency: 'INR', reference_id: REQUEST.paymentId, accept_partial: false, callback_method: 'get' })
    expect(calls[0]!.init.headers['authorization']).toBe(`Basic ${Buffer.from(`${RAZORPAY.keyId}:${RAZORPAY.keySecret}`).toString('base64')}`)
  })

  it('maps a signed paid link and a full refund; refuses bad signatures', () => {
    const p = razorpayProvider(RAZORPAY)
    const paid = JSON.stringify({ event: 'payment_link.paid', payload: { payment_link: { entity: { id: 'plink_1', amount_paid: 49900, currency: 'INR' } }, payment: { entity: { id: 'pay_1' } } } })
    expect(p.verifyWebhook(paid, razorpaySigned(paid))).toEqual({
      provider: 'razorpay', eventId: 'evt_rzp_1', type: 'paid', providerRef: 'plink_1', providerPaymentRef: 'pay_1', amountMinor: 49900, currency: 'INR',
    })
    expect(() => p.verifyWebhook(paid, razorpaySigned(paid, 'e', 'wrong'))).toThrow(WebhookSignatureError)
    const partial = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { payment_id: 'pay_1' } }, payment: { entity: { id: 'pay_1', refund_status: 'partial' } } } })
    expect(p.verifyWebhook(partial, razorpaySigned(partial, 'evt_2'))).toBeNull()
    const full = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { payment_id: 'pay_1' } }, payment: { entity: { id: 'pay_1', refund_status: 'full' } } } })
    expect(p.verifyWebhook(full, razorpaySigned(full, 'evt_3'))).toEqual({ provider: 'razorpay', eventId: 'evt_3', type: 'refunded', providerPaymentRef: 'pay_1' })
  })
})

describe('payment configuration', () => {
  it('is off by default, needs every secret, and never mocks in production', () => {
    expect(paymentProviderFromEnv({}, 'https://site.test')).toBeNull()
    expect(paymentProviderFromEnv({ PAYMENTS_PROVIDER: 'mock' }, 'https://site.test')?.id).toBe('mock')
    expect(() => paymentProviderFromEnv({ PAYMENTS_PROVIDER: 'mock', NODE_ENV: 'production' }, 'https://site.test')).toThrow(/development only/)
    expect(() => paymentProviderFromEnv({ PAYMENTS_PROVIDER: 'stripe', STRIPE_SECRET_KEY: STRIPE.secretKey }, 'https://site.test')).toThrow(/STRIPE_WEBHOOK_SECRET/)
    expect(paymentProviderFromEnv({ PAYMENTS_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: RAZORPAY.keyId, RAZORPAY_KEY_SECRET: RAZORPAY.keySecret, RAZORPAY_WEBHOOK_SECRET: RAZORPAY.webhookSecret }, 'x')?.id).toBe('razorpay')
  })

  it('the mock checkout is a page on our own site', async () => {
    const mock = paymentProviderFromEnv({ PAYMENTS_PROVIDER: 'mock' }, 'https://site.test')!
    expect(await mock.createCheckout(REQUEST)).toEqual({ providerRef: `mock_${REQUEST.paymentId}`, redirectUrl: `https://site.test/payments/${REQUEST.paymentId}/mock` })
  })
})
