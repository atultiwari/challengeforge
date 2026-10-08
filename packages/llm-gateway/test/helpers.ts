import { randomBytes } from 'node:crypto'
import { vi } from 'vitest'
import type { GatewayConfig } from '../src/config'
import type { LlmStore, ReserveArgs, UsageRecord } from '../src/store'

export const MASTER_KEY = randomBytes(32).toString('base64')

export function testConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    llmMock: false,
    platformBudgetUsdPerUser: 2,
    byokEnabled: true,
    byokEncryptionKey: MASTER_KEY,
    enabledProviders: ['anthropic', 'openai', 'google', 'openrouter'],
    platformKeys: { anthropic: 'sk-ant-platform' },
    ...overrides,
  }
}

export type FakeStore = LlmStore & { logged: UsageRecord[]; released: string[]; reserved: ReserveArgs[] }

/** In-memory store: `used` calls already made, reservations tracked. */
export function fakeStore(overrides: Partial<LlmStore> & { used?: number } = {}): FakeStore {
  const { used = 0, ...rest } = overrides
  const logged: UsageRecord[] = []
  const released: string[] = []
  const reserved: ReserveArgs[] = []
  let count = used
  return {
    logged,
    released,
    reserved,
    reserveCall: async (args) => {
      if (count >= args.cap) return { reservationId: null, callsUsed: count }
      count += 1
      reserved.push(args)
      return { reservationId: `r${count}`, callsUsed: count }
    },
    completeCall: async (_id, r) => void logged.push(r),
    releaseCall: async (id) => {
      count -= 1
      released.push(id)
    },
    sumPlatformCostUsd: async () => 0,
    getCredential: async () => null,
    ...rest,
  }
}

export type FetchMock = ReturnType<typeof stubFetch>

/** Replaces global fetch with a mock returning `status` and `body`. */
export function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(
    async (_url: string, _init: RequestInit): Promise<Response> =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

/** The [url, init] of the nth fetch call; fails loudly if there was none. */
export function fetchCall(fn: FetchMock, n = 0): [string, RequestInit] {
  const c = fn.mock.calls[n]
  if (!c) throw new Error(`fetch call ${n} was not made`)
  return c
}

export function sentHeaders(fn: FetchMock, n = 0): Record<string, string> {
  return fetchCall(fn, n)[1].headers as Record<string, string>
}

export function sentBody(fn: FetchMock, n = 0): Record<string, unknown> {
  return JSON.parse(fetchCall(fn, n)[1].body as string) as Record<string, unknown>
}
