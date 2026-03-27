import { logClientEvent } from './clientLogger'

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

  let res: Response
  try {
    res = await fetch(url, { ...opts, headers, credentials: 'include' })
  } catch (error) {
    logClientEvent('api_network_error', 'Fetch failed before a response was received', {
      url,
      method: opts.method || 'GET',
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { value: String(error) },
    }, 'error')
    throw error
  }

  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (error) {
    logClientEvent('api_parse_error', 'API response could not be parsed as JSON', {
      url,
      method: opts.method || 'GET',
      status: res.status,
      bodyPreview: text.slice(0, 500),
      error: error instanceof Error ? { name: error.name, message: error.message } : { value: String(error) },
    }, 'error')
    throw error
  }

  if (!res.ok) {
    const msg = (data && data.message) ? data.message : `Request failed (${res.status})`
    logClientEvent('api_response_error', 'API request returned a non-OK response', {
      url,
      method: opts.method || 'GET',
      status: res.status,
      response: data,
    }, 'error')
    throw new Error(msg)
  }
  return data as T
}
