import { createHmac, timingSafeEqual } from 'node:crypto'

export const hmacHex = (secret: string, payload: string): string => createHmac('sha256', secret).update(payload, 'utf8').digest('hex')

/** Constant-time comparison of two hex strings. */
export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}
