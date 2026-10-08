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

export type Role = 'learner' | 'author' | 'admin'
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
}

/** Generated is unused today (all ids are app-generated); kept for future auto columns. */
export type { Generated }
