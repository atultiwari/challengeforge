export interface Issue {
  path: string
  severity: 'error' | 'warning' | string
  message: string
}

/** "items.2.options.1.text" → "Question 3 · options 2 · text": paths in words an author recognises. */
function describePath(path: string): string {
  if (path === '') return 'Challenge'
  return path
    .replace(/^items\.(\d+)/, (_, n: string) => `Question ${Number(n) + 1}`)
    .replace(/\.(\d+)/g, (_, n: string) => ` ${Number(n) + 1}`)
    .replaceAll('.', ' · ')
    .replaceAll('_', ' ')
}

/** Problems found by the type's schema and lint, in words an author can act on. */
export function IssuesList({ issues }: { issues: readonly Issue[] }) {
  if (issues.length === 0) return <p className="text-sm text-good">No problems found.</p>
  return (
    <section aria-live="polite" className="card space-y-2">
      <h2 className="eyebrow">Check before publishing</h2>
      <ul className="space-y-1 text-sm">
        {issues.map((issue, i) => (
          <li key={`${issue.path}-${i}`} className={issue.severity === 'error' ? 'text-danger' : 'text-warn'}>
            <span className="font-semibold">{describePath(issue.path)}</span>
            {': '}
            {issue.message}
          </li>
        ))}
      </ul>
    </section>
  )
}
