# Phase 4 plan: multi-site and themes

**Goal (PLAN.md §8):** "like WordPress": many sites per install, each with
its own look, and a first-run setup that needs no command line.

## Milestones (each ends green and committed)

| # | Milestone | Done when |
|---|---|---|
| R1 | **Site settings and themes** | A `site_settings` row per site holds the name, tagline, footer text, logo (a site asset), theme, and switches: sign-ups open, email verification required, default currency. The env values (`SITE_NAME`, `REQUIRE_EMAIL_VERIFICATION`) only seed defaults. An admin **Appearance and settings** page offers curated theme presets, plus a custom accent colour that is **refused unless it meets WCAG AA contrast** on the theme's backgrounds. Theme tokens are injected as CSS variables in a nonce'd style tag, with no inline styles elsewhere. |
| R2 | **Setup wizard** | A fresh install with no admin shows `/setup`. It needs a one-time setup token (from `SETUP_TOKEN` in hPanel, or `cli setup-token`). The wizard creates the first admin account, the site name and the theme, then disables itself. Hostinger users who never open SSH can finish setup in the browser. |
| R3 | **Notifications** | A notification outbox (sent by `run-jobs`) emails a certificate when issued, a learner joining a cohort, and grades returned after review. Mail failures retry and never touch the result that caused them. Learners can turn non-essential mail off. |
| R4 | **Multi-site** | A `site_domains` table maps hostnames to sites. Each request resolves its site from the Host header, falling back to the default site. Each site gets its **own Better Auth instance** (same database, accounts shared across the install, cookies per domain), and its own URL is used for mail links, payment return URLs and LTI endpoints. **Network admins** (`cli grant-network-admin`) create sites and attach domains at `/network`. A site's admins never see another site's data: the existing `site_id` scoping, with an authz test across two hostnames. |

## Design calls

- **Accounts are install-wide; roles are per site.** This is WordPress-multisite
  behaviour: one person, one password, a membership on each site they join.
  Better Auth's user table is already global, and memberships carry `site_id`.
- **Single-site installs change nothing.** With no `site_domains` rows, every
  request resolves to the `SITE_SLUG` site at `APP_URL`, exactly as now.
- **Themes are tokens, not templates.** A theme sets colours, fonts (from the
  self-hosted set) and a logo. Layout stays the product's own. Custom colours
  must pass contrast checks, so no site can ship unreadable text.
- **Hostinger:** whether one Node.js app can serve several domains is
  unverified. R4 works with aliases or parked domains pointed at the app. If
  the plan cannot do that, each site can still be a separate install.
