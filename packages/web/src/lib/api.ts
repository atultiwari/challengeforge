'use client'
/** Browser-side calls to the app's own API, unwrapping the { success, data, error } envelope. */
export interface ApiError {
  code: string
  message: string
  issues?: readonly { path: string; message: string }[]
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export async function postJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as { success: boolean; data: T; error: ApiError | null }
    return json.success ? { ok: true, data: json.data } : { ok: false, error: json.error ?? { code: 'unknown', message: 'Something went wrong.' } }
  } catch {
    return { ok: false, error: { code: 'network', message: 'Could not reach the server. Check your connection and try again.' } }
  }
}
