export type FrontendLogEntry = {
  correlationId: string
  level?: 'info' | 'error' | 'warn'
  type: string
  message: string
  route?: string
  action?: string
  status?: string
  metadata?: Record<string, unknown> | null
}

const FRONTEND_LOG_ENDPOINT = '/api/client-logs'

function isLoggingEndpoint(url: string) {
  return url.includes(FRONTEND_LOG_ENDPOINT)
}

export function createCorrelationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function getRoutePath() {
  if (typeof window === 'undefined') return ''
  return `${window.location.pathname}${window.location.search}`
}

export async function sendFrontendLog(entry: FrontendLogEntry) {
  if (typeof window === 'undefined') return
  try {
    await fetch(FRONTEND_LOG_ENDPOINT, {
      method: 'POST',
      keepalive: true,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-Id': entry.correlationId,
        'X-Log-Source': 'frontend-logger',
      },
      body: JSON.stringify({
        ...entry,
        route: entry.route || getRoutePath(),
      }),
    })
  } catch (error) {
    if (!isLoggingEndpoint(FRONTEND_LOG_ENDPOINT)) {
      console.error('Frontend log delivery failed', error)
    }
  }
}

export function installGlobalFrontendLogging() {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (event) => {
    const correlationId = createCorrelationId()
    void sendFrontendLog({
      correlationId,
      level: 'error',
      type: 'window_error',
      message: event.message || 'Unhandled browser error',
      metadata: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error
      ? { message: event.reason.message, stack: event.reason.stack }
      : { reason: String(event.reason) }

    void sendFrontendLog({
      correlationId: createCorrelationId(),
      level: 'error',
      type: 'unhandled_promise_rejection',
      message: 'Unhandled promise rejection',
      metadata: reason,
    })
  })
}
