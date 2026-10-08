import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMailer, linkMessage, mailConfigFromEnv, type MailMessage } from '../src/mail'

const message: MailMessage = { to: 'a@example.test', subject: 'Hi', text: 'Body' }

describe('mail configuration', () => {
  it('defaults to log in development and disabled in production', () => {
    expect(mailConfigFromEnv({})).toEqual({ mode: 'log' })
    expect(mailConfigFromEnv({ NODE_ENV: 'production' })).toEqual({ mode: 'disabled' })
  })

  it('refuses modes that expose reset links on a production site', () => {
    expect(() => mailConfigFromEnv({ NODE_ENV: 'production', MAIL_MODE: 'log' })).toThrow(/development only/)
    expect(() => mailConfigFromEnv({ NODE_ENV: 'production', MAIL_MODE: 'file', MAIL_OUTBOX_DIR: '/tmp/x' })).toThrow(/development only/)
  })

  it('needs a host and a sender for SMTP, and picks TLS from the port', () => {
    expect(() => mailConfigFromEnv({ MAIL_MODE: 'smtp', MAIL_FROM: 'x@y.z' })).toThrow(/SMTP_HOST/)
    expect(() => mailConfigFromEnv({ MAIL_MODE: 'smtp', SMTP_HOST: 'smtp.example.test' })).toThrow(/MAIL_FROM/)
    expect(mailConfigFromEnv({ MAIL_MODE: 'smtp', SMTP_HOST: 'smtp.example.test', MAIL_FROM: 'x@y.z' })).toMatchObject({ port: 465, secure: true })
    expect(mailConfigFromEnv({ MAIL_MODE: 'smtp', SMTP_HOST: 'h', MAIL_FROM: 'x@y.z', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASSWORD: 'p' })).toMatchObject({ port: 587, secure: false, user: 'u', password: 'p' })
  })

  it('names the bad variable, never its value', () => {
    expect(() => mailConfigFromEnv({ SMTP_PORT: 'not-a-port-s3cret' })).toThrow(/SMTP_PORT/)
    expect(() => mailConfigFromEnv({ SMTP_PORT: 'not-a-port-s3cret' })).not.toThrow(/s3cret/)
    expect(() => mailConfigFromEnv({ MAIL_MODE: 'file' })).toThrow(/MAIL_OUTBOX_DIR/)
  })
})

describe('mailers', () => {
  it('disabled says so and refuses to send', async () => {
    const m = createMailer({ mode: 'disabled' })
    expect(m.enabled).toBe(false)
    await expect(m.send(message)).rejects.toThrow(/not set up/)
  })

  it('log writes the message', async () => {
    const lines: string[] = []
    await createMailer({ mode: 'log' }, { writeLog: (l) => lines.push(l) }).send(message)
    expect(lines.join('')).toContain('to=a@example.test')
  })

  it('file writes one JSON file per message', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cf-mail-'))
    try {
      await createMailer({ mode: 'file', dir }).send(message)
      const files = await readdir(dir)
      expect(files).toHaveLength(1)
      expect(JSON.parse(await readFile(path.join(dir, files[0]!), 'utf8'))).toEqual(message)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('smtp sends from the configured sender', async () => {
    const sent: unknown[] = []
    const m = createMailer({ mode: 'smtp', host: 'h', port: 465, secure: true, from: 'Site <no-reply@x.test>' }, { smtpSend: async (msg) => void sent.push(msg) })
    await m.send(message)
    expect(sent).toEqual([{ ...message, from: 'Site <no-reply@x.test>' }])
  })
})

describe('linkMessage', () => {
  it('escapes every value in the HTML and keeps the link in the text', () => {
    const msg = linkMessage({ to: 'a@x.test', subject: 'Reset', greeting: 'Hi <b>Eve</b>', body: 'Body & more', action: 'Reset', url: 'https://site.test/r?t="x"', footer: 'Ignore' })
    expect(msg.html).toContain('Hi &lt;b&gt;Eve&lt;/b&gt;')
    expect(msg.html).toContain('href="https://site.test/r?t=&quot;x&quot;"')
    expect(msg.text).toContain('Reset: https://site.test/r?t="x"')
  })

  it('refuses non-http links', () => {
    expect(() => linkMessage({ to: 'a', subject: 's', greeting: 'g', body: 'b', action: 'a', url: 'javascript:alert(1)', footer: 'f' })).toThrow()
  })
})
