import { handleExpiredSession } from './session-expiration'
import { getCorrelationId, getRoutePath, sendFrontendLog } from './frontend-logger'
import { sanitizeErrorResponseData, toUserFacingErrorMessage } from './user-facing-errors'
import { getUserTimeZone } from './time-zone'

function shouldSkipAutomaticLogging(url: string, headers: Headers) {
  return url.includes('/api/client-logs') || headers.get('X-Log-Source') === 'frontend-logger'
}

async function parseJsonResponse<T>(res: Response): Promise<T | null> {
  const text = await res.text()
  return text ? JSON.parse(text) as T : null
}

export async function requestJson<T>(url: string, opts: RequestInit = {}): Promise<{ data: T | null, correlationId: string, response: Response }> {
  const headers = new Headers(opts.headers || {})
  if (!headers.has('Content-Type') && opts.body) headers.set('Content-Type', 'application/json')
  const timeZone = getUserTimeZone()
  if (!headers.has('X-User-Timezone')) headers.set('X-User-Timezone', timeZone)

  const correlationId = headers.get('X-Correlation-Id') || getCorrelationId()
  headers.set('X-Correlation-Id', correlationId)

  const shouldLog = !shouldSkipAutomaticLogging(url, headers)
  if (shouldLog) {
    void sendFrontendLog({
      correlationId,
      level: 'info',
      type: 'frontend_request',
      message: 'Frontend request started',
      action: `${opts.method || 'GET'} ${url}`,
      status: 'started',
      route: getRoutePath(),
    })
  }

  try {
    const response = await fetch(url, { ...opts, headers, credentials: 'include' })
    const responseCorrelationId = response.headers.get('X-Correlation-Id') || correlationId
    const parsedData = await parseJsonResponse<T>(response)
    const data = response.ok ? parsedData : sanitizeErrorResponseData(parsedData, response.status, responseCorrelationId)
    handleExpiredSession('requestJson', response.status)

    if (shouldLog) {
      void sendFrontendLog({
        correlationId: responseCorrelationId,
        level: response.ok ? 'info' : 'error',
        type: 'frontend_request',
        message: response.ok ? 'Frontend request completed' : 'Frontend request failed',
        action: `${opts.method || 'GET'} ${url}`,
        status: String(response.status),
        route: getRoutePath(),
      })
    }

    return { data, correlationId: responseCorrelationId, response }
  } catch (error) {
    if (shouldLog) {
      void sendFrontendLog({
        correlationId,
        level: 'error',
        type: 'frontend_request',
        message: 'Frontend request crashed',
        action: `${opts.method || 'GET'} ${url}`,
        status: 'network_error',
        route: getRoutePath(),
        metadata: error instanceof Error ? { message: error.message, stack: error.stack } : { error: String(error) },
      })
    }
    throw new Error(toUserFacingErrorMessage(error, { fallback: 'We could not reach GolfHomiez. Check your connection and try again.' }))
  }
}
