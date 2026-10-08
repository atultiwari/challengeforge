# Phase 2 report: interactive in the product

**Date:** 2026-10-08 · **Status:** built and verified locally. CI runs on every push.
**Not yet deployed.** Hostinger still needs the owner's credentials. AI missions
have run only on the mock provider so far; live keys are the owner's.
Per the owner's instruction, Phase 3 starts next without a pause.

## Exit criteria (docs/PHASE-2-PLAN.md)

| Milestone | Result |
|---|---|
| P1 Diagnostic-sim player | **Done.** A learner can work up the DKA case in the browser: search-to-reveal, a simulated clock with pending results, deterioration alerts, a differential, a diagnosis, and a criterion-by-criterion debrief. E2E covers it. |
| P2 Schema-driven author forms | **Done.** A generic form is rendered from each type's JSON Schema, with lint inline. **A clinician can author a `diagnostic-sim` case** with it; verified in the browser by creating a case from a starter. |
| P3 Level 2 content | **Done.** I1–I6 import and play. Datasets come from each challenge's own assets (5 MB cap, cached by hash). I7 stays deferred. |
| P4 LLM gateway on MySQL | **Done.** Providers, caps, a platform budget, BYOK (AES-GCM), a judge with injection defences, and a mock provider. Call reservation is atomic. Platform keys refuse unpriced models. 142 gateway tests. |
| P5 Chat missions (A1) | **Done.** The server records the transcript. Each attempt has its own canary, substituted server-side. Goals are judged. No lock is held across a model call. |
| P6 Jobs + prompt hardening (A4) | **Done.** Resumable jobs run in bounded slices, advanced by the learner's page or by `cli run-jobs` from cron. Leases carry tokens. The battery evaluation runs as a job. |
| P7 Level 3 + review queue | **Done.** A1–A4, A6 and A7 convert and import; A5 is deferred. Assessments in `pending_review` show in an admin queue with an instructor override. |
| P8 Pack export | **Done.** `cli export-pack` writes the published version of each challenge. A round-trip test re-imports it identically. It refuses to write inside a git work tree. |

**Tests:**
- 435 unit tests; 98% lines and 89% branches on the measured packages.
- 69 database tests on each engine: **MySQL 8.0 and MariaDB 10.11**.
- 6 Playwright E2E tests: learner, diagnostic sim, chat mission, prompt hardening, access control and cross-site refusal.

## Reviews at the phase boundary

**Code and security review.** Fixed, with tests:

- **Stale model calls.** A call that outlived its 2-minute window could clear, or apply its reply to, a newer action. Each service action is now parked under a fresh server-side token, and only that token may apply or clear it. This was split into `attempt-actions.ts`.
- **Jobs.**
  - A worker whose lease had expired could still write progress or a result. Leases now carry a token (migration 0004), and every write checks it.
  - "Done" is recorded in the same transaction as the result, so a crash can no longer apply the result twice.
  - A failed job frees its attempt only if the attempt is still waiting on that job.
  - Retries back off.
  - An attempt that moves on expires its job.
- **Canary.** It was the same for every attempt by the same learner; it is now per attempt. A learner who types the canary gets no credit for it.
- **Battery slices.** A slice that fails part-way keeps the replies it already got.
- **Gateway.** Unpriced models are refused on platform keys, so spend can't go uncounted. A failure while recording usage is caught.
- **Mock LLM in production.** It is refused unless `ALLOW_MOCK_LLM_IN_PRODUCTION=true`. The release entry now sets `NODE_ENV=production`.
- **Review overrides** work only on assessments in `pending_review`, and progress is recomputed.
- **Pack export** writes published content only, never unreviewed drafts. It skips archived challenges.
- **Bounds:**
  - prompt-hardening caps on calls, attacks and prompt sizes;
  - dataset size cap.
- **Player.** Job polling survives transient network errors, with backoff and a limit.
- **Author form:**
  - error markers no longer bleed between list cards with similar paths;
  - renaming a map key to an existing name is refused;
  - new keys never collide.
- **Stale reservations.** `run-jobs` closes LLM call reservations that never reported back. Their slot stays used, so a crash never gives out a free call.

## Deliberately deferred

| Item | Why | When |
|---|---|---|
| I7 (reproducer) and A5 | Need code execution or tooling not yet in scope | Later phase |
| Live-provider runs of A1–A7 | Need the owner's API keys | At deploy |
| Rate limits shared across processes | In memory is enough for a single Hostinger app | If scaled out |

## Waiting on the owner

1. **Hostinger:** run `SELECT VERSION()`, ask support about the request timeout, and supply credentials to deploy, or follow docs/DEPLOY-HOSTINGER.md yourself.
2. **Clinical sign-off** of the Lab missions and the DKA case. They stay *draft* until then.
3. **LLM API keys** for the providers the AI missions pin (Google `gemini-3.1-flash-lite` by default).
4. **Model list upkeep.** Claude Haiku 4.5 is due to retire; update the provider configuration when it does.
