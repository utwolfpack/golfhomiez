const SESSION_KEY = 'golfhomiez.frontend.correlationId'
const BUFFER_KEY = 'golfhomiez.frontend.logBuffer'
const MAX_BUFFER_SIZE = 100
const MAX_PAYLOAD_ITEMS = 20

export type FrontendLogLevel = 'info' | 'warn' | 'error'

export type FrontendLogEntry = {
  message: string
  level?: FrontendLogLevel
  category?: string
  correlationId?: string
  route?: string
  data?: Record<string, unknown>
}

type PersistedEntry = FrontendLogEntry & {
  timestamp: string
  correlationId: string
  pageUrl: string
  userAgent: string
}

function canUseBrowserStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

export function getCorrelationId() {
  if (!canUseBrowserStorage()) return 'server-render'

  const existing = window.sessionStorage.getItem(SESSION_KEY)
  if (existing) return existing

  const created = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `cid-${Date.now()}-${Math.random().toString(16).slice(2)}`

  window.sessionStorage.setItem(SESSION_KEY, created)
  return created
}

function getBuffer(): PersistedEntry[] {
  if (!canUseBrowserStorage()) return []
  try {
    const raw = window.localStorage.getItem(BUFFER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function setBuffer(entries: PersistedEntry[]) {
  if (!canUseBrowserStorage()) return
  try {
    window.localStorage.setItem(BUFFER_KEY, JSON.stringify(entries.slice(-MAX_BUFFER_SIZE)))
  } catch {
    // ignore quota/storage issues
  }
}

function toPersistedEntry(entry: FrontendLogEntry): PersistedEntry {
  return {
    timestamp: new Date().toISOString(),
    level: entry.level || 'info',
    category: entry.category || 'app',
    message: entry.message,
    correlationId: entry.correlationId || getCorrelationId(),
    route: entry.route || (typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}${window.location.hash}` : ''),
    pageUrl: typeof window !== 'undefined' ? window.location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    data: sanitize(entry.data || {}),
  }
}

function sanitize(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth > 5) return '[truncated]'
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, sanitize(val, depth + 1)]))
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 1997)}...`
  return value
}

function getDiagnosticsSnapshot() {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  const screenInfo = typeof window !== 'undefined' ? window.screen : null
  const perfNav = typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
    ? performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    : undefined

  return sanitize({
    online: nav ? nav.onLine : null,
    language: nav?.language || null,
    languages: nav?.languages || null,
    cookieEnabled: nav?.cookieEnabled ?? null,
    platform: nav?.platform || null,
    vendor: nav?.vendor || null,
    hardwareConcurrency: nav?.hardwareConcurrency ?? null,
    maxTouchPoints: nav?.maxTouchPoints ?? null,
    viewport: typeof window !== 'undefined'
      ? {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        }
      : null,
    screen: screenInfo
      ? {
          width: screenInfo.width,
          height: screenInfo.height,
          availWidth: screenInfo.availWidth,
          availHeight: screenInfo.availHeight,
        }
      : null,
    standalone: typeof navigator !== 'undefined' && 'standalone' in navigator ? Boolean((navigator as Navigator & { standalone?: boolean }).standalone) : null,
    referrer: typeof document !== 'undefined' ? document.referrer || null : null,
    visibilityState: typeof document !== 'undefined' ? document.visibilityState : null,
    navTiming: perfNav
      ? {
          type: perfNav.type,
          domInteractive: Math.round(perfNav.domInteractive),
          domContentLoaded: Math.round(perfNav.domContentLoadedEventEnd),
          loadEventEnd: Math.round(perfNav.loadEventEnd),
          responseEnd: Math.round(perfNav.responseEnd),
          transferSize: perfNav.transferSize,
          encodedBodySize: perfNav.encodedBodySize,
          decodedBodySize: perfNav.decodedBodySize,
        }
      : null,
  })
}

function enqueue(entry: FrontendLogEntry) {
  const persisted = toPersistedEntry(entry)
  const buffer = getBuffer()
  buffer.push(persisted)
  setBuffer(buffer)
  return persisted
}

async function postEntries(entries: PersistedEntry[]) {
  if (typeof fetch === 'undefined' || entries.length === 0) return false

  const res = await fetch('/api/client-logs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': entries[0].correlationId,
    },
    credentials: 'include',
    keepalive: true,
    body: JSON.stringify({
      correlationId: entries[0].correlationId,
      entries,
    }),
  })

  return res.ok
}

export async function flushFrontendLogs() {
  const buffer = getBuffer()
  if (!buffer.length) return

  const batch = buffer.slice(0, MAX_PAYLOAD_ITEMS)
  try {
    const ok = await postEntries(batch)
    if (!ok) return
    setBuffer(buffer.slice(batch.length))
  } catch {
    // keep buffer for later retry
  }
}

export function logFrontendEvent(entry: FrontendLogEntry) {
  const persisted = enqueue(entry)
  void flushFrontendLogs()
  return persisted.correlationId
}

export function attachRequestMetadata(init: RequestInit = {}) {
  const headers = new Headers(init.headers || {})
  headers.set('X-Correlation-Id', getCorrelationId())
  return { ...init, headers }
}

export function installGlobalFrontendLogging() {
  if (typeof window === 'undefined') return

  flushBootDiagnosticsFromHtml()

  logFrontendEvent({
    message: 'frontend_bootstrap_started',
    category: 'lifecycle',
    data: getDiagnosticsSnapshot(),
  })

  window.addEventListener('error', (event) => {
    logFrontendEvent({
      level: 'error',
      category: 'window.error',
      message: event.message || 'window_error',
      data: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack || null,
        diagnostics: getDiagnosticsSnapshot(),
      },
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    logFrontendEvent({
      level: 'error',
      category: 'window.unhandledrejection',
      message: 'unhandled_promise_rejection',
      data: {
        reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason,
        diagnostics: getDiagnosticsSnapshot(),
      },
    })
  })

  window.addEventListener('load', () => {
    logFrontendEvent({
      category: 'lifecycle',
      message: 'window_load_completed',
      data: getDiagnosticsSnapshot(),
    })
  })

  document.addEventListener('visibilitychange', () => {
    logFrontendEvent({
      category: 'document.visibilitychange',
      message: 'visibility_changed',
      data: {
        visibilityState: document.visibilityState,
      },
    })
  })
}

function flushBootDiagnosticsFromHtml() {
  if (!canUseBrowserStorage()) return

  try {
    const raw = window.localStorage.getItem('golfhomiez.frontend.bootLogs')
    if (!raw) return
    const entries = JSON.parse(raw)
    if (!Array.isArray(entries)) return

    for (const entry of entries) {
      enqueue({
        level: entry.level || 'info',
        category: entry.category || 'boot',
        message: entry.message || 'boot_event',
        correlationId: entry.correlationId || getCorrelationId(),
        data: sanitize(entry.data || {}),
      })
    }
  } catch {
    // ignore parse issues
  } finally {
    try {
      window.localStorage.removeItem('golfhomiez.frontend.bootLogs')
    } catch {
      // ignore
    }
  }
}
