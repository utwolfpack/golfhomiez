export const CORRELATION_STORAGE_KEY = 'gh.correlationId'
const CORRELATION_WINDOW_KEY = '__GH_CORRELATION_ID'
const MAX_BEACONS_PER_PAGE = 50
const MAX_DETAIL_LENGTH = 180
const FRONTEND_LOG_ENDPOINT = '/api/client-logs'

const sentStages = new Set<string>()
let sentCount = 0
let runtimeHandlersInstalled = false
let handlingRuntimeError = false

function randomId(): string {
  try {
    const cryptoObj = globalThis.crypto as Crypto | undefined
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
      return cryptoObj.randomUUID()
    }
  } catch {}

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export const createCorrelationId = randomId

export function getCorrelationId(): string {
  const fromWindow = (globalThis as Record<string, unknown>)[CORRELATION_WINDOW_KEY]
  if (typeof fromWindow === 'string' && fromWindow) return fromWindow

  try {
    const stored = globalThis.sessionStorage?.getItem(CORRELATION_STORAGE_KEY)
    if (stored) {
      ;(globalThis as Record<string, unknown>)[CORRELATION_WINDOW_KEY] = stored
      return stored
    }
  } catch {}

  const next = randomId()
  ;(globalThis as Record<string, unknown>)[CORRELATION_WINDOW_KEY] = next
  try {
    globalThis.sessionStorage?.setItem(CORRELATION_STORAGE_KEY, next)
  } catch {}
  return next
}

export function setCorrelationId(correlationId: string): string {
  const next = correlationId || randomId()
  ;(globalThis as Record<string, unknown>)[CORRELATION_WINDOW_KEY] = next
  try {
    globalThis.sessionStorage?.setItem(CORRELATION_STORAGE_KEY, next)
  } catch {}
  return next
}

export function getRoutePath(): string {
  return globalThis.location?.pathname || '/'
}

export function attachRequestMetadata(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers || {})
  if (!headers.has('X-Correlation-Id')) {
    headers.set('X-Correlation-Id', getCorrelationId())
  }
  return {
    ...init,
    headers,
  }
}

function truncate(value: string): string {
  return value.length > MAX_DETAIL_LENGTH ? `${value.slice(0, MAX_DETAIL_LENGTH - 3)}...` : value
}

