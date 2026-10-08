import type { ChallengeStats } from '@challengeforge/db'
import { percent } from '@/lib/stats-csv'

/** One row per challenge: how many tried, finished and passed, and what is most often missed. */
export function StatsTable({ stats }: { stats: readonly ChallengeStats[] }) {
  if (stats.length === 0) return <p className="text-ink-muted">Nothing to show yet.</p>
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="min-w-full text-sm">
        <caption className="sr-only">Results per challenge</caption>
        <thead>
          <tr className="border-b border-line text-left">
            {['Challenge', 'Learners', 'Attempts', 'Finished', 'Pass rate', 'Median time', 'For review', 'Most missed'].map((h) => (
              <th key={h} scope="col" className="px-3 py-2">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.challengeId} className="border-b border-line align-top last:border-0">
              <th scope="row" className="px-3 py-2 text-left font-medium">{s.title}</th>
              <td className="px-3 py-2">{s.learners}</td>
              <td className="px-3 py-2">{s.attempts}</td>
              <td className="px-3 py-2">{s.finished}</td>
              <td className="px-3 py-2">{percent(s.passRate)}</td>
              <td className="px-3 py-2">{s.medianMinutes === null ? '–' : `${s.medianMinutes} min`}</td>
              <td className="px-3 py-2">{s.pendingReview}</td>
              <td className="px-3 py-2">{s.criteria[0] && s.criteria[0].missed > 0 ? `${s.criteria[0].label} (${percent(s.criteria[0].missRate)})` : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Every criterion of one challenge, most-missed first. */
export function CriteriaTable({ stats }: { stats: ChallengeStats }) {
  if (stats.criteria.length === 0) return <p className="text-ink-muted">No finished attempts yet.</p>
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="min-w-full text-sm">
        <caption className="sr-only">How often each criterion was missed</caption>
        <thead>
          <tr className="border-b border-line text-left">
            {['Criterion', 'Assessed', 'Missed', 'Miss rate'].map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {stats.criteria.map((c) => (
            <tr key={c.id} className="border-b border-line last:border-0">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {c.label}
                {c.critical && <span className="ml-2 pill bg-danger-soft text-danger">critical</span>}
              </th>
              <td className="px-3 py-2">{c.assessed}</td>
              <td className="px-3 py-2">{c.missed}</td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="inline-block h-2 rounded bg-danger" style={{ width: `${Math.max(2, Math.round(c.missRate * 80))}px` }} />
                  {percent(c.missRate)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
