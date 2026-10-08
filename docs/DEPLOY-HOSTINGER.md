# Deploying ChallengeForge on Hostinger (Node.js hosting + database)

This runbook covers a Hostinger plan with **Node.js web apps** (Business or
Cloud). The same steps work on any Node 20+ host with MySQL 8 or MariaDB 10.11+ (Hostinger: MariaDB 11.8).

> **Verified so far:**
> - the release archive builds;
> - it runs as `node server.js` with production settings and a strict CSP;
> - the CLI migrates and imports on MySQL 8.0 and MariaDB 10.11.
>
> **Not yet verified on Hostinger itself.** hPanel labels below follow
> Hostinger's public docs (2026-10). Confirm them on your plan and correct
> this page where they differ.

## What you deploy

`pnpm release` builds one archive, `challengeforge-release.zip`:

| Path | What it is |
|---|---|
| `server.js` | Entry file. Starts the Next.js standalone server. |
| `packages/web/` | The compiled app, with its trimmed `node_modules`. |
| `cli.mjs` | Operator commands (one file): `migrate`, `import-pack`, `publish-pack`, `export-pack`, `create-admin`, `reset-password`, `run-jobs`. |

The host builds nothing. You upload a prebuilt, tested archive. This avoids
depending on Hostinger building a pnpm monorepo, which its docs do not cover.

## 1. Create the database (hPanel → Databases)

1. Create a database and a database user, and note the **name**, **user**,
   **password** and **host**. The host is usually `localhost` from the Node app.
2. Hostinger runs **MariaDB 11.8** (confirmed 2026-10-08), which CI tests on
   every push. MariaDB 10.11+ and MySQL 8 are also supported.

## 2. Build the release (on your computer or in CI)

```bash
pnpm install
pnpm release
```

## 3. Create the Node.js app (hPanel → Websites → Node.js)

1. **Node version:** 22.
2. **Deploy from archive:** upload `challengeforge-release.zip`.
3. **Entry file:** `server.js`.
4. If Hostinger asks for an install or build command, leave it **empty**. The
   archive is already built.
5. **Environment variables:**

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `mysql://USER:PASSWORD@localhost:3306/DBNAME`. URL-encode special characters in the password (`@` becomes `%40`). |
| `BETTER_AUTH_SECRET` | 32+ random characters, e.g. from `openssl rand -base64 36`. **Keep it secret and never change it**: changing it signs everyone out. |
| `APP_URL` | `https://your-domain.example`, with no trailing slash |
| `SITE_SLUG` | `main` |
| `SITE_NAME` | the name shown in the header |
| `DB_CONNECTION_LIMIT` | `5`. Shared plans cap connections. |
| `LLM_MODE` | `live` to call real AI providers. A production site refuses to start on `mock` (canned replies) unless `ALLOW_MOCK_LLM_IN_PRODUCTION=true`, which is for demo sites only. |
| `GOOGLE_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | Keys for the providers your AI missions pin. Needed only with `LLM_MODE=live`. Only models with a price in the provider configuration may run on the site's keys. |
| `LLM_BUDGET_USD_PER_USER` | Spend cap per learner on the site's keys. Default `2`. |
| `MAIL_MODE` | `smtp` to send password-reset and confirmation emails. Without it, the site sends no mail and hides "Forgot your password?". |
| `MAIL_FROM` | e.g. `Your Site <no-reply@your-domain.example>`. Use a mailbox you created in hPanel → Emails. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | Hostinger email: `smtp.hostinger.com`, port `465`, the mailbox address and its password. |
| `REQUIRE_EMAIL_VERIFICATION` | `true` makes new accounts confirm their email before signing in. Needs `MAIL_MODE=smtp`. Default `false`. |
| `PAYMENTS_PROVIDER` | `none` (default), `razorpay` or `stripe`. See section 7. |
| `BYOK_ENCRYPTION_KEY` | Optional. Generate with `openssl rand -base64 32`; it lets learners use their own API keys. |

## 4. First-time setup

### Option A: in the browser (no SSH)

1. Add two more environment variables in hPanel:
   - `SETUP_TOKEN`: 24 or more random characters, e.g. from `openssl rand -base64 30`;
   - `AUTO_MIGRATE=true`, which is the default: the app creates and upgrades its database tables when it starts.
2. Restart the app and open your site. It sends you to **/setup**.
3. Paste the setup token, choose the site name and look, and create your admin account.
4. The wizard then closes for good. Remove `SETUP_TOKEN` from hPanel.

### Option B: from SSH (hPanel → Advanced → SSH access)

Panel environment variables are usually **not** present in an SSH shell.
Export them for these commands only:

```bash
cd ~/path/to/your/node/app          # where server.js and cli.mjs are
export DATABASE_URL='mysql://USER:PASSWORD@localhost:3306/DBNAME'
export BETTER_AUTH_SECRET='the same value as in hPanel'
export APP_URL='https://your-domain.example' SITE_SLUG=main SITE_NAME='Your site'

