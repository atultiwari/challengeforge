import { notFound } from 'next/navigation'
import { ForbiddenError, NotFoundError, getForAuthoring } from '@challengeforge/db'
import { authoringSchema, isFormAuthored, type QuestionSetDef } from '@challengeforge/types'
import { QuestionSetEditor } from '@/components/author/QuestionSetEditor'
import { SchemaDefinitionEditor } from '@/components/author/SchemaDefinitionEditor'
import type { JsonSchema } from '@/lib/schema-form/model'
import { WorkflowControls } from '@/components/author/WorkflowControls'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export default async function EditChallenge({
  params,
  searchParams,
}: {
  params: Promise<{ challengeId: string }>
  searchParams: Promise<{ saved?: string }>
}) {
  const [{ challengeId }, { saved }] = await Promise.all([params, searchParams])
  const scope = await requirePageRole('author', `/author/${challengeId}`)
  let challenge
  try {
    challenge = await getForAuthoring(db(), scope, challengeId)
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound()
    throw err
  }
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">{challenge.typeId}</p>
        <h1 className="text-4xl">{challenge.title}</h1>
      </header>
      {saved && (
        <p role="status" className="rounded-md bg-good-soft px-4 py-2 text-sm text-good">
          Saved{saved === '1' ? '' : ` as version ${saved}`}. Learners keep the published version until you publish this one.
        </p>
      )}
      <WorkflowControls
        challengeId={challenge.id}
        status={challenge.status}
        version={challenge.version}
        hasUnpublishedChanges={challenge.publishedVersionId !== challenge.versionId}
        canPublish={challenge.canPublish}
      />
      {challenge.typeId === 'question-set' ? (
        <QuestionSetEditor key={challenge.versionId} challengeId={challenge.id} initial={challenge.definition as QuestionSetDef} />
      ) : isFormAuthored(challenge.typeId) ? (
        <SchemaDefinitionEditor
          key={challenge.versionId}
          typeId={challenge.typeId}
          challengeId={challenge.id}
          schema={authoringSchema(challenge.typeId) as JsonSchema}
          initial={challenge.definition}
        />
      ) : (
        <p className="card text-ink-muted">
          This challenge came from a content pack. Edit it in the pack and re-import; you can preview and publish it here.
        </p>
      )}
    </div>
  )
}
