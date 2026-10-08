/**
 * The development provider: "checkout" is a page on our own site with a
 * test Pay button. It never runs on a production site (config refuses it).
 */
import { PaymentProviderError, type PaymentProvider } from './types'

export const MOCK_REF_PREFIX = 'mock_'

/** `appUrl` is the fallback; the test page is on the same site the buyer returns to (multi-site). */
export function mockProvider(appUrl: string): PaymentProvider {
  return {
    id: 'mock',
    createCheckout: async (req) => ({
      providerRef: `${MOCK_REF_PREFIX}${req.paymentId}`,
      redirectUrl: `${URL.canParse(req.returnUrl) ? new URL(req.returnUrl).origin : appUrl}/payments/${req.paymentId}/mock`,
    }),
    verifyWebhook() {
      throw new PaymentProviderError('The mock provider has no webhooks; its test page completes payments directly.')
    },
  }
}
