import type { ProgressGrid } from '@challengeforge/db'

const cellText = (c: { passed: boolean; attempts: number; bestPoints: number; late: boolean }) =>
  c.passed ? `✓ ${c.bestPoints}${c.late ? ' (late)' : ''}` : c.attempts > 0 ? `${c.attempts} tries${c.late ? ', overdue' : ''}` : c.late ? 'overdue' : '–'

/** Learners down the side, assigned challenges across the top. Text labels, not colour alone. */
export function ProgressGridTable({ grid }: { grid: ProgressGrid }) {
  if (grid.rows.length === 0) return <p className="text-ink-muted">No learners have joined yet.</p>
  if (grid.columns.length === 0) return <p className="text-ink-muted">Nothing is assigned yet.</p>
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="min-w-full text-sm">
        <caption className="sr-only">Progress of each learner on each assigned challenge</caption>
        <thead>
          <tr className="border-b border-line text-left">
            <th scope="col" className="px-3 py-2">Learner</th>
            <th scope="col" className="px-3 py-2">Passed</th>
            {grid.columns.map((c) => (
              <th key={c.challengeId} scope="col" className="px-3 py-2 font-medium">
                {c.title}
                {c.dueAt && <span className="block text-xs font-normal text-ink-muted">due {c.dueAt.toISOString().slice(0, 10)}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((r) => (
            <tr key={r.userId} className="border-b border-line last:border-0">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {r.name}
                <span className="block text-xs font-normal text-ink-muted">{r.email}</span>
              </th>
              <td className="px-3 py-2">{r.passedCount}/{grid.columns.length}</td>
              {grid.columns.map((c) => {
                const cell = r.cells[c.challengeId]!
                return (
                  <td key={c.challengeId} className={`px-3 py-2 ${cell.passed ? 'text-good' : cell.late ? 'text-danger' : 'text-ink-muted'}`}>
                    {cellText(cell)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
