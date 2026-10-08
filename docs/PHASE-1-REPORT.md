# Phase 1 report: single-site MVP

**Date:** 2026-10-08 · **Status:** built and verified locally and in CI.
**Deployment to Hostinger is waiting on the owner** (credentials and the database version).
The owner asked to continue straight into Phase 2.

## Exit criteria (PLAN.md §8, docs/PHASE-1-PLAN.md)

| Milestone | Result |
|---|---|
| M1 `packages/db` | Done. Kysely + mysql2, scoped repositories and the atomic attempt service. **38 integration tests pass on MySQL 8.0 and on MariaDB 10.11**, locally and in CI. They cover the authz matrix, races, idempotency and version pinning. |
| M2 `question-set` | Done: single, multi, numeric and short-text items, with partial credit and lint. |
| M3 Packs + import | Done. Pack format v1, an idempotent importer that validates everything before writing, and the operator CLI. **The Clinical AI Level 1 pack (B1–B7) lives in the private repo** `atultiwari/challengeforge-pack-clinical-ai`; its converter uses the Lab's own YAML parser. |
| M4 Auth | Done. Better Auth (email + password) on the same database, roles per site, and CLI `create-admin` / `reset-password`. |
| M5 Player | Done. The Lab's 4 Level 1 interactions are ported, plus a question-set player. All 7 Lab missions were played in the browser against the real pack. |
| M6 Authoring | Done. The question-set form has lint as you type, preview as learner, draft → review → publish, immutable versions, and an admin page for people and roles. |
| M7 Hardening | Done. Nonce CSP, security headers, a same-origin check on every POST (including sign-in), rate limits, DB-stored assets limited to safe types, sandboxed asset responses, and safe Markdown. **Playwright E2E (3 tests) runs locally and in CI.** |
| M8 Deploy | **Built, not yet deployed.** `pnpm release` produces one archive (Next standalone + a single-file CLI), verified running as `node server.js` under the production CSP. See docs/DEPLOY-HOSTINGER.md. |

**Tests:**
- 251 unit tests: 99% lines and 91% branches across engine and types.
- 38 database tests on each engine.
- 3 E2E tests.
- CI runs all of these on every push.

## Reviews at the phase boundary

**Security review: no CRITICAL or HIGH findings.** Fixed:

- asset content types are allow-listed (no HTML or SVG), and asset responses are sandboxed;
- our own origin check and per-address limit sit in front of Better Auth's sign-in and sign-up;
- the backslash open redirect (`/\evil.com`) is closed, with tests;
- a page GET no longer creates attempts (starting one is a POST);
- request bodies are capped by bytes, including the declared `content-length`;
- authors may read assets only for their own challenges (admins for all);
- the pack loader resolves symlinks before its "inside the pack" check.

**Code review.** Fixed:

- "Try again" carried the previous answers over. Players are now keyed per attempt, and E2E checks it.
- Number fields swallowed decimals and minus signs. They now keep the typed text, verified in the browser.
- Parallel starts could create two open attempts. Starts are now serialised per person, with a test.
- Parallel draft saves could deadlock. The challenge row is locked first, and saves retry on deadlock, with a test.
- `publish` is now atomic.
- A second pack can no longer take over another pack's challenge, with a test.
- The importer pre-checks every asset, skips archived challenges, skips re-uploading unchanged assets (by hash), and publishes only what changed. Tests cover these.
- The editor's save no longer hangs on a network or 502 error, out-of-order lint replies are ignored, and "Saved" survives the refresh.
- Preview by a non-owner returns a 404, not a 500, and keeps `?preview=1` through sign-in.
- An attempt that is over at start still gets graded.
- The migration is re-runnable (`IF NOT EXISTS`).
- Question-set lint now catches duplicate option ids and repeated correct answers.
- Lock-wait timeouts are no longer retried.
- `publish-pack` skips archived challenges.

## Deliberately deferred

| Item | Why | When |
|---|---|---|
| Email verification, password-reset email, captcha on sign-up | No outgoing email yet; the CLI `reset-password` covers operators | Phase 3 |
| Audit log for role changes and publishing | Single-admin sites for now | Phase 3 |
| Better Auth's own limiter IP header | Depends on Hostinger's proxy layout; our own limiter is in front of it | At deploy |
| Attempts continue after a challenge is archived | Acceptable: no data loss, and the learner finishes what they started | Revisit with cohorts |
| Generic schema-driven author form | Generalise once `diagnostic-sim` is the second authored type | Phase 2 |

## Waiting on the owner

1. **Hostinger:** run `SELECT VERSION()`, ask support about the request timeout, and supply credentials to deploy, or follow docs/DEPLOY-HOSTINGER.md yourself.
2. **Clinical sign-off** of the Level 1 missions (all still *draft* in the Lab) before publishing them on a live site.
3. **Clinical sign-off** of the DKA diagnostic case (Phase 0 fixture), which Phase 2 builds on.
