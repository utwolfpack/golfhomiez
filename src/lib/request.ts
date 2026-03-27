import { createCorrelationId, getRoutePath, sendFrontendLog } from './frontend-logger'

function getUserTimeZoneHeader() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

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
  const timeZone = getUserTimeZoneHeader()
  if (timeZone && !headers.has('X-User-Timezone')) headers.set('X-User-Timezone', timeZone)

  const correlationId = headers.get('X-Correlation-Id') || createCorrelationId()
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
    const data = await parseJsonResponse<T>(response)

    if (shouldLog) {
      void sendFrontendLog({
        correlationId,
        level: response.ok ? 'info' : 'error',
        type: 'frontend_request',
        message: response.ok ? 'Frontend request completed' : 'Frontend request failed',
        action: `${opts.method || 'GET'} ${url}`,
        status: String(response.status),
        route: getRoutePath(),
      })
    }

    return { data, correlationId, response }
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
    throw error
  }
}