function stringifyDetail(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return truncate(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (value instanceof Error) {
    return truncate(value.stack || value.message || value.name)
  }

  try {
    return truncate(JSON.stringify(value))
  } catch {
    return truncate(String(value))
  }
}

function safeJson(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth > 5) return '[truncated]'
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 1997)}...` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }
  if (Array.isArray(value)) return value.map((item) => safeJson(item, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, safeJson(val, depth + 1)]))
  }
  return String(value)
}

function buildBeaconUrl(stage: string, detail?: string): string {
  const currentUrl = globalThis.location?.href || '/'
  const origin = globalThis.location?.origin || currentUrl
  const url = new URL('/diag/pixel.gif', origin)
  url.searchParams.set('cid', getCorrelationId())
  url.searchParams.set('stage', stage)
  url.searchParams.set('path', globalThis.location?.pathname || '/')
  if (detail) url.searchParams.set('detail', truncate(detail))
  url.searchParams.set('ts', String(Date.now()))
  return url.toString()
}

function emitPixelBeacon(stage: string, detail?: string, dedupe = false): void {
  if (!stage || sentCount >= MAX_BEACONS_PER_PAGE) return
  if (dedupe && sentStages.has(stage)) return

  if (dedupe) sentStages.add(stage)
  sentCount += 1

  try {
    const img = new Image(1, 1)
    img.decoding = 'async'
    img.referrerPolicy = 'strict-origin-when-cross-origin'
    img.src = buildBeaconUrl(stage, detail)
  } catch {
    // swallow logger transport errors to avoid recursive failures
  }
}

type StructuredArgs = {
  category?: string
  level?: string
  message: string
  data?: Record<string, unknown>
}

export type FrontendLogPayload = {
  correlationId?: string
  level?: string
  type?: string
  message: string
  action?: string | null
  status?: string | null
  route?: string | null
  metadata?: Record<string, unknown> | null
  userAgent?: string | null
}

function buildFrontendPayload(message: string, level: string, category: string, data?: Record<string, unknown>): FrontendLogPayload {
  const metadata = safeJson(data || {}) as Record<string, unknown>
  return {
    correlationId: typeof metadata.correlationId === 'string' ? metadata.correlationId : getCorrelationId(),
    level,
    type: category || 'frontend_event',
    message,
    action: typeof metadata.action === 'string' ? metadata.action : null,
    status: typeof metadata.status === 'string' ? metadata.status : null,
    route: getRoutePath(),
    metadata,
    userAgent: globalThis.navigator?.userAgent || null,
  }
}

export async function sendFrontendLog(payload: FrontendLogPayload): Promise<void> {
  const enriched = {
    correlationId: payload.correlationId || getCorrelationId(),
    level: payload.level || 'info',
    type: payload.type || 'frontend_event',
    message: payload.message,
    action: payload.action ?? null,
    status: payload.status ?? null,
    route: payload.route ?? getRoutePath(),
    metadata: safeJson(payload.metadata || null),
    userAgent: payload.userAgent || globalThis.navigator?.userAgent || null,
  }

  const body = JSON.stringify(enriched)

  try {
    if (typeof globalThis.navigator?.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      const accepted = globalThis.navigator.sendBeacon(FRONTEND_LOG_ENDPOINT, blob)
      if (accepted) return
    }
  } catch {}

  try {
    await fetch(FRONTEND_LOG_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-Id': enriched.correlationId,
        'X-Log-Source': 'frontend-logger',
      },
      body,
      credentials: 'include',
      keepalive: true,
    })
  } catch {
    // swallow logger transport errors to avoid recursive failures
  }
}

export function logFrontendEvent(message: string, data?: Record<string, unknown>): void
export function logFrontendEvent(args: StructuredArgs): void
export function logFrontendEvent(
  arg1: string | StructuredArgs,
  arg2?: Record<string, unknown>
): void {
  let message = ''
  let data: Record<string, unknown> | undefined
  let category = ''
  let level = 'info'

  if (typeof arg1 === 'string') {
    message = arg1
    data = arg2
  } else {
    message = arg1.message
    data = arg1.data
    category = arg1.category || ''
    level = arg1.level || 'info'
  }

  const stage = category ? `${category}:${message}` : message
  const detail = stringifyDetail({ correlationId: getCorrelationId(), level, ...(data || {}) })
  emitPixelBeacon(stage, detail)
  void sendFrontendLog(buildFrontendPayload(message, level, category, data))
}

export function markBootStage(stage: string, data?: Record<string, unknown>): void {
  emitPixelBeacon(stage, stringifyDetail({ correlationId: getCorrelationId(), ...(data || {}) }), true)
}

export function emitFrontendStage(stage: string, detail?: string): void {
  emitPixelBeacon(stage, detail ? stringifyDetail({ correlationId: getCorrelationId(), detail }) : stringifyDetail({ correlationId: getCorrelationId() }), true)
}

export function installFrontendDiagnostics(): void {
  if (runtimeHandlersInstalled) return
  runtimeHandlersInstalled = true

  globalThis.addEventListener?.(
    'error',
    (event: Event | any) => {
      if (handlingRuntimeError) return
      handlingRuntimeError = true
      try {
        const detail = {
          correlationId: getCorrelationId(),
          message: event?.message || event?.error?.message || 'window error',
          filename: event?.filename || '',
          lineno: typeof event?.lineno === 'number' ? event.lineno : 0,
          colno: typeof event?.colno === 'number' ? event.colno : 0,
        }
        emitPixelBeacon('runtime_window_error', stringifyDetail(detail))
        void sendFrontendLog(buildFrontendPayload('runtime_window_error', 'error', 'runtime', detail))
      } finally {
        handlingRuntimeError = false
      }
    },
    true
  )

  globalThis.addEventListener?.('unhandledrejection', (event: PromiseRejectionEvent | any) => {
    if (handlingRuntimeError) return
    handlingRuntimeError = true
    try {
      const reason = event?.reason
      const detail = {
        correlationId: getCorrelationId(),
        reason: reason?.message || reason || 'unhandled rejection',
      }
      emitPixelBeacon('runtime_unhandled_rejection', stringifyDetail(detail))
      void sendFrontendLog(buildFrontendPayload('runtime_unhandled_rejection', 'error', 'runtime', detail))
    } finally {
      handlingRuntimeError = false
    }
  })
}

export const installRuntimeDiagnostics = installFrontendDiagnostics

export default {
  attachRequestMetadata,
  createCorrelationId,
  emitFrontendStage,
  getCorrelationId,
  getRoutePath,
  installFrontendDiagnostics,
  installRuntimeDiagnostics,
  logFrontendEvent,
  markBootStage,
  sendFrontendLog,
  setCorrelationId,
}
