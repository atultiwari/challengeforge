/**
 * Kysely table types. JSON columns are typed `unknown` on read because MySQL
 * returns parsed JSON and MariaDB returns a string; always read them through
 * `fromJson` (json.ts) and write them with `toJson`.
 */
import type { ColumnType, Generated } from 'kysely'

type Json = ColumnType<unknown, string, string>
type Timestamp = ColumnType<Date, Date, Date>
type NullableTimestamp = ColumnType<Date | null, Date | null, Date | null>
/** MySQL BOOLEAN is TINYINT(1): reads back as 0/1. */
type Bool = ColumnType<number | boolean, boolean, boolean>

export type Role = 'learner' | 'author' | 'editor' | 'admin'
export type ChallengeStatus = 'draft' | 'in_review' | 'published' | 'archived'

export interface SitesTable {
  id: string
  slug: string
  name: string
  created_at: Timestamp
}

/** Better Auth core tables (camelCase columns are its convention). */
export interface UserTable {
  id: string
  name: string
  email: string
  emailVerified: Bool
  image: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface SessionTable {
  id: string
  expiresAt: Timestamp
  token: string
  createdAt: Timestamp
  updatedAt: Timestamp
  ipAddress: string | null
  userAgent: string | null
  userId: string
}

export interface AccountTable {
  id: string
  accountId: string
  providerId: string
  userId: string
  accessToken: string | null
  refreshToken: string | null
  idToken: string | null
  accessTokenExpiresAt: NullableTimestamp
  refreshTokenExpiresAt: NullableTimestamp
  scope: string | null
  password: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface VerificationTable {
  id: string
  identifier: string
  value: string
  expiresAt: Timestamp
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface MembershipsTable {
  site_id: string
  user_id: string
  role: Role
  created_at: Timestamp
}

export interface PacksTable {
  id: string
  site_id: string
  slug: string
  title: string
  description: string
  /** Defaults to open; restricted packs need a grant or a cohort assignment. */
  access: ColumnType<PackAccess, PackAccess | undefined, PackAccess>
  certificates_enabled: ColumnType<number | boolean, boolean | undefined, boolean>
  created_at: Timestamp
}

export interface PackSectionsTable {
  id: string
  pack_id: string
  slug: string
  title: string
  position: number
}

export interface ChallengesTable {
  id: string
  site_id: string
  pack_id: string | null
  section_id: string | null
  slug: string
  type_id: string
  type_version: number
  title: string
  status: ChallengeStatus
  position: number
  /** The version learners play; null until first published. */
  published_version_id: string | null
  created_by: string | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface ChallengeVersionsTable {
  id: string
  challenge_id: string
  version: number
  definition: Json
  created_by: string | null
  created_at: Timestamp
}

export interface AssetsTable {
  id: string
  site_id: string
  pack_id: string | null
  challenge_id: string | null
  path: string
  content_type: string
  visibility: 'public' | 'gated'
  bytes: Buffer
  sha256: string
  created_at: Timestamp
}

export interface AttemptsTable {
  id: string
  site_id: string
  user_id: string
  challenge_id: string
  challenge_version_id: string
  type_id: string
  type_version: number
  /** Preview attempts (authors trying a draft) never count towards progress. */
  is_preview: Bool
  seed: number
  seq: number
  status: 'open' | 'terminal'
  state: Json
  started_at: Timestamp
  updated_at: Timestamp
  ended_at: NullableTimestamp
  /** Set while the attempt waits on a model call made outside any transaction. */
  pending_action: ColumnType<unknown, string | null | undefined, string | null>
  pending_key: string | null
  pending_since: NullableTimestamp
}

export interface AttemptEventsTable {
  attempt_id: string
  seq: number
  action: Json
  effects: ColumnType<unknown, string | null, string | null>
  at: Timestamp
  idempotency_key: string | null
}

export interface AssessmentsTable {
  attempt_id: string
  criteria: Json
  score: number
  max: number
  passed: Bool
  critical_failure: Bool
  status: 'auto' | 'pending_review' | 'overridden'
  points: number
  reviewer_id: string | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface ProgressTable {
  site_id: string
  user_id: string
  challenge_id: string
  attempts: number
  best_points: number
  best_score_fraction: number
  passed_at: NullableTimestamp
  updated_at: Timestamp
}

export interface LlmCallCountersTable {
  site_id: string
  user_id: string
  challenge_id: string
  purpose: string
  used: number
}

export type CredentialSource = 'platform' | 'byok' | 'oauth'

export interface LlmUsageTable {
  id: string
  site_id: string
  user_id: string
  challenge_id: string
  purpose: string
  provider: string
  model: string
  credential_source: CredentialSource
  status: 'reserved' | 'completed'
  input_tokens: number
  output_tokens: number
  /** DECIMAL: mysql2 returns it as a string. */
  cost_estimate_usd: ColumnType<string | null, number | null, number | null>
  request_id: string | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface LlmCredentialsTable {
  site_id: string
  user_id: string
  provider: string
  ciphertext: string
  iv: string
  auth_tag: string
  last4: string
  created_at: Timestamp
  updated_at: Timestamp
}

export interface JobsTable {
  id: string
  site_id: string
  user_id: string
  attempt_id: string
  kind: string
  status: 'queued' | 'running' | 'done' | 'failed'
  request: Json
  action: Json
  idempotency_key: string | null
  progress: ColumnType<unknown, string | null, string | null>
  error: string | null
  failures: number
  lease_until: NullableTimestamp
  lease_token: string | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface Database {
  sites: SitesTable
  user: UserTable
  session: SessionTable
  account: AccountTable
  verification: VerificationTable
  memberships: MembershipsTable
  packs: PacksTable
  pack_sections: PackSectionsTable
  challenges: ChallengesTable
  challenge_versions: ChallengeVersionsTable
  assets: AssetsTable
  attempts: AttemptsTable
  attempt_events: AttemptEventsTable
  assessments: AssessmentsTable
  progress: ProgressTable
  llm_call_counters: LlmCallCountersTable
  llm_usage: LlmUsageTable
  llm_credentials: LlmCredentialsTable
  jobs: JobsTable
  audit_log: AuditLogTable
  challenge_collaborators: ChallengeCollaboratorsTable
  organisations: OrganisationsTable
  org_members: OrgMembersTable
  cohorts: CohortsTable
  cohort_members: CohortMembersTable
  cohort_assignments: CohortAssignmentsTable
  access_grants: AccessGrantsTable
  products: ProductsTable
  payments: PaymentsTable
  payment_events: PaymentEventsTable
  certificates: CertificatesTable
}

export type PackAccess = 'open' | 'restricted'
export type GrantSource = 'admin' | 'payment' | 'lti'
export type PaymentStatus = 'created' | 'paid' | 'refunded' | 'failed'

export interface AccessGrantsTable {
  id: string
  site_id: string
  user_id: string
  pack_id: string
  source: GrantSource
  source_ref: string
  expires_at: NullableTimestamp
  revoked_at: NullableTimestamp
  created_at: Timestamp
}

export interface ProductsTable {
  id: string
  site_id: string
  pack_id: string
  /** In the currency's minor unit (paise, cents). */
  price_minor: number
  currency: string
  active: Bool
  created_at: Timestamp
  updated_at: Timestamp
}

export interface PaymentsTable {
  id: string
  site_id: string
  user_id: string
  product_id: string
  pack_id: string
  provider: string
  /** The provider's checkout id (Stripe session, Razorpay payment link). */
  provider_ref: string | null
  /** The provider's payment/charge id, learned when it is paid; refunds refer to it. */
  provider_payment_ref: string | null
  amount_minor: number
  currency: string
  status: PaymentStatus
  created_at: Timestamp
  updated_at: Timestamp
}

export interface CertificatesTable {
  /** Random and unguessable: holding the id is what lets someone verify it. */
  id: string
  site_id: string
  user_id: string
  pack_id: string
  recipient_name: string
  pack_title: string
  site_name: string
  challenge_count: number
  issued_at: Timestamp
  revoked_at: NullableTimestamp
  revoke_reason: string | null
}

export interface PaymentEventsTable {
  provider: string
  event_id: string
  type: string
  received_at: Timestamp
}

export type OrgRole = 'member' | 'instructor' | 'org_admin'
export type CohortRole = 'learner' | 'instructor'

export interface OrganisationsTable {
  id: string
  site_id: string
  slug: string
  name: string
  created_at: Timestamp
}

export interface OrgMembersTable {
  org_id: string
  user_id: string
  site_id: string
  role: OrgRole
  created_at: Timestamp
}

export interface CohortsTable {
  id: string
  site_id: string
  org_id: string
  name: string
  join_code: string
  joining_open: Bool
  archived: Bool
  created_by: string
  created_at: Timestamp
}

export interface CohortMembersTable {
  cohort_id: string
  user_id: string
  site_id: string
  role: CohortRole
  joined_at: Timestamp
}

export interface CohortAssignmentsTable {
  id: string
  cohort_id: string
  site_id: string
  pack_id: string | null
  challenge_id: string | null
  due_at: NullableTimestamp
  position: number
  created_at: Timestamp
}

export interface ChallengeCollaboratorsTable {
  challenge_id: string
  user_id: string
  site_id: string
  added_by: string
  created_at: Timestamp
}

export interface AuditLogTable {
  id: string
  site_id: string
  /** A user id, or `system:<source>` for the CLI and webhooks. */
  actor_id: string
  action: string
  target_type: string
  target_id: string
  details: ColumnType<unknown, string | null, string | null>
  created_at: Timestamp
}

/** Generated is unused today (all ids are app-generated); kept for future auto columns. */
export type { Generated }
