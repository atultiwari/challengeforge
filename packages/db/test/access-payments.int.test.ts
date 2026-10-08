import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addAssignment,
  applyPaymentEvent,
  attachProviderRef,
  canPlay,
  createChallenge,
  createCohort,
  createOrganisation,
  createPayment,
  getPayment,
  grantAccess,
  joinCohort,
  listAudit,
  listGrants,
  listPlayable,
  listProducts,
  lockedChallengeIds,
  publish,
  revokeGrant,
  saveProduct,
  setOrgMember,
  setPackAccess,
  startOrResume,
  updateCohort,
  upsertPack,
  type Scope,
} from '../src'
import { createUser, freshDb, registry, setupSite, type TestDb } from './harness'
import { quizMission } from './fixtures'

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
let packId: string
let lockedId: string
let freeId: string
const emailOf = async (scope: Scope) => (await t.db.selectFrom('user').select('email').where('id', '=', scope.principal!.userId).executeTakeFirstOrThrow()).email

beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
  packId = await upsertPack(t.db, s.admin, { slug: 'premium', title: 'Premium pack', description: '' })
  lockedId = await createChallenge(t.db, s.admin, registry, { slug: 'locked', typeId: 'lab-legacy', typeVersion: 1, definition: quizMission, packId })
  freeId = await createChallenge(t.db, s.admin, registry, { slug: 'free', typeId: 'lab-legacy', typeVersion: 1, definition: quizMission })
  await publish(t.db, s.admin, lockedId)
  await publish(t.db, s.admin, freeId)
})
afterAll(async () => t.close())

describe('pack access', () => {
  it('everything is open until a pack is restricted', async () => {
    expect(await canPlay(t.db, s.learner, lockedId)).toBe(true)
    await expect(setPackAccess(t.db, s.author, packId, 'restricted')).rejects.toMatchObject({ code: 'forbidden' })
    await setPackAccess(t.db, s.admin, packId, 'restricted')
    expect(await canPlay(t.db, s.learner, lockedId)).toBe(false)
    expect(await canPlay(t.db, s.learner, freeId)).toBe(true)
    expect(await canPlay(t.db, s.admin, lockedId)).toBe(true)
    await expect(startOrResume(t.db, s.learner, { registry }, lockedId)).rejects.toMatchObject({ code: 'forbidden' })
    const catalogue = await listPlayable(t.db, s.learner)
    expect([...(await lockedChallengeIds(t.db, s.learner, catalogue))]).toEqual([lockedId])
    expect([...(await lockedChallengeIds(t.db, s.anonymous, catalogue))]).toEqual([lockedId])
  })

  it('an admin grant opens it, an expiry or a revoke closes it again', async () => {
    const who = await createUser(t.db, s.site.id, 'learner', 'granted')
    await grantAccess(t.db, s.admin, packId, await emailOf(who))
    expect(await canPlay(t.db, who, lockedId)).toBe(true)
    await startOrResume(t.db, who, { registry }, lockedId)
    const grant = (await listGrants(t.db, s.admin, packId)).find((g) => g.userId === who.principal!.userId)!
    await revokeGrant(t.db, s.admin, grant.id)
    expect(await canPlay(t.db, who, lockedId)).toBe(false)

    await grantAccess(t.db, s.admin, packId, await emailOf(who), new Date(Date.now() + 60_000))
    expect(await canPlay(t.db, who, lockedId)).toBe(true)
    expect(await canPlay(t.db, who, lockedId, new Date(Date.now() + 120_000))).toBe(false)
    await expect(grantAccess(t.db, s.admin, packId, await emailOf(who), new Date(Date.now() - 1000))).rejects.toMatchObject({ code: 'invalid' })
  })

  it('a live cohort assigned the pack (or the challenge) opens it; archiving the cohort closes it', async () => {
    const teacher = await createUser(t.db, s.site.id, 'learner', 'access-teacher')
    const student = await createUser(t.db, s.site.id, 'learner', 'access-student')
    const org = await createOrganisation(t.db, s.admin, { slug: 'access-org', name: 'Access org' })
    await setOrgMember(t.db, s.admin, org.id, await emailOf(teacher), 'instructor')
    const cohort = await createCohort(t.db, teacher, org.id, 'Paid by the school')
    await joinCohort(t.db, student, cohort.joinCode)
    expect(await canPlay(t.db, student, lockedId)).toBe(false)
    await addAssignment(t.db, teacher, cohort.id, { challengeId: lockedId })
    expect(await canPlay(t.db, student, lockedId)).toBe(true)
    await updateCohort(t.db, teacher, cohort.id, { archived: true })
    expect(await canPlay(t.db, student, lockedId)).toBe(false)
  })
})

