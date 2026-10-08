import type { PublicAssessment } from '@challengeforge/db'

/** The criterion-by-criterion result, shown once an attempt has ended. */
export function AssessmentSummary({ assessment }: { assessment: PublicAssessment }) {
  const pct = assessment.max > 0 ? Math.round((assessment.score / assessment.max) * 100) : 0
  return (
    <section className="card space-y-4" aria-labelledby="result-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="result-heading" className="text-2xl">
          {assessment.passed ? 'Passed' : 'Not passed this time'}
        </h2>
        <p className="font-mono text-sm text-ink-muted">
          {pct}% · {assessment.points} points
        </p>
      </div>
      {assessment.criticalFailure && (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          A critical safety step was missed, so this attempt cannot pass whatever the score.
        </p>
      )}
      {assessment.status === 'pending_review' && <p className="text-sm text-ink-muted">An instructor will review this result.</p>}
      <ul className="divide-y divide-line">
        {assessment.criteria.map((c) => (
          <li key={c.id} className="flex gap-3 py-2">
            <span aria-hidden className={c.passed ? 'text-good' : 'text-danger'}>
              {c.passed ? '✓' : '✗'}
            </span>
            <div className="flex-1">
              <p className="font-semibold">
                {c.label}
                {c.max > 0 && (
                  <span className="ml-2 font-mono text-xs text-ink-muted">
                    {Math.round(c.score * 10) / 10}/{c.max}
                  </span>
                )}
              </p>
              {c.feedback && <p className="text-sm text-ink-muted">{c.feedback}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
