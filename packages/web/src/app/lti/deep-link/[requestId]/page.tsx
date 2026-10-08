import { notFound } from 'next/navigation'
import { getDeepLinkRequest, listPlayable } from '@challengeforge/db'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Add activities to your course' }

/** A teacher launched "add content" from their LMS: they pick challenges to place in the course. */
export default async function DeepLinkPicker({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params
  const scope = await requirePageRole('learner', `/lti/deep-link/${requestId}`)
  const request = await getDeepLinkRequest(db(), scope.siteId, requestId, scope.principal!.userId)
  if (!request) notFound()
  const challenges = await listPlayable(db(), scope)
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Add to your course</p>
        <h1 className="text-4xl">Choose challenges</h1>
        <p className="text-ink-muted">Each one becomes an activity in your course, with a grade column out of 100. Scores go back to the LMS when learners finish.</p>
      </header>
      <form method="post" action={`/lti/deep-link/${requestId}/return`} className="space-y-4">
        <fieldset className="card space-y-2">
          <legend className="font-semibold">Published challenges</legend>
          {challenges.length === 0 && <p className="text-ink-muted">Nothing is published yet.</p>}
          {challenges.map((c) => (
            <label key={c.id} className="flex items-start gap-3 py-1">
              <input type="checkbox" name="challenge" value={c.id} className="mt-1" />
              <span>
                <span className="font-medium">{c.title}</span>
                {(c.packTitle || c.sectionTitle) && <span className="block text-sm text-ink-muted">{[c.packTitle, c.sectionTitle].filter(Boolean).join(' · ')}</span>}
              </span>
            </label>
          ))}
        </fieldset>
        <button type="submit" className="btn-primary">Add to course</button>
      </form>
    </div>
  )
}
