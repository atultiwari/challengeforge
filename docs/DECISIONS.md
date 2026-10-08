# Decision log

The owner asked (2026-10-08) for the work to continue without check-ins, with
every judgement call logged here for review at the end. Each entry says what
was decided, why, and how to reverse it. Newest last.

| # | Date | Decision | Why | To reverse |
|---|---|---|---|---|
| D1 | 2026-10-08 | **Production database is MariaDB 11.8.** It is the local dev engine, the E2E engine in CI, and part of the CI database matrix. 10.11 stays in CI as the supported floor, and MySQL 8.0 for other hosts. | Owner's `SELECT VERSION()` on Hostinger returned `11.8.9-MariaDB-log`. | Edit `.github/workflows/ci.yml` and `docker-compose.dev.yml`. |
| D2 | 2026-10-08 | Phase 3 milestone order: mail and audit, roles, organisations and cohorts, access and payments, certificates, analytics, LTI (docs/PHASE-3-PLAN.md). | Each later milestone builds on the earlier ones: cohorts grant access, payments create grants, certificates need passing rules, and LTI reuses grants and jobs. | Reorder the plan. Nothing is built ahead of its dependencies. |
| D3 | 2026-10-08 | **Mail has four modes:** `disabled`, `smtp`, `log` and `file`. It defaults to `disabled` on a production site, and `log`/`file` are refused there. | Reset links must never reach logs on a live site. Hostinger includes SMTP. | Set `MAIL_MODE=smtp` with the `SMTP_*` settings. |
| D4 | 2026-10-08 | The audit log is append-only, admin-readable, and written in the same transaction as the change wherever possible. The CLI is recorded as `system:cli`. | A log must never claim a change that rolled back. | — |
| D5 | 2026-10-08 | **Phase 3 work landed in commit `07eee7c`, under the message "docs: Phase 2 report and README status".** A blocked command left an old commit-message file in place. | Rewriting pushed history on `main` would need a force-push. Correcting it here is cheaper and safer. | — |
