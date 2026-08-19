import { handleExpiredSession } from './session-expiration'
import { attachRequestMetadata, logFrontendEvent } from './frontend-logger'
import { toUserFacingErrorMessage } from './user-facing-errors'
import { getUserTimeZone } from './time-zone'

export type ApiError = Error & { message: string; suggestedTeamName?: string; [key: string]: unknown }

export async function api<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const startedAt = Date.now()
  const requestOptions = attachRequestMetadata(opts)
  const headers = new Headers(requestOptions.headers || {})
  if (!headers.has('Content-Type') && opts.body) headers.set('Content-Type', 'application/json')
  const timeZone = getUserTimeZone()
  if (!headers.has('X-User-Timezone')) headers.set('X-User-Timezone', timeZone)

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
      handleExpiredSession('api', res.status)
      const correlationId = res.headers.get('X-Correlation-Id') || headers.get('X-Correlation-Id')
      const rawMessage = (data && data.message) ? data.message : `Request failed (${res.status})`
      const msg = toUserFacingErrorMessage(rawMessage, { status: res.status, correlationId })
      const error = new Error(msg) as ApiError
      if (data && typeof data === 'object') Object.assign(error, data)
      error.message = msg
      error.correlationId = correlationId
      throw error
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
    if (error instanceof Error && 'correlationId' in error) throw error
    throw new Error(toUserFacingErrorMessage(error, { fallback: 'We could not reach GolfHomiez. Check your connection and try again.' }))
  }
}
