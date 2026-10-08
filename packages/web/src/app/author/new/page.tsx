import { emptyQuestionSet, authoringSchema, isFormAuthored, starterDefinition, type QuestionSetDef } from '@challengeforge/types'
import { notFound } from 'next/navigation'
import { QuestionSetEditor } from '@/components/author/QuestionSetEditor'
import { SchemaDefinitionEditor } from '@/components/author/SchemaDefinitionEditor'
import type { JsonSchema } from '@/lib/schema-form/model'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'New challenge' }

const TITLES: Record<string, string> = { 'question-set': 'New question set', 'diagnostic-sim': 'New diagnostic case' }

export default async function NewChallenge({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type = 'question-set' } = await searchParams
  await requirePageRole('author', `/author/new?type=${encodeURIComponent(type)}`)
  if (!isFormAuthored(type)) notFound()
  return (
    <div className="space-y-6">
      <h1 className="text-4xl">{TITLES[type] ?? 'New challenge'}</h1>
      {type === 'question-set' ? (
        <QuestionSetEditor challengeId={null} initial={emptyQuestionSet() as QuestionSetDef} />
      ) : (
        <SchemaDefinitionEditor typeId={type} challengeId={null} schema={authoringSchema(type) as JsonSchema} initial={starterDefinition(type)} />
      )}
    </div>
  )
}
