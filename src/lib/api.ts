import { attachRequestMetadata, logFrontendEvent } from './frontend-logger'

export type ApiError = { message: string }

function getUserTimeZoneHeader() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

export async function api<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const startedAt = Date.now()
  const requestOptions = attachRequestMetadata(opts)
  const headers = new Headers(requestOptions.headers || {})
  if (!headers.has('Content-Type') && opts.body) headers.set('Content-Type', 'application/json')
  const timeZone = getUserTimeZoneHeader()
  if (timeZone && !headers.has('X-User-Timezone')) headers.set('X-User-Timezone', timeZone)

  try {
    const res = await fetch(url, { ...requestOptions, headers, credentials: 'include' })
    const text = await res.text()
    const data = text ? JSON.parse(text) : null

    logFrontendEvent({
      category: 'api.fetch',
      level: res.ok ? 'info' : 'warn',
      message: 'api_request_completed',
      data: {
        url,
        method: requestOptions.method || 'GET',
        status: res.status,
        ok: res.ok,
        durationMs: Date.now() - startedAt,
      },
    })

    if (!res.ok) {
      const msg = (data && data.message) ? data.message : `Request failed (${res.status})`
      throw new Error(msg)
    }
    return data as T
  } catch (error) {
    logFrontendEvent({
      category: 'api.fetch',
      level: 'error',
      message: 'api_request_failed',
      data: {
        url,
        method: requestOptions.method || 'GET',
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
    })
    throw error
  }
}
