/**
 * JSON columns behave differently per engine: MySQL 8 returns parsed values,
 * MariaDB (JSON = LONGTEXT + CHECK) returns strings. Read through fromJson and
 * write through toJson everywhere, so the rest of the code never knows.
 */
export function toJson(value: unknown): string {
  return JSON.stringify(value)
}

export function fromJson<T = unknown>(value: unknown): T {
  if (typeof value === 'string') return JSON.parse(value) as T
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString('utf8')) as T
  return value as T
}

/** TINYINT(1) reads back as 0/1. */
export const toBool = (value: number | boolean): boolean => value === true || value === 1

/**
 * Key-order-independent serialisation. MySQL's JSON type re-orders object
 * keys on storage, so equality must not depend on key order.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