describe('payments', () => {
  let productId: string

  it('admins price a pack; learners see only active products', async () => {
    await expect(saveProduct(t.db, s.admin, { packId, priceMinor: 0, currency: 'INR', active: true })).rejects.toMatchObject({ code: 'invalid' })
    await expect(saveProduct(t.db, s.admin, { packId, priceMinor: 49900, currency: 'rupees', active: true })).rejects.toMatchObject({ code: 'invalid' })
    await expect(saveProduct(t.db, s.author, { packId, priceMinor: 49900, currency: 'INR', active: true })).rejects.toMatchObject({ code: 'forbidden' })
    productId = (await saveProduct(t.db, s.admin, { packId, priceMinor: 49900, currency: 'inr', active: true })).id
    expect(await listProducts(t.db, s.learner)).toEqual([expect.objectContaining({ id: productId, priceMinor: 49900, currency: 'INR', packTitle: 'Premium pack' })])
    await saveProduct(t.db, s.admin, { packId, priceMinor: 49900, currency: 'INR', active: false })
    expect(await listProducts(t.db, s.learner)).toEqual([])
    await expect(createPayment(t.db, s.learner, productId, 'mock')).rejects.toMatchObject({ code: 'not_found' })
    await saveProduct(t.db, s.admin, { packId, priceMinor: 49900, currency: 'INR', active: true })
  })

  it('a verified paid event grants access once; a repeat is a no-op; a refund revokes', async () => {
    const buyer = await createUser(t.db, s.site.id, 'learner', 'buyer')
    const payment = await createPayment(t.db, buyer, productId, 'mock')
    expect(payment).toMatchObject({ amountMinor: 49900, currency: 'INR', status: 'created' })
    await attachProviderRef(t.db, payment.id, 'cs_1')
    const paid = { provider: 'mock', eventId: 'evt_1', type: 'paid' as const, providerRef: 'cs_1', providerPaymentRef: 'pi_1', amountMinor: 49900, currency: 'inr' }
    expect(await applyPaymentEvent(t.db, paid)).toBe('applied')
    expect(await applyPaymentEvent(t.db, paid)).toBe('duplicate')
    expect((await getPayment(t.db, buyer, payment.id)).status).toBe('paid')
    expect(await canPlay(t.db, buyer, lockedId)).toBe(true)
    await expect(createPayment(t.db, buyer, productId, 'mock')).rejects.toMatchObject({ code: 'invalid' })
    await expect(getPayment(t.db, s.learner, payment.id)).rejects.toMatchObject({ code: 'not_found' })

    expect(await applyPaymentEvent(t.db, { provider: 'mock', eventId: 'evt_2', type: 'refunded', providerPaymentRef: 'pi_1' })).toBe('applied')
    expect((await getPayment(t.db, buyer, payment.id)).status).toBe('refunded')
    expect(await canPlay(t.db, buyer, lockedId)).toBe(false)
    const actions = (await listAudit(t.db, s.admin)).filter((e) => e.targetId === payment.id).map((e) => [e.action, e.actorId])
    expect(actions).toEqual(expect.arrayContaining([['payment.paid', 'system:payments'], ['payment.refunded', 'system:payments']]))
  })

  it('a wrong amount or currency is rejected without granting anything', async () => {
    const buyer = await createUser(t.db, s.site.id, 'learner', 'underpaid')
    const payment = await createPayment(t.db, buyer, productId, 'mock')
    await attachProviderRef(t.db, payment.id, 'cs_2')
    expect(await applyPaymentEvent(t.db, { provider: 'mock', eventId: 'evt_3', type: 'paid', providerRef: 'cs_2', amountMinor: 100, currency: 'INR' })).toBe('rejected')
    expect((await getPayment(t.db, buyer, payment.id)).status).toBe('failed')
    expect(await canPlay(t.db, buyer, lockedId)).toBe(false)
  })

  it('events for unknown payments, or from another provider, change nothing', async () => {
    expect(await applyPaymentEvent(t.db, { provider: 'mock', eventId: 'evt_4', type: 'paid', providerRef: 'nope' })).toBe('unknown_payment')
    expect(await applyPaymentEvent(t.db, { provider: 'stripe', eventId: 'evt_5', type: 'paid', providerRef: 'cs_1' })).toBe('unknown_payment')
    expect(await applyPaymentEvent(t.db, { provider: 'mock', eventId: 'evt_6', type: 'refunded', providerPaymentRef: 'pi_1' })).toBe('ignored')
  })
})
