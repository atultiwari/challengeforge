/**
 * Outgoing mail (Phase 3): password resets, email verification, cohort
 * invites, certificates. One small interface, four modes:
 *   - disabled: nothing is sent (the default on a live site until SMTP is set);
 *   - smtp:     a real server (Hostinger email, or any provider);
 *   - log:      prints messages to stderr (development only);
 *   - file:     writes each message as JSON to a folder (development and E2E only).
 * `log` and `file` expose reset links, so a production site refuses them.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createTransport } from 'nodemailer'
import { z } from 'zod'

export interface MailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export interface Mailer {
  /** False when no mail can be sent: the UI hides "forgot password" and similar. */
  readonly enabled: boolean
  send(message: MailMessage): Promise<void>
}

export type MailConfig =
  | { mode: 'disabled' }
  | { mode: 'log' }
  | { mode: 'file'; dir: string }
  | { mode: 'smtp'; host: string; port: number; secure: boolean; user?: string; password?: string; from: string }

const EnvSchema = z.object({
  MAIL_MODE: z.enum(['disabled', 'log', 'file', 'smtp']).optional(),
  MAIL_FROM: z.string().min(3).optional(),
  MAIL_OUTBOX_DIR: z.string().min(1).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).default(465),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
})

/** Reads MAIL_* and SMTP_* settings. Errors name the variable, never a value. */
export function mailConfigFromEnv(env: Record<string, string | undefined>): MailConfig {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid mail configuration - ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }
  const e = parsed.data
  const production = env['NODE_ENV'] === 'production'
  const mode = e.MAIL_MODE ?? (production ? 'disabled' : 'log')
  if (production && (mode === 'log' || mode === 'file')) {
    throw new Error(`MAIL_MODE "${mode}" exposes reset links and is for development only. Use smtp or disabled.`)
  }
  if (mode === 'file') {
    if (!e.MAIL_OUTBOX_DIR) throw new Error('MAIL_MODE=file needs MAIL_OUTBOX_DIR.')
    return { mode, dir: e.MAIL_OUTBOX_DIR }
  }
  if (mode === 'smtp') {
    if (!e.SMTP_HOST) throw new Error('MAIL_MODE=smtp needs SMTP_HOST.')
    if (!e.MAIL_FROM) throw new Error('MAIL_MODE=smtp needs MAIL_FROM, e.g. "Your Site <no-reply@your-domain.example>".')
    return {
      mode,
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      // Port 465 is implicit TLS; 587 upgrades with STARTTLS.
      secure: e.SMTP_SECURE === undefined ? e.SMTP_PORT === 465 : e.SMTP_SECURE === 'true',
      ...(e.SMTP_USER ? { user: e.SMTP_USER } : {}),
      ...(e.SMTP_PASSWORD ? { password: e.SMTP_PASSWORD } : {}),
      from: e.MAIL_FROM,
    }
  }
  return { mode }
}

/** The pieces a mailer touches outside itself, replaceable in tests. */
export interface MailDeps {
  writeLog?: (line: string) => void
  smtpSend?: (message: MailMessage & { from: string }) => Promise<void>
}

export function createMailer(config: MailConfig, deps: MailDeps = {}): Mailer {
  switch (config.mode) {
    case 'disabled':
      return {
        enabled: false,
        send: async () => {
          throw new Error('Outgoing mail is not set up on this site.')
        },
      }
    case 'log': {
      const write = deps.writeLog ?? ((line: string) => process.stderr.write(line))
      return {
        enabled: true,
        send: async (m) => write(`[mail] to=${m.to} subject=${JSON.stringify(m.subject)}\n${m.text}\n`),
      }
    }
    case 'file':
      return {
        enabled: true,
        async send(m) {
          await mkdir(config.dir, { recursive: true })
          await writeFile(path.join(config.dir, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(m))
        },
      }
    case 'smtp': {
      const send = deps.smtpSend ?? smtpSender(config)
      return { enabled: true, send: (m) => send({ ...m, from: config.from }) }
    }
  }
}

function smtpSender(config: Extract<MailConfig, { mode: 'smtp' }>): (m: MailMessage & { from: string }) => Promise<void> {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.password ?? '' } } : {}),
    // Fail fast rather than hang a request on an unreachable server.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  return async (m) => {
    await transport.sendMail({ from: m.from, to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) })
  }
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!)

/**
 * A plain message with one action link, as text and minimal HTML. Every
 * value is escaped; the link must be one of our own absolute URLs.
 */
export function linkMessage(input: { to: string; subject: string; greeting: string; body: string; action: string; url: string; footer: string }): MailMessage {
  if (!/^https?:\/\//.test(input.url)) throw new Error('Mail links must be absolute http(s) URLs.')
  const text = `${input.greeting}\n\n${input.body}\n\n${input.action}: ${input.url}\n\n${input.footer}\n`
  const html = [
    `<p>${escapeHtml(input.greeting)}</p>`,
    `<p>${escapeHtml(input.body)}</p>`,
    `<p><a href="${escapeHtml(input.url)}">${escapeHtml(input.action)}</a></p>`,
    `<p style="color:#666;font-size:13px">${escapeHtml(input.footer)}</p>`,
  ].join('\n')
  return { to: input.to, subject: input.subject, text, html }
}
