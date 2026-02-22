export type ApiError = { message: string }

export async function api<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('auth_token')
  const headers = new Headers(opts.headers || {})
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(url, { ...opts, headers })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const msg = (data && data.message) ? data.message : `Request failed (${res.status})`
    throw new Error(msg)
  }
  return data as T
}
