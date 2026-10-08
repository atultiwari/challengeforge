import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ForbiddenError, NotFoundError, getOrganisation, hasRole, listOrgMembers } from '@challengeforge/db'
import { PostButton } from '@/components/common/PostButton'
import { SimpleForm } from '@/components/common/SimpleForm'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Organisation' }

export default async function OrganisationPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params
  const scope = await requirePageRole('learner', `/teach/orgs/${orgId}`)
  let org, members
  try {
    org = await getOrganisation(db(), scope, orgId)
    members = await listOrgMembers(db(), scope, orgId)
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound()
    throw err
  }
  const manages = org.role === 'org_admin'
  const siteAdmin = hasRole(scope, 'admin')
  const roles = [['instructor', 'Instructor'], ['member', 'Member'], ...(siteAdmin ? [['org_admin', 'Organisation admin'] as const] : [])] as const
  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow"><Link href="/teach" className="hover:underline">Teach</Link></p>
        <h1 className="text-4xl">{org.name}</h1>
      </header>
      <section className="space-y-3">
        <h2 className="text-2xl">People</h2>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="mr-auto"><span className="font-semibold">{m.name}</span> <span className="text-sm text-ink-muted">{m.email}</span></span>
              <span className="pill bg-surface-sunken text-ink-muted">{m.role.replace('_', ' ')}</span>
              {manages && (m.role !== 'org_admin' || siteAdmin) && m.userId !== scope.principal?.userId && (
                <PostButton url={`/api/orgs/${orgId}/members/remove`} body={{ userId: m.userId }} label="Remove" confirm={`Remove ${m.name} from ${org.name}?`} />
              )}
            </li>
          ))}
        </ul>
      </section>
      {manages && (
        <section className="card max-w-lg space-y-3">
          <h2 className="text-xl">Add or change someone&apos;s role</h2>
          <p className="text-sm text-ink-muted">They need an account on this site first. Learners join through a cohort code instead.</p>
          <SimpleForm
            url={`/api/orgs/${orgId}/members`}
            submitLabel="Save role"
            fields={[
              { name: 'email', label: 'Email', type: 'email', required: true, maxLength: 254 },
              { name: 'role', label: 'Role', type: 'select', required: true, options: roles },
            ]}
          />
        </section>
      )}
    </div>
  )
}
