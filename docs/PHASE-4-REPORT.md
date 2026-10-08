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
- 466 unit tests.
- **136 database tests on each engine** (MySQL 8.0, MariaDB 11.8; CI adds MariaDB 10.11).
- **18 Playwright journeys**: 17 on the main site plus 1 on a fresh install.

## Found and fixed along the way

- **React 19 reset forms after every submit**, so a refused save wiped what had been typed (including the email on a failed sign-in). Forms now submit with `onSubmit` and keep their input until a save succeeds.
- **The header did not update after the setup wizard**: shared layouts survive client navigation. Forms now refresh after navigating.
- **Dark themes:** the primary button and the flagged-item colours had hard-coded white text. New `on-accent` and `on-danger` tokens fix this and are contrast-checked.
- **Next's dev server refused its scripts to a second host**, found by the multi-site E2E. Development allows `127.0.0.1` (dev only).

## Reviews at the phase boundary

Two independent reviews covered the whole Phase 4 range: security, and code
quality and correctness. **No critical findings.** Everything rated high or
medium was fixed, with tests (D37–D39):

- **High (code):** setup created the account and claimed the site before validating the rest of the form, so a bad field lost the choices and could leave an orphan account. Now everything is validated first, a lost claim removes the account, and the new admin stays signed in even if saving the look fails.
- **Medium (security):** a site with sign-ups closed could be joined by any account on the install, just by signing in there. Closed sites now give such accounts no role, and admins add people by email.
- **Medium (code):**
  - Random Host headers could evict real sites from the host cache. Unknown hosts are now cached apart, and the cache is cleared after site, domain or name changes.
  - Notifications were marked "skipped" for good when the cron environment had no mail settings. They now stay queued, and a missing `APP_URL` is logged.
  - Payments: the mock checkout now follows the site. The real providers take their URLs per request.
- **Low:**
  - `X-Forwarded-Host` is opt-in.
  - Auth instances no longer grow with renames.
  - LTI tickets are bound to their site.
  - Logo bytes are checked by magic number and uploads are size-capped while streaming.
  - Duplicate hosts or slugs give a clear refusal even under a race, and the default site's address cannot be reassigned.
  - Startup warns when `SETUP_TOKEN` is left set.

**Found while testing the fixes:** MariaDB 11.8, Hostinger's version, raises
error 1020 ("record has changed since last read") under concurrency, which
MySQL never does. Every transaction now retries on 1020 as it already did on
deadlocks (D38). Without this, concurrent requests on the production database
would sometimes fail with a server error.

## Waiting on the owner

1. **Hostinger:** credentials, the request timeout, and whether one Node.js app can answer several domains (aliases or parked domains). Multi-site depends on that; otherwise use one install per site.
2. Everything listed in [`STATUS.md`](STATUS.md) → *Waiting on the owner*.
