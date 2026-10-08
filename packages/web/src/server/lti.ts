import 'server-only'
import { env } from './env'

export const LTI_STATE_COOKIE = 'cf_lti_state'
const STATE_MAX_AGE_S = 600
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!)

/** The secret that seals the tool's signing key (same as sessions; never changes on a live site). */
export const ltiSecret = (): string => env().BETTER_AUTH_SECRET

/**
 * The login state cookie must survive the LMS's cross-site POST back to us,
 * so it is SameSite=None (which requires Secure; browsers allow Secure
 * cookies on http://localhost for development). Scoped to /lti, short-lived.
 */
export function stateCookie(state: string): string {
  return `${LTI_STATE_COOKIE}=${state}; Path=/lti; Max-Age=${STATE_MAX_AGE_S}; HttpOnly; Secure; SameSite=None`
}

export const clearStateCookie = (): string => `${LTI_STATE_COOKIE}=; Path=/lti; Max-Age=0; HttpOnly; Secure; SameSite=None`

/**
 * The launch's one-time session ticket travels in a cookie, never in a URL:
 * a URL could be replayed into someone else's browser (login CSRF), a cookie
 * set on this browser cannot. Scoped to the one path that redeems it.
 */
export const LTI_TICKET_COOKIE = 'cf_lti_ticket'
export const ticketCookie = (ticket: string): string => `${LTI_TICKET_COOKIE}=${ticket}; Path=/lti/session; Max-Age=60; HttpOnly; Secure; SameSite=None`
export const clearTicketCookie = (): string => `${LTI_TICKET_COOKIE}=; Path=/lti/session; Max-Age=0; HttpOnly; Secure; SameSite=None`

/** A minimal server-rendered page (no scripts) for LTI hand-offs and errors. */
export function ltiPage(title: string, bodyHtml: string, init: { status?: number; headers?: HeadersInit } = {}): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5">${bodyHtml}</body></html>`
  const headers = new Headers(init.headers)
  headers.set('content-type', 'text/html; charset=utf-8')
  headers.set('cache-control', 'no-store')
  headers.set('referrer-policy', 'no-referrer')
  return new Response(html, { status: init.status ?? 200, headers })
}

export function ltiError(message: string, status = 400): Response {
  return ltiPage('Could not open the activity', `<h1>Could not open the activity</h1><p>${escapeHtml(message)}</p>`, { status, headers: { 'set-cookie': clearStateCookie() } })
}

/** Reads a string from a form or query, bounded; empty means absent. */
export function field(source: FormData | URLSearchParams, name: string, max = 4096): string | undefined {
  const v = source.get(name)
  return typeof v === 'string' && v !== '' && v.length <= max ? v : undefined
}
