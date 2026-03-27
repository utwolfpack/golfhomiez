type ClientDiagnosticPayload = {
  level?: 'info' | 'error'
  type: string
  message: string
  details?: Record<string, unknown>
}

declare global {
  interface Window {
    __golfhomiezLogQueue?: ClientDiagnosticPayload[]
    __golfhomiezClientLoggingInitialized?: boolean
  }
}

const ENDPOINT = '/api/client-log'
const MAX_QUEUE = 50
let initialized = false

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function safeStringify(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'string') return value.length > 4000 ? `${value.slice(0, 3997)}...` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(safeStringify)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, safeStringify(val)]))
  }
  return String(value)
}

function getEnvironmentDetails() {
  return {
    href: window.location.href,
    path: window.location.pathname,
    referrer: document.referrer || null,
    userAgent: navigator.userAgent,
    language: navigator.language,
    onLine: navigator.onLine,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: window.devicePixelRatio || 1,
    },
    screen: {
      width: window.screen?.width ?? null,
      height: window.screen?.height ?? null,
    },
  }
}

function enqueue(payload: ClientDiagnosticPayload) {
  const queue = window.__golfhomiezLogQueue || []
  queue.push(payload)
  while (queue.length > MAX_QUEUE) queue.shift()
  window.__golfhomiezLogQueue = queue
}

function transmit(payload: ClientDiagnosticPayload) {
  const body = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...payload,
    details: {
      ...getEnvironmentDetails(),
      ...toRecord(safeStringify(payload.details)),
    },
  })

  try {
    if (typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))
      if (ok) return
    }
  } catch {
    // fall through to fetch
  }

  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    keepalive: true,
    body,
  }).catch(() => {
    enqueue(payload)
  })
}

export function logClientEvent(type: string, message: string, details: Record<string, unknown> = {}, level: 'info' | 'error' = 'info') {
  const payload = { type, message, details, level }
  enqueue(payload)
  transmit(payload)
}

function flushPendingQueue() {
  const pending = [...(window.__golfhomiezLogQueue || [])]
  window.__golfhomiezLogQueue = []
  for (const payload of pending) transmit(payload)
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  return { value: safeStringify(error) }
}

function installConsoleErrorProxy() {
  const original = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    const message = args.map((arg) => {
      if (arg instanceof Error) return arg.message
      if (typeof arg === 'string') return arg
      try {
        return JSON.stringify(safeStringify(arg))
      } catch {
        return String(arg)
      }
    }).join(' | ')

    logClientEvent('console_error', 'console.error called in browser', { message, args: safeStringify(args) }, 'error')
    original(...args)
  }
}

function installGlobalHandlers() {
  window.addEventListener('error', (event) => {
    logClientEvent('window_error', event.message || 'Unhandled browser error', {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: normalizeError(event.error),
    }, 'error')
  })

  window.addEventListener('unhandledrejection', (event) => {
    logClientEvent('unhandled_rejection', 'Unhandled promise rejection', {
      reason: normalizeError(event.reason),
    }, 'error')
  })

  window.addEventListener('load', () => {
    window.setTimeout(() => {
      const root = document.getElementById('root')
      const hasVisibleContent = Boolean(root && (root.childElementCount > 0 || String(root.textContent || '').trim()))
      if (!hasVisibleContent) {
        logClientEvent('blank_screen_probe', 'App root is blank after window load', {
          rootChildElementCount: root?.childElementCount ?? null,
          rootTextLength: root?.textContent?.trim().length ?? 0,
          documentReadyState: document.readyState,
        }, 'error')
      }
    }, 4000)
  })

  document.addEventListener('visibilitychange', () => {
    logClientEvent('visibility_change', 'Document visibility changed', { visibilityState: document.visibilityState })
  })
}

export function initClientLogging() {
  if (initialized) return
  initialized = true
  window.__golfhomiezClientLoggingInitialized = true
  installConsoleErrorProxy()
  installGlobalHandlers()
  flushPendingQueue()
  logClientEvent('client_logging_ready', 'Client logging initialized')
}
