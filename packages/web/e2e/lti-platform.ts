/**
 * A simulated LMS for end-to-end tests: its own signing key, an OIDC auth
 * endpoint that posts back a signed id_token, a token endpoint, a grade book
 * that records scores, and a deep-link return page that verifies what the
 * tool signed. Synthetic only; listens on localhost.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { createRemoteJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT, type CryptoKey, type JWK } from 'jose'

export const PLATFORM_PORT = 3299
export const PLATFORM = `http://localhost:${PLATFORM_PORT}`
export const CLIENT_ID = 'e2e-tool-client'
export const DEPLOYMENT_ID = 'e2e-deployment'
const LTI = 'https://purl.imsglobal.org/spec/lti/claim'

export interface SimulatedPlatform {
  /** Claims for the next launch (merged over the defaults). */
  nextLaunch: Record<string, unknown>
  scores: { url: string; body: Record<string, unknown> }[]
  deepLinkItems: unknown[] | null
  close(): Promise<void>
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let data = ''
    req.on('data', (c: Buffer) => (data += c.toString()))
    req.on('end', () => resolve(data))
  })

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export async function startPlatform(toolUrl: string): Promise<SimulatedPlatform> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'e2e-platform', alg: 'RS256', use: 'sig' }
  const toolKeys = createRemoteJWKSet(new URL(`${toolUrl}/lti/jwks`))
  const state: SimulatedPlatform = { nextLaunch: {}, scores: [], deepLinkItems: null, close: async () => undefined }

  const sign = (claims: Record<string, unknown>) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'e2e-platform' }).setIssuer(PLATFORM).setAudience(CLIENT_ID).setIssuedAt().setExpirationTime('5m').sign(privateKey as CryptoKey)

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', PLATFORM)
    const html = (body: string) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<!doctype html><html><body>${body}</body></html>`)
    }
    try {
      if (url.pathname === '/jwks') {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ keys: [jwk] }))
      }
      if (url.pathname === '/start') {
        // The LMS starts a launch: third-party initiated login at the tool.
        const login = new URL(`${toolUrl}/lti/login`)
        login.searchParams.set('iss', PLATFORM)
        login.searchParams.set('login_hint', 'e2e-hint')
        login.searchParams.set('target_link_uri', `${toolUrl}/lti/launch`)
        login.searchParams.set('client_id', CLIENT_ID)
        res.writeHead(302, { location: login.href })
        return res.end()
      }
      if (url.pathname === '/auth') {
        if (url.searchParams.get('client_id') !== CLIENT_ID || url.searchParams.get('redirect_uri') !== `${toolUrl}/lti/launch`) {
          res.writeHead(400)
          return res.end('bad auth request')
        }
        const token = await sign({
          nonce: url.searchParams.get('nonce'),
          [`${LTI}/version`]: '1.3.0',
          [`${LTI}/deployment_id`]: DEPLOYMENT_ID,
          ...state.nextLaunch,
        })
        return html(
          `<form id="f" method="post" action="${escape(url.searchParams.get('redirect_uri')!)}"><input type="hidden" name="id_token" value="${escape(token)}"><input type="hidden" name="state" value="${escape(url.searchParams.get('state') ?? '')}"><button>Continue</button></form><script>document.getElementById('f').submit()</script>`,
        )
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        const form = new URLSearchParams(await readBody(req))
        await jwtVerify(form.get('client_assertion') ?? '', toolKeys, { issuer: CLIENT_ID, audience: `${PLATFORM}/token` })
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ access_token: 'e2e-access-token', token_type: 'bearer', expires_in: 3600 }))
      }
      if (url.pathname.endsWith('/scores') && req.method === 'POST') {
        if (req.headers['authorization'] !== 'Bearer e2e-access-token') {
          res.writeHead(401)
          return res.end()
        }
        state.scores.push({ url: url.pathname, body: JSON.parse(await readBody(req)) as Record<string, unknown> })
        res.writeHead(200)
        return res.end()
      }
      if (url.pathname === '/deep-link-return' && req.method === 'POST') {
        const form = new URLSearchParams(await readBody(req))
        const { payload } = await jwtVerify(form.get('JWT') ?? '', toolKeys, { issuer: CLIENT_ID, audience: PLATFORM })
        state.deepLinkItems = (payload['https://purl.imsglobal.org/spec/lti-dl/claim/content_items'] as unknown[]) ?? []
        return html(`<h1>Course updated</h1><p>${state.deepLinkItems.length} activities added.</p>`)
      }
      res.writeHead(404)
      res.end()
    } catch (err) {
      res.writeHead(400)
      res.end(String(err))
    }
  })
  await new Promise<void>((resolve) => server.listen(PLATFORM_PORT, resolve))
  state.close = () => new Promise((resolve) => server.close(() => resolve()))
  return state
}
