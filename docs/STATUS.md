# Project status

_Last updated: 2026-10-08. This page is kept current as work proceeds; the
phase reports hold the detail, and [`DECISIONS.md`](DECISIONS.md) logs every
judgement call made without the owner (review in one pass)._

## At a glance

| Phase | Goal | Status | Report |
|---|---|---|---|
| 0 | Foundations and the one-contract proof | ✅ Done | [PHASE-0-REPORT](PHASE-0-REPORT.md) |
| 1 | Single-site MVP (Clinical AI Level 1 on MySQL) | ✅ Done | [PHASE-1-REPORT](PHASE-1-REPORT.md) |
| 2 | Interactive in the product (diagnostic sims, AI missions, jobs, review queue, pack export) | ✅ Done | [PHASE-2-REPORT](PHASE-2-REPORT.md) |
| 3 | Publishing and institutions (roles, cohorts, payments, certificates, analytics, LTI 1.3) | ✅ Done (reviewed; all high and medium findings fixed) | [PHASE-3-REPORT](PHASE-3-REPORT.md) |
| 4 | Multi-site and themes | 🚧 Started: R1 (settings and themes) part 1 is in | [PHASE-4-PLAN](PHASE-4-PLAN.md) |
| 5 | Ecosystem (pack registry, type SDK, xAPI, LLM patient) | Not started | PLAN.md §8 |

**Deployed:** not yet. Hostinger's database is confirmed as **MariaDB 11.8**
(owner, 2026-10-08), and CI and local development now test on it.

## What works today (all tested)

- **Learners:**
  - sign up, reset their password by email, and confirm their email;
  - play static and interactive challenges: Lab missions, diagnostic simulations, AI chat missions, and prompt hardening run as background jobs;
  - see their progress, cohorts and certificates;
  - buy access to paid packs;
  - open activities from their LMS.
- **Authors and editors:**
  - schema-driven forms, including clinician-authored diagnostic cases;
  - co-authors;
  - draft, review and publish;
  - per-challenge analytics with per-criterion miss rates.
- **Teachers:**
  - organisations and cohorts with join codes;
  - assignments with due dates;
  - a progress grid, cohort insights and CSV exports;
  - reviewing their own cohort's results.
- **Admins:**
  - people and roles (including editor);
  - an audit log;
  - pack access and prices (Stripe or Razorpay);
  - grants and certificates;
  - LMS registration (LTI 1.3: deep linking and grade passback);
  - site name, logo and theme (WCAG-checked colours);
  - pack import and export from the CLI.
- **Operations:**
  - one release archive;
  - `cli` for migrations, admins, packs and cron jobs (`run-jobs` advances AI evaluations, sends LMS grades and cleans up);
  - [DEPLOY-HOSTINGER.md](DEPLOY-HOSTINGER.md) step by step.

## Test totals (latest local run)

- 464 unit tests.
- 125 database tests on **each** of MySQL 8.0 and MariaDB 11.8. CI also runs MariaDB 10.11.
- 15 Playwright end-to-end journeys, against MariaDB 11.8 in CI. They include a simulated LMS and the mock payment checkout.

## In progress now

**Phase 4** ([plan](PHASE-4-PLAN.md)):
- **R1, settings and themes:** mostly done (presets, a WCAG-checked custom accent, logo, footer, sign-ups switch). Its end-to-end test is next.
- **R2:** setup wizard.
- **R3:** notifications.
- **R4:** multi-site.

## Waiting on the owner

1. **Hostinger:** credentials to deploy, and the request timeout.
2. **Clinical sign-off** of the Lab missions and the DKA case. They stay draft until then.
3. **Keys:** LLM providers, an SMTP mailbox, and a payment provider (test mode first) if selling.
4. **An LMS to try LTI against** (Moodle or Canvas).
5. **One review pass over [DECISIONS.md](DECISIONS.md).**