node cli.mjs migrate
ADMIN_PASSWORD='a long new password' node cli.mjs create-admin --email you@example.com --name "Your Name"
```

Then restart the Node.js app in hPanel and sign in.

## 5. Import the Clinical AI pack (private)

The pack comes from the **private** repo `atultiwari/challengeforge-pack-clinical-ai`.

1. Upload its `pack/` folder to the server, e.g. `~/packs/clinical-ai/pack`
   (File Manager, or `scp -r`).
2. Run:

   ```bash
   node cli.mjs import-pack ~/packs/clinical-ai/pack
   ```

   Do **not** add `--publish` yet.
3. Every Level 1 mission is still marked **draft** for clinical review in the
   Lab. Publish each one from **Admin → Waiting to be published** once it is
   signed off. Or, after sign-off, publish them all at once:

   ```bash
   node cli.mjs publish-pack clinical-ai
   ```

Re-importing after content changes is safe. Unchanged missions are untouched.
Changed ones become new **draft** versions, and learners keep playing the
published version until you publish again.

## 6. Background jobs (AI evaluations)

Long AI evaluations (e.g. the prompt-hardening missions) run as **background
jobs**. The same cron job also sends grades back to an LMS and the update
emails (certificates, reviewed results, cohorts joined), so export `APP_URL`
and the `MAIL_*`/`SMTP_*` variables for it too. The learner's open page advances them a slice at a time, so they finish
even without cron. To finish jobs whose learner closed the page, add an hPanel
**Cron job** every 5 minutes (with the same environment variables exported, as
in section 4):

```bash
cd ~/path/to/your/node/app && node cli.mjs run-jobs --max-seconds 240
```

## 7. Selling packs (optional)

1. Choose a provider and create **test-mode** keys first:
   - **Razorpay:** Dashboard → Account & Settings → API keys. Set
     `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
   - **Stripe:** Developers → API keys. Set `STRIPE_SECRET_KEY`.
