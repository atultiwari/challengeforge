import Link from 'next/link'
import type { Product } from '@challengeforge/db'
import { formatPrice } from '@/server/payments'
import { BuyButton } from './BuyButton'

/** Shown instead of the player when a challenge is in a restricted pack the learner cannot play yet. */
export function LockedNotice({ title, packTitle, product, canBuy }: { title: string; packTitle: string | null; product: Product | null; canBuy: boolean }) {
  return (
    <div className="space-y-6">
      <h1 className="text-4xl">{title}</h1>
      <div className="card max-w-xl space-y-3">
        <p className="font-semibold">This challenge is part of {packTitle ? <>the pack “{packTitle}”</> : 'a restricted pack'}.</p>
        {product && canBuy ? (
          <>
            <p>Get access to the whole pack for {formatPrice(product.priceMinor, product.currency)}.</p>
            <BuyButton productId={product.id} label={`Buy access · ${formatPrice(product.priceMinor, product.currency)}`} />
          </>
        ) : (
          <p className="text-ink-muted">Access comes through your instructor&apos;s cohort or from the site administrator.</p>
        )}
        <p className="text-sm">Have a cohort code? <Link className="underline" href="/join">Join a cohort</Link>.</p>
      </div>
    </div>
  )
}
