/* Iranti Control Plane — Shared API client */
/* All control-plane API calls go through this module. */

const BASE = '/api/control-plane'

export async function apiFetch<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString())
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}
