import { notFound, redirect } from 'next/navigation'
import { ForbiddenError, NotFoundError, canPlay, findOpenAttempt, getForAuthoring, getPlayable, listPacks, listProducts } from '@challengeforge/db'
import { LockedNotice } from '@/components/payments/LockedNotice'
import { paymentProvider } from '@/server/payments'
import { Player } from '@/components/player/Player'
import { attemptDeps } from '@/server/attempt-deps'
import { db } from '@/server/db'
import { currentScope } from '@/server/scope'

export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ challengeId: string }>
  searchParams: Promise<{ preview?: string }>
}) {
  const [{ challengeId }, { preview }] = await Promise.all([params, searchParams])
  const isPreview = preview === '1'
  const { scope } = await currentScope()
  if (!scope.principal) {
    const back = `/play/${challengeId}${isPreview ? '?preview=1' : ''}`
    redirect(`/sign-in?next=${encodeURIComponent(back)}`)
  }
  if (!isPreview && !(await canPlay(db(), scope, challengeId))) {
    let challenge
    try {
      challenge = await getPlayable(db(), scope, challengeId)
    } catch (err) {
      if (err instanceof NotFoundError) notFound()
      throw err
    }
    const packId = challenge.packId
    const [packs, products] = await Promise.all([listPacks(db(), scope), listProducts(db(), scope)])
    return (
      <LockedNotice
        title={challenge.title}
        packTitle={packs.find((p) => p.id === packId)?.title ?? null}
        product={products.find((p) => p.packId === packId) ?? null}
        canBuy={paymentProvider() !== null}
      />
    )
  }
  try {
    // A GET only RESUMES an attempt; starting one is a POST (a link cannot start attempts).
    const [challenge, open] = await Promise.all([
      isPreview ? getForAuthoring(db(), scope, challengeId) : getPlayable(db(), scope, challengeId),
      findOpenAttempt(db(), scope, attemptDeps, challengeId, { preview: isPreview }),
    ])
    return <Player challengeId={challengeId} title={challenge.title} preview={isPreview} initial={open} />
  } catch (err) {
    // Someone who may not see a challenge (or its draft) gets the same 404 as for one that does not exist.
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound()
    throw err
  }
}
