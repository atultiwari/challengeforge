import 'server-only'
import { paymentProviderFromEnv, type PaymentProvider } from '@challengeforge/services'
import { env } from './env'

/** The site's payment provider (PAYMENTS_PROVIDER), or null when it does not take payments. */
let provider: PaymentProvider | null | undefined

export function paymentProvider(): PaymentProvider | null {
  if (provider === undefined) provider = paymentProviderFromEnv(process.env, env().APP_URL)
  return provider
}

/** "499.00" (major units) → 49900 (minor units). Two-decimal currencies only (INR, USD, EUR, GBP…). */
export function toMinorUnits(price: string): number | null {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(price.trim())) return null
  return Math.round(Number(price.trim()) * 100)
}

export const formatPrice = (minor: number, currency: string): string =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100)
