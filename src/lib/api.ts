export type ApiError = { message: string }

function getUserTimeZoneHeader() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

export async function api<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers || {})
  if (!headers.has('Content-Type') && opts.body) headers.set('Content-Type', 'application/json')
  const timeZone = getUserTimeZoneHeader()
  if (timeZone && !headers.has('X-User-Timezone')) headers.set('X-User-Timezone', timeZone)

  const res = await fetch(url, { ...opts, headers, credentials: 'include' })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const msg = (data && data.message) ? data.message : `Request failed (${res.status})`
    throw new Error(msg)
  }
  return data as T
}
