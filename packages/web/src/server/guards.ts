import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { hasRole, type Role, type Scope } from '@challengeforge/db'
import { currentScope } from './scope'

/** Page guard: sign-in first, then the role; the wrong role sees a 404, not a hint that the page exists. */
export async function requirePageRole(role: Role, returnTo: string): Promise<Scope> {
  const { scope } = await currentScope()
  if (!scope.principal) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`)
  if (!hasRole(scope, role)) notFound()
  return scope
}
