/**
 * The development provider: "checkout" is a page on our own site with a
 * test Pay button. It never runs on a production site (config refuses it).
 */
import { PaymentProviderError, type PaymentProvider } from './types'

export const MOCK_REF_PREFIX = 'mock_'

export function mockProvider(appUrl: string): PaymentProvider {
  return {
    id: 'mock',
    createCheckout: async (req) => ({ providerRef: `${MOCK_REF_PREFIX}${req.paymentId}`, redirectUrl: `${appUrl}/payments/${req.paymentId}/mock` }),
    verifyWebhook() {
      throw new PaymentProviderError('The mock provider has no webhooks; its test page completes payments directly.')
    },
  }
}
