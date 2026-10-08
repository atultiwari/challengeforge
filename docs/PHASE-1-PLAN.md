# Phase 1 plan: single-site MVP

Goal (PLAN.md §8): Clinical AI Level 1 (B1–B7) playable on MySQL/MariaDB,
plus one authorable type (`question-set`), deployed to Hostinger.

## Milestones (each ends green and committed)

| # | Milestone | Done when |
|---|---|---|
| M1 | `packages/db` | Kysely + mysql2, migrations, scoped repositories, atomic attempt service. Integration tests pass on **MySQL 8.0 and MariaDB 10.11** (Docker). Authz matrix tests. |
| M2 | `question-set` type | Static type: single, multi, numeric and short-text items with per-item feedback and weights. Pure, tested. |
| M3 | Pack format + import | `pack.json` format, `apps/cli import-pack`, and the private Clinical AI converter (B1–B7 → `lab-legacy`). Assets are stored in the DB. |
| M4 | Auth | Better Auth (email + password) on the same DB. Roles via `memberships` (learner, author, admin). `cli create-admin`. |
| M5 | Player | Next.js app: challenge list by pack section, attempt page, the 4 ported Lab interactions + a question-set player, hints / reveal / feedback / debrief, progress. |
| M6 | Authoring | Question-set author form with lint, preview-as-learner, draft → in review → published, and immutable versions. Minimal admin (users, roles). |
| M7 | Hardening | Gated asset route, sanitised Markdown, rate limits on write endpoints, security headers, CSRF (same-origin check), E2E happy path (Playwright). |
| M8 | Deploy | Standalone build → archive script, `docs/DEPLOY-HOSTINGER.md` runbook (env, migrations, cron, backups). CI database matrix. |

## Design calls made for Phase 1

- **Assets live in the database** (MEDIUMBLOB, ≤ 16 MB each). The app directory
  on Hostinger is replaced on each deploy, so files on disk are not durable.
  Small assets (the largest Level 1 dataset is 444 KB) fit comfortably.
- **JSON columns are read defensively.** MariaDB's `JSON` is `LONGTEXT` with a
  validity check, so mysql2 returns a string there and a parsed object on
  MySQL. `packages/db` normalises both.
- **Ids are UUIDs generated in the app**: portable, with no reliance on
  engine-specific defaults.
- **One open attempt per learner per challenge.** "Try again" after the
  attempt ends opens a new attempt. Progress keeps the best result.
- **The question-set author form is hand-built for Phase 1.** The generic
  schema-driven renderer (PLAN.md §3.8) arrives with `diagnostic-sim`
  authoring in Phase 2, when there are two types to generalise from.
