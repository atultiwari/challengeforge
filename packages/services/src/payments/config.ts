/**
 * PAYMENTS_PROVIDER picks one provider for the site: none (default), mock
 * (development only), stripe or razorpay. Errors name variables, never values.
 */
import { z } from 'zod'
import { mockProvider } from './mock'
import { razorpayProvider } from './razorpay'
import { stripeProvider } from './stripe'
import type { FetchLike, PaymentProvider } from './types'

const EnvSchema = z.object({
  PAYMENTS_PROVIDER: z.enum(['none', 'mock', 'stripe', 'razorpay']).default('none'),
  STRIPE_SECRET_KEY: z.string().min(10).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(10).optional(),
  RAZORPAY_KEY_ID: z.string().min(5).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(10).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(8).optional(),
})

/** Returns the configured provider, or null when the site does not take payments. */
export function paymentProviderFromEnv(env: Record<string, string | undefined>, appUrl: string, fetchImpl?: FetchLike): PaymentProvider | null {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid payment configuration - ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }
  const e = parsed.data
  switch (e.PAYMENTS_PROVIDER) {
    case 'none':
      return null
    case 'mock':
      if (env['NODE_ENV'] === 'production') throw new Error('PAYMENTS_PROVIDER=mock grants access without payment and is for development only.')
      return mockProvider(appUrl)
    case 'stripe':
      if (!e.STRIPE_SECRET_KEY || !e.STRIPE_WEBHOOK_SECRET) throw new Error('PAYMENTS_PROVIDER=stripe needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.')
      return stripeProvider({ secretKey: e.STRIPE_SECRET_KEY, webhookSecret: e.STRIPE_WEBHOOK_SECRET }, fetchImpl)
    case 'razorpay':
      if (!e.RAZORPAY_KEY_ID || !e.RAZORPAY_KEY_SECRET || !e.RAZORPAY_WEBHOOK_SECRET) {
        throw new Error('PAYMENTS_PROVIDER=razorpay needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET.')
      }
      return razorpayProvider({ keyId: e.RAZORPAY_KEY_ID, keySecret: e.RAZORPAY_KEY_SECRET, webhookSecret: e.RAZORPAY_WEBHOOK_SECRET }, fetchImpl)
  }
}
