const FRONTEND_LOG_ENDPOINT = '/api/client-logs'
const CORRELATION_STORAGE_KEY = 'gh_correlation_id'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type StructuredLogEvent = {
  category?: string
  level?: LogLevel
  message: string
  data?: Record<string, unknown>
}

function safeJson(value: unknown): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>
  } catch {
    return { serializationError: true }
  }
}

function createCorrelationId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // ignore
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function getCorrelationId(): string {
  const windowCorrelationId = typeof window !== 'undefined'
    ? (window as typeof window & { __ghCorrelationId?: string }).__ghCorrelationId
    : undefined
  if (windowCorrelationId) return windowCorrelationId

  try {
    const stored = window.sessionStorage.getItem(CORRELATION_STORAGE_KEY)
    if (stored) {
      ;(window as typeof window & { __ghCorrelationId?: string }).__ghCorrelationId = stored
      return stored
    }
  } catch {
    // ignore
  }

  const correlationId = createCorrelationId()
  if (typeof window !== 'undefined') {
    ;(window as typeof window & { __ghCorrelationId?: string }).__ghCorrelationId = correlationId
    try {
      window.sessionStorage.setItem(CORRELATION_STORAGE_KEY, correlationId)
    } catch {
      // ignore
    }
  }
  return correlationId
}

export function attachRequestMetadata(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers || {})
  if (!headers.has('X-Correlation-Id')) headers.set('X-Correlation-Id', getCorrelationId())

  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (timeZone && !headers.has('X-User-Timezone')) headers.set('X-User-Timezone', timeZone)
  } catch {
    // ignore
  }

  return {
    ...init,
    headers,
  }
}

function normalizeEvent(
  eventOrType: string | StructuredLogEvent,
  payload: Record<string, unknown> = {}
): StructuredLogEvent {
  if (typeof eventOrType === 'string') {
    return {
      category: 'frontend',
      level: 'info',
      message: eventOrType,
      data: payload,
    }
  }

  return {
    category: eventOrType.category || 'frontend',
    level: eventOrType.level || 'info',
    message: eventOrType.message,
    data: eventOrType.data || {},
  }
}

export function logFrontendEvent(
  eventOrType: string | StructuredLogEvent,
  payload: Record<string, unknown> = {}
) {
  if (typeof window === 'undefined') return

  const event = normalizeEvent(eventOrType, payload)
  const body = {
    source: 'frontend',
    category: event.category,
    level: event.level,
    eventType: event.message,
    message: event.message,
    correlationId: getCorrelationId(),
    timestamp: new Date().toISOString(),
    url: window.location.href,
    path: window.location.pathname,
    userAgent: window.navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    payload: safeJson(event.data),
  }

  const serialized = JSON.stringify(body)

  try {
    if (typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([serialized], { type: 'application/json' })
      if (navigator.sendBeacon(FRONTEND_LOG_ENDPOINT, blob)) return
    }
  } catch {
    // ignore and fall back to fetch
  }

  fetch(FRONTEND_LOG_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': getCorrelationId(),
    },
    body: serialized,
    credentials: 'include',
    keepalive: true,
  }).catch(() => {
    // ignore logging failures
  })
}

export function installBootDiagnostics() {
  if (typeof window === 'undefined') return
  const diagnosticWindow = window as typeof window & { __ghDiagnosticsInstalled?: boolean }
  if (diagnosticWindow.__ghDiagnosticsInstalled) return
  diagnosticWindow.__ghDiagnosticsInstalled = true

  logFrontendEvent('main_tsx_loaded', {
    readyState: document.readyState,
    language: navigator.language,
    onLine: navigator.onLine,
  })

  window.addEventListener('error', (event) => {
    const target = event.target as HTMLElement | null
    const isAssetFailure = !!(target && ['SCRIPT', 'LINK', 'IMG'].includes(target.tagName))
    const sourceTarget = target as HTMLScriptElement | HTMLLinkElement | HTMLImageElement | null

    logFrontendEvent(isAssetFailure ? 'asset_load_failure_runtime' : 'window_error_runtime', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error instanceof Error ? event.error.stack : null,
      tagName: target?.tagName ?? null,
      src: sourceTarget?.src || sourceTarget?.getAttribute?.('href') || null,
    })
  }, true)

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: string; stack?: string } | string | undefined
    logFrontendEvent('unhandled_rejection_runtime', {
      message: typeof reason === 'string' ? reason : reason?.message ?? 'Unhandled promise rejection',
      stack: typeof reason === 'string' ? null : reason?.stack ?? null,
    })
  })

  document.addEventListener('readystatechange', () => {
    logFrontendEvent('document_readystatechange_runtime', { readyState: document.readyState })
  })

  window.addEventListener('load', () => {
    const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    logFrontendEvent('window_load_runtime', {
      readyState: document.readyState,
      navigation: navigationEntry ? {
        type: navigationEntry.type,
        domContentLoadedEventEnd: navigationEntry.domContentLoadedEventEnd,
        loadEventEnd: navigationEntry.loadEventEnd,
        transferSize: navigationEntry.transferSize,
      } : null,
    })
  })
}
