import Link from 'next/link'
import { listMyCohorts, listMyProgress, listPlayable, lockedChallengeIds, type ChallengeSummary, type Cohort, type ProgressRow } from '@challengeforge/db'
import { db } from '@/server/db'
import { currentScope } from '@/server/scope'

function groupBySection(challenges: readonly ChallengeSummary[]): [string, ChallengeSummary[]][] {
  const groups = new Map<string, ChallengeSummary[]>()
  for (const c of challenges) {
    const key = c.sectionTitle ?? c.packTitle ?? 'Challenges'
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  return [...groups.entries()]
}

export default async function CatalogPage() {
  const { scope, user } = await currentScope()
  const [challenges, progress, cohorts] = await Promise.all([
    listPlayable(db(), scope),
    user ? listMyProgress(db(), scope) : Promise.resolve([] as ProgressRow[]),
    user ? listMyCohorts(db(), scope).then((c) => c.learning) : Promise.resolve([] as Cohort[]),
  ])
  const byChallenge = new Map(progress.map((p) => [p.challengeId, p]))
  const locked = await lockedChallengeIds(db(), scope, challenges)

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <p className="eyebrow">Challenges</p>
        <h1 className="text-4xl">Learn by doing</h1>
        {!user && (
          <p className="text-ink-muted">
            <Link className="underline" href="/sign-in">Sign in</Link> to play and keep your progress.
          </p>
        )}
      </header>
      {user && (
        <section className="space-y-2" aria-labelledby="my-cohorts">
          <h2 id="my-cohorts" className="text-2xl">Your cohorts</h2>
          {cohorts.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {cohorts.map((c) => (
                <li key={c.id}><Link href={`/cohorts/${c.id}`} className="btn-secondary">{c.name}</Link></li>
              ))}
            </ul>
          )}
          <p className="text-sm"><Link className="underline" href="/join">Join a cohort with a code</Link></p>
        </section>
      )}
      {challenges.length === 0 && <p className="card">No challenges have been published yet.</p>}
      {groupBySection(challenges).map(([section, items]) => (
        <section key={section} className="space-y-3" aria-labelledby={`s-${section}`}>
          <h2 id={`s-${section}`} className="text-2xl">{section}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((c) => {
              const p = byChallenge.get(c.id)
              return (
                <li key={c.id}>
                  <Link href={`/play/${c.id}`} className="card block transition-colors hover:border-accent">
                    <p className="font-semibold">{c.title}</p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {locked.has(c.id) ? 'Locked · needs access' : p ? (p.passed ? `Passed · ${p.bestPoints} points` : `Attempted ${p.attempts}×`) : 'Not started'}
                    </p>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