2. Add a webhook in the provider's dashboard and copy its signing secret:
   - **Razorpay:** URL `https://your-domain.example/api/payments/webhook/razorpay`.
     Events: `payment_link.paid`, `payment_link.expired`,
     `payment_link.cancelled`, `refund.processed`. Set `RAZORPAY_WEBHOOK_SECRET`.
   - **Stripe:** URL `https://your-domain.example/api/payments/webhook/stripe`.
     Events: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`,
     `charge.refunded`. Set `STRIPE_WEBHOOK_SECRET`.
3. Set `PAYMENTS_PROVIDER` and restart the app.
4. In **Admin → Access and payments**, restrict a pack and give it a price.
5. Buy it once yourself in test mode. Check that access appears, then refund
   it in the provider's dashboard and check that access ends. Only then
   switch to live keys.

**How it works.** Only a signed webhook grants access, never the page the
buyer returns to. The amount always comes from your price, and a paid amount
that doesn't match is rejected. A *full* refund ends access; a partial refund
does not.

## 8. Connecting an LMS (LTI 1.3, optional)

ChallengeForge can be an external tool in Moodle, Canvas, Blackboard or
Brightspace. Teachers add challenges to a course, learners open them from the
course, and grades go back to the LMS grade book.

1. In **Admin → LMS (LTI)**, copy the four URLs: login, launch, deep linking
   and public keyset.
2. In the LMS, add an **LTI 1.3 external tool** with those URLs. Turn on
   **Deep Linking** and **Assignment and Grade Services**. Set it to **open in
   a new window**.
3. Copy the details the LMS shows (platform ID/issuer, client ID, deployment
   ID, authentication request URL, access token URL, public keyset URL) into
   the form on the same admin page.
4. Grades are sent by the cron job in section 6, within 5 minutes of a
   learner finishing. Failed sends are retried, with backoff, for about a day.

LMS users get their own accounts here, linked to their LMS identity. An
existing account is never matched by email. A course placement unlocks its
pack for the learners it launches, even if the pack is restricted.

## 9. More than one site (optional)

One installation can serve several sites, like WordPress multisite. Each site
has its own people, content, look and settings; accounts are shared.

1. Make yourself a **network admin** (SSH, once):
   `node cli.mjs grant-network-admin --email you@example.com`.
2. Point the extra domain at the same Node.js app. Hostinger calls this an
   alias or parked domain. Whether your plan allows it is **not yet verified**.
   If it doesn't, run a separate installation per site instead.
3. Open **/network** and create the site with its domain and its first admin.
4. Send the cron job's mail links per site: no change needed. Each site's
   links use its own domain.

## 10. Upgrades

1. `pnpm release` locally.
2. Upload the new archive in hPanel.
3. Run `node cli.mjs migrate` (safe to run every time).
4. Restart the app.

Attempts in progress are pinned to the version they started on, so publishing
changes never disturbs a learner mid-attempt.

## 11. Backups

The database holds everything, including uploaded datasets and case files.

- **hPanel → Backups:** check that daily database backups are included in your plan.
- **Your own copy:** add an hPanel **Cron job** (weekly), and keep copies off the server too:

  ```bash
  mysqldump --single-transaction -u USER -p'PASSWORD' DBNAME | gzip > ~/backups/challengeforge-$(date +\%F).sql.gz
  ```

- **Test a restore** into a scratch database once, before you need it.

## 12. Operating notes

- **Cold starts.** Hostinger stops idle Node apps and starts them on the next
  request. The first page after a quiet period can take a few seconds.
- **Rate limits are in memory.** They reset when the app is idled. They blunt
  bursts; they are not an accounting system.
- **Password resets.** With `MAIL_MODE=smtp`, learners reset their own
  password from "Forgot your password?". Without mail, or for a locked-out
  admin, reset it from SSH:

  ```bash
  NEW_PASSWORD='...' node cli.mjs reset-password --email them@example.com
  ```

  This also signs them out everywhere.
- **Request timeouts.** Requests are short. Long AI evaluations run as
  resumable jobs (section 6), so they do not depend on Hostinger's
  undocumented proxy timeout.
- **Audit log.** Admin → Audit log lists role changes, publishing, review
  overrides, pack imports and password resets.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Invalid configuration - …" in the app log | A missing or short environment variable. The message names it. |
| `Unknown database` or `Access denied` | `DATABASE_URL` is wrong, or the user lacks rights on that database. |
| `Site "main" does not exist` | `node cli.mjs migrate` has not been run against this database. |
| Everyone signed out after a deploy | `BETTER_AUTH_SECRET` changed. |
| Sign-in works, but every POST says "Request refused." | `APP_URL` does not match the address in the browser (`https`, `www`, or a trailing slash). |
