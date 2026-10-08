# Phase 3 plan: publishing and institutions

**Goal (PLAN.md §8):** others author, teach and, optionally, charge.
Phase 3 exits when the following work on one site:

- multi-author roles;
- organisations and cohorts;
- certificates;
- payments;
- **LTI 1.3** with grade passback;
- analytics from the event log.

## Milestones (each ends green and committed)

| # | Milestone | Done when |
|---|---|---|
| Q1 | **Mail and audit** | A mail transport: SMTP, which Hostinger includes, or `log` in development and CI. Password reset by email, through Better Auth. Optional email verification, as a site setting. An `audit_log` table records role changes, publishes, review overrides, grants, refunds and LTI registrations. Admins can read the log. |
| Q2 | **Multi-author roles** | A new `editor` role ranks between author and admin. Editors review and publish anyone's content and work the review queue. Authors can invite **co-authors** to a challenge. Authors still cannot publish their own work unless the site allows it. |
| Q3 | **Organisations and cohorts** | An organisation has members with roles: member, instructor or org admin. A cohort has a join code, dates, and **assignments** (packs or challenges, with due dates). Learners join by code. Instructors see a cohort progress grid and a review queue limited to their cohort. |
| Q4 | **Access and payments** | Each pack has an access mode: `open`, `signed_in` or `restricted`. `access_grants` come from four sources: an admin, a cohort, a payment, or LTI. They are enforced when an attempt starts and in listings. Payments have a provider interface, a **mock provider** for tests and E2E, **Stripe Checkout** and **Razorpay**. Webhooks are verified by signature, grants are idempotent, and refunds revoke the grant. No live payment runs without the owner's keys. |
| Q5 | **Certificates** | A pack can have a rule: pass every required challenge. When it is met, a certificate is issued with a random public id and a snapshot of the name, title and date. It has a public **verify** page, a print-friendly page (the browser saves it as PDF), and admins can revoke it. |
| Q6 | **Analytics** | All of it is derived from attempts, events and assessments: attempts, completion and pass rates, time on task, **per-criterion miss rates**, and critical errors hit. Views exist per challenge, per pack and per cohort, and each exports to CSV. Authors see their own challenges, instructors their own cohorts, and editors and admins everything. |
| Q7 | **LTI 1.3** | ChallengeForge becomes an LTI 1.3 tool. An admin registers a platform: issuer, client id, the platform's JWKS URL and deployment ids. The tool supports OIDC login initiation, launch validation (`jose`, the platform's JWKS, nonce and state), and user linking. It also supports **Deep Linking** (a teacher picks a challenge) and **AGS** score passback, run as a background job. Our keys are published at `/lti/jwks`, and the private key is stored encrypted. Integration tests run against a simulated platform. |

## Design calls

- **Organisations sit inside a site.** A site is the install (multi-site comes in Phase 4). An organisation is a school or department on that site. Every new table has `site_id`, and the authz matrix grows to cover instructor versus learner and other-organisation cases.
- **Access is checked in one place.** `startOrResume` and the listing queries share one `canPlay(scope, pack)` predicate. Grants are rows, never flags on a user.
- **Payments only ever create grants.** The webhook is the source of truth, not the return URL. Every event is stored with its provider id, under a unique key, so a repeated delivery is a no-op. Amounts come from our product table, never from the client.
- **Certificates are snapshots.** Renaming a pack or a person later does not rewrite an issued certificate. The id is random, and holding it is what lets someone verify the certificate.
- **The LTI user is not the email.** A launch links on `(platform, sub)`. It never trusts the email claim to take over an existing account.
- **Grade passback is a job.** A slow LMS never blocks the learner, and a failed passback retries with the existing job leases.
- **Analytics are queries, not a warehouse.** Volumes on a Hostinger site are small. The heavy aggregates are cached for a few minutes.

## Waiting on the owner (does not block building)

- SMTP credentials, from Hostinger email or another provider.
- Payment provider keys and the currency, if the site will charge. Razorpay is the likely fit in India; Stripe is the alternative.
- An LMS to try LTI against, e.g. Moodle or Canvas.

## Deliberately deferred

| Item | Why |
|---|---|
| CAPTCHA on sign-up | Needs a third-party service and the owner's choice. Rate limits and optional email verification cover it for now. |
| Subscriptions and coupons | One-off purchases first. |
| LTI 1.1, Names and Roles provisioning | 1.3 core, Deep Linking and AGS cover the common case. |
