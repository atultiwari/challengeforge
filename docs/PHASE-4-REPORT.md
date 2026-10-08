# Phase 4 report: multi-site and themes

**Date:** 2026-10-08 · **Status:** built and verified locally. CI runs on every push.
Judgement calls are logged in [`DECISIONS.md`](DECISIONS.md) (D29–D36).

## Exit criteria (docs/PHASE-4-PLAN.md)

| # | Milestone | Result |
|---|---|---|
| R1 | Site settings and themes | **Done.** Settings per site: name, tagline, footer, logo, theme, sign-ups open, currency. Four presets (case file, clinic, slate, night). A custom accent colour is **refused unless every text pairing meets WCAG AA**. Theme tokens are injected in a nonce'd style tag. Closing sign-ups hides the link and the API refuses sign-ups. E2E covers it. |
| R2 | Setup wizard | **Done.** The server migrates and creates the site when it starts (`AUTO_MIGRATE`). `/setup` creates the first admin with a setup token, then disappears for good. E2E runs on a **fresh, empty install**: an empty database, then the server start, then the wizard, then an admin. |
| R3 | Notifications | **Done.** Emails for a certificate issued, a review decided, and a cohort joined. They are queued in the same transaction as the event and sent by cron with claims and retries. Learners opt out on their **Account** page. |
| R4 | Multi-site | **Done.** Sites are selected by host, from registered hosts only, so a forged Host header cannot steer links. Each site has its own auth instance; accounts are shared and roles are per site. Network admins create sites at `/network`. E2E serves a second site on a second host: separate content, shared account, and same-origin enforced per site. |

**Tests:**
- 464 unit tests.
- **132 database tests on each engine** (MySQL 8.0, MariaDB 11.8; CI adds MariaDB 10.11).
- **18 Playwright journeys**: 17 on the main site plus 1 on a fresh install.

## Found and fixed along the way

- **React 19 reset forms after every submit**, so a refused save wiped what had been typed (including the email on a failed sign-in). Forms now submit with `onSubmit` and keep their input until a save succeeds.
- **The header did not update after the setup wizard**: shared layouts survive client navigation. Forms now refresh after navigating.
- **Dark themes:** the primary button and the flagged-item colours had hard-coded white text. New `on-accent` and `on-danger` tokens fix this and are contrast-checked.
- **Next's dev server refused its scripts to a second host**, found by the multi-site E2E. Development allows `127.0.0.1` (dev only).

## Reviews

Phase-boundary security and code reviews of Phase 4 are recorded in
[`STATUS.md`](STATUS.md) once complete.

## Waiting on the owner

1. **Hostinger:** credentials, the request timeout, and whether one Node.js app can answer several domains (aliases or parked domains). Multi-site depends on that; otherwise use one install per site.
2. Everything listed in [`STATUS.md`](STATUS.md) → *Waiting on the owner*.
