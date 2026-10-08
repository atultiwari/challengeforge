# Phase 3 report: publishing and institutions

**Date:** 2026-10-08 · **Status:** built and verified locally and in CI.
**Not yet deployed.** Hostinger still needs the owner's credentials. The
production database is confirmed as **MariaDB 11.8**, and CI now tests on it.
The owner asked for the work to continue without check-ins, so every
judgement call is logged in [`DECISIONS.md`](DECISIONS.md) (D1–D28) for
review in one pass.

## Exit criteria (docs/PHASE-3-PLAN.md)

| # | Milestone | Result |
|---|---|---|
| Q1 | Mail and audit | **Done.** Mail can be `disabled`, `smtp`, `log` or `file`; the last two are refused in production. Password reset by email works, and resetting signs the account out everywhere. Email verification is optional. The **audit log** records every consequential change, and admins can read it. E2E: reset by email, a used link is refused, and an unknown address gets the same answer as a known one. |
| Q2 | Multi-author roles | **Done.** A new **editor** role reviews and publishes; people, packs and the audit log stay with admins. **Co-authors** can edit a challenge but cannot publish it. One `canEdit` rule covers editing, listings and draft assets. E2E covers it. |
| Q3 | Organisations and cohorts | **Done.** Organisations have members, instructors and org admins. Cohorts have **join codes** (closable and rotatable), co-instructors, assignments (packs or challenges, with due dates) and a **progress grid** that marks late work. Instructors review only their own cohort's learners on assigned challenges. E2E covers it. |
| Q4 | Access and payments | **Done.** Packs are open or restricted. Access comes from grants (admin, payment or LTI, with expiry and revocation) or from a live cohort, worked out each time and never stored. Payments are by **Stripe Checkout** or **Razorpay Payment Links** (hosted pages, so no CSP exceptions), plus a development mock. Only a signed webhook grants access, amounts come from our own price, each event is applied once, and a full refund revokes access. E2E: restrict, price, buy, play. |
| Q5 | Certificates | **Done.** A certificate is issued in the same transaction as the *final* pass that completes a pack; results waiting for review don't count. Turning certificates on issues them to everyone who already qualifies. A public verify page is printable as PDF, and revoking one shows the reason publicly. E2E covers it. |
| Q6 | Analytics | **Done.** Per challenge: learners, attempts, finished, pass rate, median time, waiting for review, critical failures, and **per-criterion miss rates**. Authors see their own challenges, editors see packs, instructors see their cohort. **CSV** exports guard against spreadsheet formula injection. |
| Q7 | LTI 1.3 | **Done.** Login, launch verification (platform JWKS, issuer, audience and authorised party, nonce, expiry, version, deployment), a single-use state plus a state cookie, **Deep Linking 2.0** and **AGS grade passback** through a retrying outbox. LMS users are linked by (platform, sub), never by email. E2E runs against a **simulated LMS**: register, deep link, launch, play, and the grade reaches the LMS grade book. A forged launch is refused. |

**Tests:**
- 458 unit tests.
- **118 database tests on each engine:** MySQL 8.0 and MariaDB 11.8 locally; CI adds MariaDB 10.11.
- **15 Playwright E2E tests**, now run against MariaDB 11.8 in CI.

## Reviews at the phase boundary

Security and code reviews of the whole Phase 3 range are recorded below,
together with the fixes they led to.

_(Filled in when the reviews complete.)_

## Found and fixed along the way

- **A test race that hung CI.** Tests released a service call before the
  call had been set up. They now create the release before the call starts.
- **A stalled outgoing call hung cron for 5 minutes**, found by the LTI E2E
  test. Every call to Stripe, Razorpay or an LMS now times out after 15 s.
- **The launch ticket was in a URL** (a login-CSRF risk). It now travels in a
  short-lived cookie scoped to `/lti/session`.
- **E2E specs interfered when run in parallel** (site-wide settings, plus the
  dev server compiling routes). They now run with one worker and a longer
  assertion timeout.

## Deliberately deferred

| Item | Why |
|---|---|
| CAPTCHA on sign-up | Needs a third-party service; rate limits and optional email verification cover it for now. |
| Email when a certificate is issued | Issuing happens inside a database transaction; it needs a notification job (Phase 4). |
| Subscriptions, coupons, zero-decimal currencies | One-off purchases in INR/USD-style currencies first. |
| LTI 1.1, Names and Roles provisioning, framed launches | 1.3 core, Deep Linking and AGS cover Moodle and Canvas. Launches open in a new window. |
| Analytics cache | Not needed at Hostinger-site volumes. |

## Waiting on the owner

1. **Hostinger:** credentials to deploy, and the request timeout. The database version is already confirmed as MariaDB 11.8.
2. **Clinical sign-off** of the Lab missions and the DKA case. They stay draft until then.
3. **Keys:** LLM providers, SMTP mailbox, and the payment provider (if selling). Test-mode keys first; see DEPLOY-HOSTINGER.md §7.
4. **An LMS to try LTI against** (Moodle or Canvas); see DEPLOY-HOSTINGER.md §8.
5. **One review pass over [`DECISIONS.md`](DECISIONS.md).**
