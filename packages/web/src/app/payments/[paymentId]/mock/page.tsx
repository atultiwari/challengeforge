import { notFound } from 'next/navigation'
import { NotFoundError, getPayment } from '@challengeforge/db'
import { PostButton } from '@/components/common/PostButton'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'
import { formatPrice, paymentProvider } from '@/server/payments'

export const metadata = { title: 'Test checkout' }

/** Development only: stands in for a provider's hosted checkout. */
export default async function MockCheckoutPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params
  if (paymentProvider()?.id !== 'mock' || process.env.NODE_ENV === 'production') notFound()
  const scope = await requirePageRole('learner', `/payments/${paymentId}/mock`)
  let payment
  try {
    payment = await getPayment(db(), scope, paymentId)
  } catch (err) {
    if (err instanceof NotFoundError) notFound()
    throw err
  }
  return (
    <div className="space-y-6">
      <p className="rounded-md bg-danger-soft px-4 py-2 text-sm text-danger">Test checkout: no real money moves. This page exists only in development.</p>
      <h1 className="text-3xl">Pay for {payment.packTitle}</h1>
      <p className="text-xl">{formatPrice(payment.amountMinor, payment.currency)}</p>
      {payment.status === 'created' ? (
        <div className="flex gap-3">
          <PostButton url={`/api/payments/${paymentId}/mock-complete`} body={{}} label="Pay (test)" variant="primary" />
          <a className="btn-secondary" href={`/payments/${paymentId}`}>Done</a>
        </div>
      ) : (
        <a className="btn-primary" href={`/payments/${paymentId}`}>See payment</a>
      )}
    </div>
  )
}
