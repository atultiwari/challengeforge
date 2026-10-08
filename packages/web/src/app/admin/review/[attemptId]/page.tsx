import { notFound } from 'next/navigation'
import { NotFoundError, getAttempt } from '@challengeforge/db'
import { ReviewForm } from '@/components/admin/ReviewForm'
import { AssessmentSummary } from '@/components/player/AssessmentSummary'
import { attemptDeps } from '@/server/attempt-deps'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Review a result' }

/** What the learner actually did (e.g. the whole conversation), next to the automatic result. */
export default async function ReviewPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params
  const scope = await requirePageRole('editor', `/admin/review/${attemptId}`)
  let attempt
  try {
    attempt = await getAttempt(db(), scope, attemptDeps, attemptId)
  } catch (err) {
    if (err instanceof NotFoundError) notFound()
    throw err
  }
  const view = attempt.view as { title?: string; transcript?: { role: string; content: string }[] }
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Review</p>
        <h1 className="text-3xl">{view.title ?? 'Result'}</h1>
      </header>
      {view.transcript && (
        <section className="card space-y-2" aria-label="Conversation">
          {view.transcript.map((turn, i) => (
            <p key={i} className={turn.role === 'user' ? 'whitespace-pre-wrap' : 'whitespace-pre-wrap text-ink-muted'}>
              <span className="font-semibold">{turn.role === 'user' ? 'Learner: ' : 'Bot: '}</span>
              {turn.content}
            </p>
          ))}
        </section>
      )}
      {attempt.assessment && <AssessmentSummary assessment={attempt.assessment} />}
      {attempt.assessment && <ReviewForm attemptId={attemptId} passed={attempt.assessment.passed} points={attempt.assessment.points} />}
    </div>
  )
}
