import Link from 'next/link'
import { listGrants, listPacks, listPayments, listProducts, type Grant, type PackSummary, type Product } from '@challengeforge/db'
import { PostButton } from '@/components/common/PostButton'
import { SimpleForm } from '@/components/common/SimpleForm'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'
import { formatPrice, paymentProvider } from '@/server/payments'

export const metadata = { title: 'Access and payments' }

const DEFAULT_CURRENCY = 'INR'
const day = (d: Date) => d.toISOString().slice(0, 10)

function PackAccessCard({ pack, product, grants }: { pack: PackSummary; product: Product | undefined; grants: readonly Grant[] }) {
  const live = grants.filter((g) => !g.revokedAt)
  const restricted = pack.access === 'restricted'
  return (
    <section className="card space-y-4" aria-labelledby={`pack-${pack.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={`pack-${pack.id}`} className="mr-auto text-2xl">{pack.title}</h2>
        <span className={`pill ${restricted ? 'bg-danger-soft text-danger' : 'bg-good-soft text-good'}`}>{pack.access}</span>
        <PostButton
          url={`/api/admin/packs/${pack.id}/access`}
          body={{ access: restricted ? 'open' : 'restricted' }}
          label={restricted ? 'Open to everyone' : 'Restrict'}
          {...(restricted ? {} : { confirm: 'Restrict this pack? Learners without access will see it locked.' })}
        />
        <PostButton
          url={`/api/admin/packs/${pack.id}/certificates`}
          body={{ enabled: !pack.certificatesEnabled }}
          label={pack.certificatesEnabled ? 'Certificates: on (turn off)' : 'Certificates: off (turn on)'}
        />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="font-semibold">Price</h3>
          <p className="text-sm text-ink-muted">
            {product ? `${formatPrice(product.priceMinor, product.currency)} · ${product.active ? 'on sale' : 'not on sale'}` : 'Not for sale.'}
          </p>
          <SimpleForm
            url={`/api/admin/packs/${pack.id}/product`}
            submitLabel="Save price"
            fields={[
              { name: 'price', label: 'Price', type: 'text', required: true, maxLength: 12, value: product ? (product.priceMinor / 100).toFixed(2) : '', help: 'e.g. 499 or 499.00' },
              { name: 'currency', label: 'Currency', type: 'text', required: true, maxLength: 3, value: product?.currency ?? DEFAULT_CURRENCY },
              { name: 'onSale', label: 'On sale', type: 'select', value: product && !product.active ? 'no' : 'yes', options: [['yes', 'Yes'], ['no', 'No']] },
            ]}
          />
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold">People with access ({live.length})</h3>
          {live.length > 0 && (
            <ul className="divide-y divide-line text-sm">
              {live.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-2 py-1">
                  <span className="mr-auto">
                    {g.email} <span className="text-ink-muted">({g.source}{g.expiresAt ? `, until ${day(g.expiresAt)}` : ''})</span>
                  </span>
                  <PostButton url={`/api/admin/grants/${g.id}/revoke`} body={{}} label="Revoke" confirm={`Take away ${g.email}'s access?`} />
                </li>
              ))}
            </ul>
          )}
          <SimpleForm
            url={`/api/admin/packs/${pack.id}/grants`}
            submitLabel="Give access"
            fields={[
              { name: 'email', label: 'Email', type: 'email', required: true, maxLength: 254 },
              { name: 'expiresAt', label: 'Until (optional)', type: 'datetime-local' },
            ]}
          />
        </div>
      </div>
    </section>
  )
}

export default async function AccessPage() {
  const scope = await requirePageRole('admin', '/admin/access')
  const [packs, products, payments] = await Promise.all([listPacks(db(), scope), listProducts(db(), scope, { includeInactive: true }), listPayments(db(), scope)])
  const grants = new Map(await Promise.all(packs.map(async (p) => [p.id, await listGrants(db(), scope, p.id)] as const)))
  const provider = paymentProvider()
  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow"><Link href="/admin" className="hover:underline">Admin</Link></p>
        <h1 className="text-4xl">Access and payments</h1>
        <p className="text-ink-muted">
          Packs are open to everyone unless restricted. A restricted pack opens through a cohort assignment, a grant, or a purchase.
          Payments: <strong>{provider ? provider.id : 'off'}</strong> (PAYMENTS_PROVIDER).
        </p>
      </header>
      {packs.length === 0 && <p className="text-ink-muted">No packs yet. Import one with the CLI.</p>}
      {packs.map((pack) => (
        <PackAccessCard key={pack.id} pack={pack} product={products.find((p) => p.packId === pack.id)} grants={grants.get(pack.id) ?? []} />
      ))}
      <section className="space-y-3">
        <h2 className="text-2xl">Recent payments</h2>
        {payments.length === 0 ? (
          <p className="text-ink-muted">No payments yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  {['When', 'Who', 'Pack', 'Amount', 'Status', 'Provider'].map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">{p.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                    <td className="px-3 py-2">{p.email}</td>
                    <td className="px-3 py-2">{p.packTitle}</td>
                    <td className="px-3 py-2">{formatPrice(p.amountMinor, p.currency)}</td>
                    <td className="px-3 py-2">{p.status}</td>
                    <td className="px-3 py-2">{p.provider}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
