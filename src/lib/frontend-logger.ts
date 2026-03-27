const CORRELATION_STORAGE_KEY = 'gh.correlationId'
const MAX_BEACONS_PER_PAGE = 50
const MAX_DETAIL_LENGTH = 180

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

export function getCorrelationId(): string {
  const fromWindow = (globalThis as any).__GH_CORRELATION_ID
  if (typeof fromWindow === 'string' && fromWindow) return fromWindow

  try {
    const stored = globalThis.sessionStorage?.getItem(CORRELATION_STORAGE_KEY)
    if (stored) {
      ;(globalThis as any).__GH_CORRELATION_ID = stored
      return stored
    }
  } catch {}

  const next = randomId()
  ;(globalThis as any).__GH_CORRELATION_ID = next
  try {
    globalThis.sessionStorage?.setItem(CORRELATION_STORAGE_KEY, next)
  } catch {}
  return next
}

export function setCorrelationId(correlationId: string): string {
  const next = correlationId || randomId()
  ;(globalThis as any).__GH_CORRELATION_ID = next
  try {
    globalThis.sessionStorage?.setItem(CORRELATION_STORAGE_KEY, next)
  } catch {}
  return next
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
  const detail = stringifyDetail({ level, ...(data || {}) })
  emitPixelBeacon(stage, detail)
}

export function markBootStage(stage: string, data?: Record<string, unknown>): void {
  emitPixelBeacon(stage, stringifyDetail(data), true)
}

export function emitFrontendStage(stage: string, detail?: string): void {
  emitPixelBeacon(stage, detail, true)
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
        const detail = stringifyDetail({
          message: event?.message || event?.error?.message || 'window error',
          filename: event?.filename || '',
          lineno: typeof event?.lineno === 'number' ? event.lineno : 0,
          colno: typeof event?.colno === 'number' ? event.colno : 0,
        })
        emitPixelBeacon('runtime_window_error', detail)
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
      const detail = stringifyDetail(reason?.message || reason || 'unhandled rejection')
      emitPixelBeacon('runtime_unhandled_rejection', detail)
    } finally {
      handlingRuntimeError = false
    }
  })
}

export const installRuntimeDiagnostics = installFrontendDiagnostics

export default {
  attachRequestMetadata,
  emitFrontendStage,
  getCorrelationId,
  installFrontendDiagnostics,
  installRuntimeDiagnostics,
  logFrontendEvent,
  markBootStage,
  setCorrelationId,
}
