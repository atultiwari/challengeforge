import { describe, expect, it } from 'vitest'
import { withDeadlockRetry } from '../src/tx'

const failing = (errno: number, times: number) => {
  let calls = 0
  return {
    work: async () => {
      calls += 1
      if (calls <= times) throw Object.assign(new Error(`errno ${errno}`), { errno })
      return 'done'
    },
    calls: () => calls,
  }
}

describe('withDeadlockRetry', () => {
  it('retries a deadlock (1213) and a MariaDB snapshot conflict (1020)', async () => {
    for (const errno of [1213, 1020]) {
      const f = failing(errno, 2)
      expect(await withDeadlockRetry(f.work)).toBe('done')
      expect(f.calls()).toBe(3)
    }
  })

  it('gives up after three attempts, and never retries a lock-wait timeout or other errors', async () => {
    await expect(withDeadlockRetry(failing(1213, 5).work)).rejects.toThrow('errno 1213')
    const timeout = failing(1205, 1)
    await expect(withDeadlockRetry(timeout.work)).rejects.toThrow('errno 1205')
    expect(timeout.calls()).toBe(1)
  })
})
