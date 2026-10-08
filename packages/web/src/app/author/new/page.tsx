import { emptyQuestionSet } from '@challengeforge/types'
import { QuestionSetEditor } from '@/components/author/QuestionSetEditor'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'New question set' }

export default async function NewQuestionSet() {
  await requirePageRole('author', '/author/new')
  return (
    <div className="space-y-6">
      <h1 className="text-4xl">New question set</h1>
      <QuestionSetEditor challengeId={null} initial={emptyQuestionSet()} />
    </div>
  )
}
