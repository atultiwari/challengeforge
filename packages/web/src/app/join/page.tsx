import { SimpleForm } from '@/components/common/SimpleForm'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Join a cohort' }

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams
  const prefill = typeof code === 'string' ? code.slice(0, 32) : ''
  await requirePageRole('learner', `/join${prefill ? `?code=${encodeURIComponent(prefill)}` : ''}`)
  return (
    <div className="space-y-6">
      <h1 className="text-center text-3xl">Join a cohort</h1>
      <div className="card mx-auto max-w-md">
        <SimpleForm
          url="/api/cohorts/join"
          submitLabel="Join"
          then={{ goTo: '/cohorts/{id}' }}
          fields={[{ name: 'code', label: 'Code from your instructor', type: 'text', required: true, maxLength: 32, value: prefill }]}
        />
      </div>
    </div>
  )
}
