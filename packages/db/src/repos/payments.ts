/**
 * Products and payments (Phase 3, Q4). The provider (Stripe, Razorpay, or the
 * development mock) lives in packages/services; this module only records.
 *
 * Rules:
 *   - the amount always comes from OUR product row, never from the client;
 *   - a payment becomes `paid` only from a verified provider event, and only
 *     if the paid amount and currency match what we asked for;
 *   - each provider event is applied once (payment_events primary key);
 *   - paying creates a grant; a refund revokes it.
 */
import type { Db } from '../client'
import { newId } from '../ids'
import { toBool } from '../json'
import { NotFoundError, ValidationError, requireRole, requireSignedIn, type Scope } from '../scope'
import type { PaymentStatus } from '../schema'
import { canPlayPack, grantFromSource, revokeFromSource } from './access'
import { recordAudit } from './audit'

export interface Product {
  id: string
  packId: string
  packTitle: string
  priceMinor: number
  currency: string
  active: boolean
}

export interface Payment {
  id: string
  packId: string
  packTitle: string
  amountMinor: number
  currency: string
  status: PaymentStatus
  provider: string
  createdAt: Date
}

/** A verified, provider-neutral event (see packages/services/src/payments). */
export interface PaymentEvent {
  provider: string
  eventId: string
  type: 'paid' | 'refunded' | 'failed'
  /** The checkout id we stored when creating the payment. */
  providerRef?: string
  /** The provider's payment id (refunds refer to it). */
  providerPaymentRef?: string
  amountMinor?: number
  currency?: string
}

export type EventOutcome = 'applied' | 'duplicate' | 'unknown_payment' | 'rejected' | 'ignored'

const CURRENCY = /^[A-Z]{3}$/
const MAX_PRICE_MINOR = 100_000_000

const productQuery = (db: Db, siteId: string) =>
  db
    .selectFrom('products')
    .innerJoin('packs', 'packs.id', 'products.pack_id')
    .select(['products.id as id', 'products.pack_id as packId', 'packs.title as packTitle', 'products.price_minor as priceMinor', 'products.currency as currency', 'products.active as active'])
    .where('products.site_id', '=', siteId)

const toProduct = (r: Omit<Product, 'active'> & { active: number | boolean }): Product => ({ ...r, active: toBool(r.active) })

/** One product per pack: creating again updates the price. Admins only. */
export async function saveProduct(db: Db, scope: Scope, input: { packId: string; priceMinor: number; currency: string; active: boolean }): Promise<Product> {
  requireRole(scope, 'admin')
  const currency = input.currency.trim().toUpperCase()
  if (!CURRENCY.test(currency)) throw new ValidationError('Use a three-letter currency code, e.g. INR or USD.')
  if (!Number.isInteger(input.priceMinor) || input.priceMinor < 1 || input.priceMinor > MAX_PRICE_MINOR) {
    throw new ValidationError('Enter a price above zero.')
  }
  const pack = await db.selectFrom('packs').select('id').where('id', '=', input.packId).where('site_id', '=', scope.siteId).executeTakeFirst()
  if (!pack) throw new NotFoundError('Pack not found.')
  const now = new Date()
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('products')
      .values({ id: newId(), site_id: scope.siteId, pack_id: input.packId, price_minor: input.priceMinor, currency, active: input.active, created_at: now, updated_at: now })
      .onDuplicateKeyUpdate({ price_minor: input.priceMinor, currency, active: input.active, updated_at: now })
      .execute()
    await recordAudit(trx, scope, { action: 'product.saved', targetType: 'pack', targetId: input.packId, details: { priceMinor: input.priceMinor, currency, active: input.active } })
  })
  return toProduct(await productQuery(db, scope.siteId).where('products.pack_id', '=', input.packId).executeTakeFirstOrThrow())
}

/** Products on sale (all of them, with `includeInactive`, for admins). */
export async function listProducts(db: Db, scope: Scope, options: { includeInactive?: boolean } = {}): Promise<Product[]> {
  if (options.includeInactive) requireRole(scope, 'admin')
  let query = productQuery(db, scope.siteId)
  if (!options.includeInactive) query = query.where('products.active', '=', true)
  return (await query.orderBy('packs.title').limit(500).execute()).map(toProduct)
}

/** Starts a purchase: a `created` payment at OUR price. The caller then opens the provider's checkout. */
export async function createPayment(db: Db, scope: Scope, productId: string, provider: string): Promise<Payment> {
  const p = requireSignedIn(scope)
  const product = await productQuery(db, scope.siteId).where('products.id', '=', productId).where('products.active', '=', true).executeTakeFirst()
  if (!product) throw new NotFoundError('That is not for sale.')
  if (await canPlayPack(db, scope, product.packId)) throw new ValidationError('You already have access to this pack.')
  const now = new Date()
  const id = newId()
  await db
    .insertInto('payments')
    .values({
      id,
      site_id: scope.siteId,
      user_id: p.userId,
      product_id: product.id,
      pack_id: product.packId,
      provider,
      provider_ref: null,
      provider_payment_ref: null,
      amount_minor: product.priceMinor,
      currency: product.currency,
      status: 'created',
      created_at: now,
      updated_at: now,
    })
    .execute()
  return { id, packId: product.packId, packTitle: product.packTitle, amountMinor: product.priceMinor, currency: product.currency, status: 'created', provider, createdAt: now }
}

