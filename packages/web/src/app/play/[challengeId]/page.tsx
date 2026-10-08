import { redirect } from 'next/navigation'
import { notFound } from 'next/navigation'
import { NotFoundError, startOrResume } from '@challengeforge/db'
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
  const { scope } = await currentScope()
  if (!scope.principal) redirect(`/sign-in?next=${encodeURIComponent(`/play/${challengeId}`)}`)
  try {
    // Opening the page resumes the learner's open attempt (or starts one): idempotent.
    const snapshot = await startOrResume(db(), scope, attemptDeps, challengeId, { preview: preview === '1' })
    return <Player challengeId={challengeId} initial={snapshot} />
  } catch (err) {
    if (err instanceof NotFoundError) notFound()
    throw err
  }
}
