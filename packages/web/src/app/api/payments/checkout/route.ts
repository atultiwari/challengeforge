import { attachProviderRef, createPayment } from '@challengeforge/db'
import { db } from '@/server/db'
import { env } from '@/server/env'
import { text } from '@/server/body'
import { fail, ok } from '@/server/http'
import { paymentProvider } from '@/server/payments'
import { mutation } from '@/server/route'
import { currentScope } from '@/server/scope'

/** Starts a purchase at our own price and returns the provider's hosted checkout to go to. */
export async function POST(request: Request) {
  return mutation(request, async ({ scope, body }) => {
    const provider = paymentProvider()
    if (!provider) return fail(503, 'payments_off', 'This site does not take payments.')
    const { user } = await currentScope()
    if (!user) return fail(403, 'forbidden', 'Sign in first.')
    const payment = await createPayment(db(), scope, text(body, 'productId', 64), provider.id)
    const base = env().APP_URL
    try {
      const checkout = await provider.createCheckout({
        paymentId: payment.id,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        title: payment.packTitle,
        customerEmail: user.email,
        returnUrl: `${base}/payments/${payment.id}`,
        cancelUrl: `${base}/payments/${payment.id}`,
      })
      await attachProviderRef(db(), payment.id, checkout.providerRef)
      return ok({ paymentId: payment.id, redirectUrl: checkout.redirectUrl })
    } catch (err) {
      console.error('[payments] checkout failed', err)
      return fail(502, 'provider_failed', 'The payment provider could not start the checkout. Please try again later.')
    }
  })
}