/** Stores the provider's checkout id once the checkout exists. */
export async function attachProviderRef(db: Db, paymentId: string, providerRef: string): Promise<void> {
  await db.updateTable('payments').set({ provider_ref: providerRef.slice(0, 128), updated_at: new Date() }).where('id', '=', paymentId).where('provider_ref', 'is', null).execute()
}

/** A payment, for the person who made it. */
export async function getPayment(db: Db, scope: Scope, paymentId: string): Promise<Payment> {
  const p = requireSignedIn(scope)
  const row = await db
    .selectFrom('payments')
    .innerJoin('packs', 'packs.id', 'payments.pack_id')
    .select(['payments.id as id', 'payments.pack_id as packId', 'packs.title as packTitle', 'payments.amount_minor as amountMinor', 'payments.currency as currency', 'payments.status as status', 'payments.provider as provider', 'payments.created_at as createdAt'])
    .where('payments.id', '=', paymentId)
    .where('payments.site_id', '=', scope.siteId)
    .where('payments.user_id', '=', p.userId)
    .executeTakeFirst()
  if (!row) throw new NotFoundError('Payment not found.')
  return row
}

/** Recent payments on the site, for admins. */
export async function listPayments(db: Db, scope: Scope): Promise<(Payment & { email: string })[]> {
  requireRole(scope, 'admin')
  return db
    .selectFrom('payments')
    .innerJoin('packs', 'packs.id', 'payments.pack_id')
    .innerJoin('user', 'user.id', 'payments.user_id')
    .select(['payments.id as id', 'payments.pack_id as packId', 'packs.title as packTitle', 'payments.amount_minor as amountMinor', 'payments.currency as currency', 'payments.status as status', 'payments.provider as provider', 'payments.created_at as createdAt', 'user.email as email'])
    .where('payments.site_id', '=', scope.siteId)
    .orderBy('payments.created_at', 'desc')
    .limit(500)
    .execute()
}

/**
 * Applies a VERIFIED provider event exactly once. Unknown payments, amount
 * mismatches and out-of-order events change nothing but are reported.
 */
export async function applyPaymentEvent(db: Db, event: PaymentEvent): Promise<EventOutcome> {
  return db.transaction().execute(async (trx): Promise<EventOutcome> => {
    const recorded = await trx
      .insertInto('payment_events')
      .values({ provider: event.provider, event_id: event.eventId.slice(0, 128), type: event.type, received_at: new Date() })
      .ignore()
      .executeTakeFirst()
    if (Number(recorded.numInsertedOrUpdatedRows ?? 0) === 0) return 'duplicate'

    let query = trx.selectFrom('payments').selectAll().where('provider', '=', event.provider)
    if (event.providerRef) query = query.where('provider_ref', '=', event.providerRef)
    else if (event.providerPaymentRef) query = query.where('provider_payment_ref', '=', event.providerPaymentRef)
    else return 'unknown_payment'
    const payment = await query.forUpdate().executeTakeFirst()
    if (!payment) return 'unknown_payment'
    const system: Scope = { siteId: payment.site_id, principal: null }
    const now = new Date()

    if (event.type === 'paid') {
      if (payment.status !== 'created') return 'ignored'
      const mismatch =
        (event.amountMinor !== undefined && event.amountMinor !== payment.amount_minor) ||
        (event.currency !== undefined && event.currency.toUpperCase() !== payment.currency)
      if (mismatch) {
        await trx.updateTable('payments').set({ status: 'failed', updated_at: now }).where('id', '=', payment.id).execute()
        await recordAudit(trx, system, { action: 'payment.rejected', targetType: 'payment', targetId: payment.id, details: { expected: `${payment.amount_minor} ${payment.currency}`, got: `${event.amountMinor} ${event.currency}` } }, 'payments')
        return 'rejected'
      }
      await trx
        .updateTable('payments')
        .set({ status: 'paid', provider_payment_ref: event.providerPaymentRef?.slice(0, 128) ?? payment.provider_payment_ref, updated_at: now })
        .where('id', '=', payment.id)
        .execute()
      await grantFromSource(trx, payment.site_id, payment.user_id, payment.pack_id, 'payment', payment.id)
      await recordAudit(trx, system, { action: 'payment.paid', targetType: 'payment', targetId: payment.id, details: { userId: payment.user_id, packId: payment.pack_id } }, 'payments')
      return 'applied'
    }
    if (event.type === 'refunded') {
      if (payment.status !== 'paid') return 'ignored'
      await trx.updateTable('payments').set({ status: 'refunded', updated_at: now }).where('id', '=', payment.id).execute()
      await revokeFromSource(trx, payment.site_id, payment.pack_id, 'payment', payment.id)
      await recordAudit(trx, system, { action: 'payment.refunded', targetType: 'payment', targetId: payment.id, details: { userId: payment.user_id, packId: payment.pack_id } }, 'payments')
      return 'applied'
    }
    if (payment.status !== 'created') return 'ignored'
    await trx.updateTable('payments').set({ status: 'failed', updated_at: now }).where('id', '=', payment.id).execute()
    return 'applied'
  })
}
