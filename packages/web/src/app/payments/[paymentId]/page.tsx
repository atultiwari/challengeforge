import Link from 'next/link'
import { notFound } from 'next/navigation'
import { NotFoundError, getPayment } from '@challengeforge/db'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'
import { formatPrice } from '@/server/payments'

export const metadata = { title: 'Payment' }
export const dynamic = 'force-dynamic'

const MESSAGES = {
  created: 'We are waiting for the payment provider to confirm. This usually takes a few seconds; refresh this page.',
  paid: 'Payment received. You now have access to the whole pack.',
  refunded: 'This payment was refunded, so access has ended.',
  failed: 'This payment did not go through. You have not been charged; you can try again.',
} as const

/** Where the provider sends the buyer back. The status comes from verified webhooks, never from this visit. */
export default async function PaymentPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params
  const scope = await requirePageRole('learner', `/payments/${paymentId}`)
  let payment
  try {
    payment = await getPayment(db(), scope, paymentId)
  } catch (err) {
    if (err instanceof NotFoundError) notFound()
    throw err
  }
  return (
    <div className="space-y-6">
      <h1 className="text-3xl">{payment.packTitle}</h1>
      <div className="card max-w-xl space-y-2" role="status">
        <p className="font-semibold">{formatPrice(payment.amountMinor, payment.currency)} · {payment.status}</p>
        <p>{MESSAGES[payment.status]}</p>
      </div>
      <Link className="btn-secondary" href="/">Back to challenges</Link>
    </div>
  )
}
