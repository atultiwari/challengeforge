'use client'
/** Browser-side calls to the app's own API, unwrapping the { success, data, error } envelope. */
export interface ApiError {
  code: string
  message: string
  issues?: readonly { path: string; severity?: string; message: string }[]
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

const NETWORK_ERROR: ApiError = { code: 'network', message: 'Could not reach the server. Check your connection and try again.' }

/** Never throws: network failures and non-JSON replies (e.g. a host's 502 page) come back as errors. */
export async function requestJson<T>(method: 'POST' | 'PUT', url: string, body: unknown): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    return { ok: false, error: NETWORK_ERROR }
  }
  try {
    const json = (await res.json()) as { success: boolean; data: T; error: ApiError | null }
    return json.success ? { ok: true, data: json.data } : { ok: false, error: json.error ?? { code: 'unknown', message: 'Something went wrong.' } }
  } catch {
    return { ok: false, error: { code: `http_${res.status}`, message: `The server replied with an error (${res.status}). Please try again.` } }
  }
}

export const postJson = <T>(url: string, body: unknown): Promise<ApiResult<T>> => requestJson<T>('POST', url, body)
