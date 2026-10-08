import { applyPaymentEvent, getPayment } from '@challengeforge/db'
import { MOCK_REF_PREFIX } from '@challengeforge/services'
import { db } from '@/server/db'
import { fail, ok } from '@/server/http'
import { paymentProvider } from '@/server/payments'
import { mutation } from '@/server/route'

/** Development only: the mock provider's "Pay" button. Refused unless the site runs the mock provider. */
export async function POST(request: Request, ctx: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await ctx.params
  return mutation(request, async ({ scope }) => {
    if (paymentProvider()?.id !== 'mock' || process.env.NODE_ENV === 'production') return fail(404, 'not_found', 'Not found.')
    const payment = await getPayment(db(), scope, paymentId)
    const outcome = await applyPaymentEvent(db(), {
      provider: 'mock',
      eventId: `mock-paid-${paymentId}`,
      type: 'paid',
      providerRef: `${MOCK_REF_PREFIX}${paymentId}`,
      providerPaymentRef: `mock-pay-${paymentId}`,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
    })
    return ok({ outcome })
  })
}
