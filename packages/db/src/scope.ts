/**
 * Authorisation lives here, in the application layer (PLAN.md §6.3). Every
 * repository function takes a Scope as its first argument and builds its
 * own WHERE clauses from it; nothing outside this package gets a raw query.
 */
import type { Role } from './schema'

export interface Principal {
  userId: string
  role: Role
}

export interface Scope {
  siteId: string
  /** null = not signed in. */
  principal: Principal | null
}

export class ForbiddenError extends Error {
  readonly code = 'forbidden'
  constructor(message = 'You do not have permission to do that.') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends Error {
  readonly code = 'not_found'
  constructor(message = 'Not found.') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  readonly code = 'invalid'
  constructor(
    message: string,
    readonly issues: readonly { path: string; severity: string; message: string }[] = [],
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

const RANK: Record<Role, number> = { learner: 1, author: 2, editor: 3, admin: 4 }

export function requireSignedIn(scope: Scope): Principal {
  if (!scope.principal) throw new ForbiddenError('Sign in first.')
  return scope.principal
}

export function requireRole(scope: Scope, minimum: Role): Principal {
  const p = requireSignedIn(scope)
  if (RANK[p.role] < RANK[minimum]) throw new ForbiddenError()
  return p
}

export const hasRole = (scope: Scope, minimum: Role): boolean =>
  scope.principal !== null && RANK[scope.principal.role] >= RANK[minimum]
