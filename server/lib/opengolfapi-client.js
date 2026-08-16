import { gunzipSync } from 'node:zlib'
import { logApi } from './logger.js'
import { recordExternalApiCall } from './external-api-metrics.js'
import { normalizeStateCode, stateNameForCode } from './us-states.js'

const DEFAULT_BASE_URL = 'https://api.opengolfapi.org'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_REQUEST_INTERVAL_MS = 750
const DEFAULT_MAX_RETRIES = 6
const DEFAULT_RETRY_BASE_MS = 2_000
const DEFAULT_RETRY_MAX_MS = 120_000
const DEFAULT_RATE_LIMIT_RESERVE = 5
const DEFAULT_RATE_LIMIT_RESET_GRACE_MS = 5_000
const DEFAULT_STATE_PAGE_LIMIT = 500
const DEFAULT_BULK_DATASET_URL = 'https://github.com/opengolfapi/data/releases/latest/download/opengolfapi-us.geojson.gz'

let openGolfApiBulkDatasetPromise = null

let openGolfApiThrottle = Promise.resolve()
let lastOpenGolfApiRequestAt = 0
let openGolfApiRateLimitState = {
  limit: null,
  remaining: null,
  resetAt: null,
  resetAtMs: null,
  updatedAt: null,
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}


function cancellationError(signal = null) {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  const error = new Error('OpenGolfAPI request cancelled')
  error.name = 'AbortError'
  error.code = 'SCHEDULED_JOB_CANCELLED'
  return error
}

function sleep(ms, signal = null) {
  const waitMs = Math.max(0, Math.trunc(Number(ms) || 0))
  if (waitMs <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancellationError(signal))
    const onAbort = () => {
      globalThis.clearTimeout(timer)
      reject(cancellationError(signal))
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, waitMs)
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

function envInteger(names, fallback, { allowZero = false } = {}) {
  const keys = Array.isArray(names) ? names : [names]
  for (const key of keys) {
    const raw = process.env[key]
    if (raw == null || raw === '') continue
    const numeric = Math.trunc(Number(raw))
    if (Number.isFinite(numeric) && (allowZero ? numeric >= 0 : numeric > 0)) return numeric
  }
  return fallback
}

function envBoolean(names, fallback) {
  const keys = Array.isArray(names) ? names : [names]
  for (const key of keys) {
    const raw = normalizeText(process.env[key]).toLowerCase()
    if (!raw) continue
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true
    if (['0', 'false', 'no', 'off'].includes(raw)) return false
  }
  return fallback
}

export function getOpenGolfApiRateLimitConfig() {
  return {
    requestIntervalMs: envInteger(['OPEN_GOLF_API_REQUEST_INTERVAL_MS', 'OPENGOLFAPI_REQUEST_INTERVAL_MS'], DEFAULT_REQUEST_INTERVAL_MS, { allowZero: true }),
    maxRetries: envInteger(['OPEN_GOLF_API_MAX_RETRIES', 'OPENGOLFAPI_MAX_RETRIES'], DEFAULT_MAX_RETRIES, { allowZero: true }),
    retryBaseMs: envInteger(['OPEN_GOLF_API_RETRY_BASE_MS', 'OPENGOLFAPI_RETRY_BASE_MS'], DEFAULT_RETRY_BASE_MS),
    retryMaxMs: envInteger(['OPEN_GOLF_API_RETRY_MAX_MS', 'OPENGOLFAPI_RETRY_MAX_MS'], DEFAULT_RETRY_MAX_MS),
    rateLimitReserve: envInteger(['OPEN_GOLF_API_RATE_LIMIT_RESERVE', 'OPENGOLFAPI_RATE_LIMIT_RESERVE'], DEFAULT_RATE_LIMIT_RESERVE, { allowZero: true }),
    resetGraceMs: envInteger(['OPEN_GOLF_API_RATE_LIMIT_RESET_GRACE_MS', 'OPENGOLFAPI_RATE_LIMIT_RESET_GRACE_MS'], DEFAULT_RATE_LIMIT_RESET_GRACE_MS, { allowZero: true }),
    waitForDailyReset: envBoolean(['OPEN_GOLF_API_WAIT_FOR_DAILY_RESET', 'OPENGOLFAPI_WAIT_FOR_DAILY_RESET'], true),
    adaptiveDailyPacing: envBoolean(['OPEN_GOLF_API_ADAPTIVE_DAILY_PACING', 'OPENGOLFAPI_ADAPTIVE_DAILY_PACING'], false),
  }
}

export function getOpenGolfApiStateImportConfig() {
  return {
    pageLimit: Math.min(500, envInteger(['OPEN_GOLF_API_STATE_PAGE_LIMIT', 'OPENGOLFAPI_STATE_PAGE_LIMIT'], DEFAULT_STATE_PAGE_LIMIT)),
  }
}

export function parseOpenGolfApiRetryAfterMs(value, nowMs = Date.now()) {
  const raw = normalizeText(value)
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const dateMs = Date.parse(raw)
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - nowMs)
  return null
}

export function parseOpenGolfApiRateLimitResetMs(value) {
  const raw = normalizeText(value)
  if (!raw) return null
  const numeric = Number(raw)
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 10_000_000_000 ? Math.trunc(numeric) : Math.trunc(numeric * 1000)
  }
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function nextUtcDayMs(nowMs = Date.now()) {
  const now = new Date(nowMs)
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
}

function rateLimitHeaderNumber(headers, name) {
  const raw = normalizeText(headers?.get?.(name))
  if (!raw) return null
  const numeric = Math.trunc(Number(raw))
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

function captureOpenGolfApiRateLimit(response, payload = null, correlationId = null, endpoint = null) {
  const limit = rateLimitHeaderNumber(response?.headers, 'x-ratelimit-limit')
  const remaining = rateLimitHeaderNumber(response?.headers, 'x-ratelimit-remaining')
  const headerReset = response?.headers?.get?.('x-ratelimit-reset')
  const bodyReset = payload?.resetAt ?? payload?.reset_at ?? payload?.rateLimitReset ?? null
  const resetAtMs = parseOpenGolfApiRateLimitResetMs(headerReset || bodyReset)
  if (limit == null && remaining == null && resetAtMs == null) return getOpenGolfApiRateLimitSnapshot()

  openGolfApiRateLimitState = {
    limit: limit ?? openGolfApiRateLimitState.limit,
    remaining: remaining ?? openGolfApiRateLimitState.remaining,
    resetAt: resetAtMs != null ? new Date(resetAtMs).toISOString() : openGolfApiRateLimitState.resetAt,
    resetAtMs: resetAtMs ?? openGolfApiRateLimitState.resetAtMs,
    updatedAt: new Date().toISOString(),
  }
  logApi('opengolfapi_rate_limit_observed', {
    correlationId,
    apiType: 'opengolfapi',
    endpoint,
    limit: openGolfApiRateLimitState.limit,
    remaining: openGolfApiRateLimitState.remaining,
    resetAt: openGolfApiRateLimitState.resetAt,
  })
  return getOpenGolfApiRateLimitSnapshot()
}

export function getOpenGolfApiRateLimitSnapshot() {
  const hasKey = Boolean(normalizeText(process.env.OPEN_GOLF_API_KEY || process.env.OPENGOLFAPI_API_KEY || process.env.OPENGOLFAPI_KEY))
  return {
    limit: openGolfApiRateLimitState.limit,
    remaining: openGolfApiRateLimitState.remaining,
    resetAt: openGolfApiRateLimitState.resetAt,
    updatedAt: openGolfApiRateLimitState.updatedAt,
    authentication: hasKey ? 'keyed' : 'anonymous',
  }
}

export function resetOpenGolfApiRateLimitState() {
  openGolfApiRateLimitState = { limit: null, remaining: null, resetAt: null, resetAtMs: null, updatedAt: null }
  lastOpenGolfApiRequestAt = 0
  openGolfApiThrottle = Promise.resolve()
}

export function isOpenGolfApiRetriableStatus(statusCode) {
  const status = Number(statusCode)
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}

function isRetryableNetworkError(error) {
  return error?.name === 'AbortError' || error instanceof TypeError || /fetch failed|network|timeout/i.test(normalizeText(error?.message))
}

function isDailyRateLimitError(error) {
  if (Number(error?.statusCode) !== 429) return false
  const message = normalizeText(error?.message).toLowerCase()
  return error?.rateLimitRemaining === 0 || Boolean(error?.rateLimitResetAtMs) || /daily.*limit|limit.*daily|anonymous limit reached/.test(message)
}

export function getOpenGolfApiRetryDelayMs({ statusCode = null, attempt = 0, retryAfterHeader = '' } = {}) {
  const { retryBaseMs, retryMaxMs } = getOpenGolfApiRateLimitConfig()
  const retryAfterMs = parseOpenGolfApiRetryAfterMs(retryAfterHeader)
  if (Number(statusCode) === 429 && retryAfterMs != null) return Math.min(Math.max(retryAfterMs, retryBaseMs), retryMaxMs)
  const retryAttempt = Math.max(0, Math.trunc(Number(attempt) || 0))
  return Math.min(retryMaxMs, retryBaseMs * (2 ** retryAttempt))
}

export function getOpenGolfApiAdaptiveIntervalMs({ nowMs = Date.now(), requestIntervalMs = null, rateLimitReserve = null } = {}) {
  const config = getOpenGolfApiRateLimitConfig()
  const minimumInterval = Math.max(0, Math.trunc(Number(requestIntervalMs ?? config.requestIntervalMs) || 0))
  const reserve = Math.max(0, Math.trunc(Number(rateLimitReserve ?? config.rateLimitReserve) || 0))
  const remaining = Number(openGolfApiRateLimitState.remaining)
  const resetAtMs = Number(openGolfApiRateLimitState.resetAtMs)
  if (!Number.isFinite(remaining) || !Number.isFinite(resetAtMs) || resetAtMs <= nowMs) return minimumInterval
  const usableRequests = Math.max(1, Math.trunc(remaining) - reserve)
  const timeRemainingMs = Math.max(0, resetAtMs - nowMs)
  return Math.max(minimumInterval, Math.ceil(timeRemainingMs / usableRequests))
}

async function waitForOpenGolfApiRequestSlot(endpoint, correlationId = null, { signal = null, waitForDailyReset = false, adaptiveDailyPacing = false, requestIntervalMs = null, onRateLimitEvent = null } = {}) {
  const config = getOpenGolfApiRateLimitConfig()
  const waitTurn = openGolfApiThrottle.then(async () => {
    if (signal?.aborted) throw cancellationError(signal)
    const nowMs = Date.now()
    const remaining = Number(openGolfApiRateLimitState.remaining)
    const resetAtMs = Number(openGolfApiRateLimitState.resetAtMs)
    const shouldWaitForReset = waitForDailyReset
      && Number.isFinite(remaining)
      && remaining <= config.rateLimitReserve
      && Number.isFinite(resetAtMs)
      && resetAtMs > nowMs

    if (shouldWaitForReset) {
      const waitMs = Math.max(0, resetAtMs - nowMs + config.resetGraceMs)
      const waitDetails = {
        correlationId,
        apiType: 'opengolfapi',
        endpoint,
        waitMs,
        remaining,
        limit: openGolfApiRateLimitState.limit,
        resetAt: openGolfApiRateLimitState.resetAt,
      }
      logApi('opengolfapi_daily_limit_wait_started', waitDetails)
      if (typeof onRateLimitEvent === 'function') onRateLimitEvent('opengolfapi_daily_limit_wait_started', waitDetails)
      await sleep(waitMs, signal)
      openGolfApiRateLimitState = { ...openGolfApiRateLimitState, remaining: null, resetAt: null, resetAtMs: null, updatedAt: new Date().toISOString() }
      const completedDetails = { correlationId, apiType: 'opengolfapi', endpoint, waitMs }
      logApi('opengolfapi_daily_limit_wait_completed', completedDetails)
      if (typeof onRateLimitEvent === 'function') onRateLimitEvent('opengolfapi_daily_limit_wait_completed', completedDetails)
    }

    const effectiveIntervalMs = adaptiveDailyPacing
      ? getOpenGolfApiAdaptiveIntervalMs({ requestIntervalMs: requestIntervalMs ?? config.requestIntervalMs, rateLimitReserve: config.rateLimitReserve })
      : Math.max(0, Math.trunc(Number(requestIntervalMs ?? config.requestIntervalMs) || 0))
    const elapsedMs = Date.now() - lastOpenGolfApiRequestAt
    const waitMs = Math.max(0, effectiveIntervalMs - elapsedMs)
    if (waitMs > 0) {
      logApi('opengolfapi_request_throttled', {
        correlationId,
        apiType: 'opengolfapi',
        endpoint,
        waitMs,
        adaptiveDailyPacing,
        remaining: openGolfApiRateLimitState.remaining,
        resetAt: openGolfApiRateLimitState.resetAt,
      })
      await sleep(waitMs, signal)
    }
    lastOpenGolfApiRequestAt = Date.now()
  })
  openGolfApiThrottle = waitTurn.catch(() => {})
  await waitTurn
}

function toNumber(value) {
  if (value == null || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toInteger(value) {
  const numeric = toNumber(value)
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null
}

function normalizeBaseUrl(value) {
  const raw = normalizeText(value || DEFAULT_BASE_URL).replace(/\/+$/, '') || DEFAULT_BASE_URL
  try {
    const parsed = new URL(raw)
    parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(/\/v1$/, '') || '/'
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return DEFAULT_BASE_URL
  }
}

export function getOpenGolfApiBaseUrl() {
  return normalizeBaseUrl(process.env.OPEN_GOLF_API_BASE_URL || process.env.OPENGOLFAPI_BASE_URL || DEFAULT_BASE_URL)
}

export function getOpenGolfApiRequestHeaders() {
  const headers = { Accept: 'application/json' }
  const rawKey = normalizeText(process.env.OPEN_GOLF_API_KEY || process.env.OPENGOLFAPI_API_KEY || process.env.OPENGOLFAPI_KEY)
  if (rawKey) headers.Authorization = `Bearer ${rawKey.replace(/^Bearer\s+/i, '')}`
  return headers
}

export function getOpenGolfApiBulkDatasetUrl() {
  return normalizeText(process.env.OPEN_GOLF_API_BULK_DATASET_URL || process.env.OPENGOLFAPI_BULK_DATASET_URL || DEFAULT_BULK_DATASET_URL) || DEFAULT_BULK_DATASET_URL
}

export function buildOpenGolfApiUrl(pathname) {
  const cleanPath = String(pathname || '').startsWith('/') ? String(pathname) : `/${pathname}`
  return new URL(`${getOpenGolfApiBaseUrl()}/v1${cleanPath}`)
}

function buildPathWithQuery(pathname, params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue
    query.set(key, String(value))
  }
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return `${pathname}${suffix}`
}

function getTimeoutMs() {
  const configured = Number(process.env.OPEN_GOLF_API_TIMEOUT_MS || process.env.OPENGOLFAPI_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS
}

export async function openGolfApiRequest(pathname, options = {}) {
  const url = buildOpenGolfApiUrl(pathname)
  const endpoint = url.pathname
  const config = getOpenGolfApiRateLimitConfig()
  const maxRetries = Math.max(0, Math.trunc(Number(options.maxRetries ?? config.maxRetries) || 0))
  const waitForDailyReset = options.waitForDailyReset ?? config.waitForDailyReset
  const adaptiveDailyPacing = options.adaptiveDailyPacing ?? config.adaptiveDailyPacing
  const requestIntervalMs = Math.max(0, Math.trunc(Number(options.requestIntervalMs ?? config.requestIntervalMs) || 0))
  const externalSignal = options.signal || null
  let retryAttempt = 0
  let totalAttempt = 0
  let lastError = null

  while (true) {
    const correlationId = normalizeText(options.correlationId) || null
    await waitForOpenGolfApiRequestSlot(endpoint, correlationId, { signal: externalSignal, waitForDailyReset, adaptiveDailyPacing, requestIntervalMs, onRateLimitEvent: options.onRateLimitEvent })
    if (externalSignal?.aborted) throw cancellationError(externalSignal)

    totalAttempt += 1
    const startedAt = Date.now()
    const controller = new AbortController()
    const onExternalAbort = () => controller.abort(externalSignal?.reason)
    externalSignal?.addEventListener?.('abort', onExternalAbort, { once: true })
    const timeout = globalThis.setTimeout(() => controller.abort(new Error('OpenGolfAPI request timeout')), getTimeoutMs())
    let statusCode = null
    let ok = false
    let retryAfterHeader = ''
    let retryDelayMs = null
    let dailyLimitWait = false

    logApi('opengolfapi_request_started', { correlationId, apiType: 'opengolfapi', endpoint, method: 'GET', attempt: totalAttempt, retryAttempt, maxRetries, waitForDailyReset, adaptiveDailyPacing, requestIntervalMs })
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: getOpenGolfApiRequestHeaders(),
        signal: controller.signal,
      })
      statusCode = response.status
      ok = response.ok
      retryAfterHeader = response.headers?.get?.('retry-after') || ''
      const text = await response.text()
      let payload = null
      if (text) {
        try {
          payload = JSON.parse(text)
        } catch {
          payload = { message: text }
        }
      }
      const rateLimit = captureOpenGolfApiRateLimit(response, payload, correlationId, endpoint)

      if (!response.ok) {
        const error = new Error(normalizeText(payload?.message || payload?.error || `OpenGolfAPI request failed with status ${response.status}`))
        error.statusCode = response.status
        error.retryAfterMs = parseOpenGolfApiRetryAfterMs(retryAfterHeader)
        error.retryable = isOpenGolfApiRetriableStatus(response.status)
        error.rateLimitLimit = rateLimit.limit
        error.rateLimitRemaining = rateLimit.remaining
        error.rateLimitResetAt = rateLimit.resetAt
        error.rateLimitResetAtMs = parseOpenGolfApiRateLimitResetMs(rateLimit.resetAt || payload?.resetAt || payload?.reset_at)
        throw error
      }

      return payload ?? {}
    } catch (error) {
      if (externalSignal?.aborted) throw cancellationError(externalSignal)
      lastError = error
      const dailyLimit = isDailyRateLimitError(error)
      if (dailyLimit && waitForDailyReset) {
        const resetAtMs = error?.rateLimitResetAtMs || openGolfApiRateLimitState.resetAtMs || nextUtcDayMs()
        openGolfApiRateLimitState = {
          ...openGolfApiRateLimitState,
          remaining: 0,
          resetAtMs,
          resetAt: new Date(resetAtMs).toISOString(),
          updatedAt: new Date().toISOString(),
        }
        dailyLimitWait = true
        retryAttempt = 0
        const dailyLimitDetails = {
          correlationId,
          apiType: 'opengolfapi',
          endpoint,
          statusCode: error?.statusCode || statusCode,
          limit: error?.rateLimitLimit ?? openGolfApiRateLimitState.limit,
          remaining: 0,
          resetAt: openGolfApiRateLimitState.resetAt,
          message: normalizeText(error?.message),
          action: 'pause_until_utc_reset_then_retry',
        }
        logApi('opengolfapi_daily_limit_reached', dailyLimitDetails)
        if (typeof options.onRateLimitEvent === 'function') options.onRateLimitEvent('opengolfapi_daily_limit_reached', dailyLimitDetails)
      } else {
        const retryable = Boolean(error?.retryable || isOpenGolfApiRetriableStatus(error?.statusCode || statusCode) || (!statusCode && isRetryableNetworkError(error)))
        if (retryable && retryAttempt < maxRetries) {
          retryDelayMs = getOpenGolfApiRetryDelayMs({ statusCode: error?.statusCode || statusCode, attempt: retryAttempt, retryAfterHeader })
          retryAttempt += 1
          logApi('opengolfapi_request_retry_scheduled', {
            correlationId,
            apiType: 'opengolfapi',
            endpoint,
            statusCode: error?.statusCode || statusCode,
            attempt: totalAttempt,
            retryAttempt,
            maxRetries,
            retryDelayMs,
            message: normalizeText(error?.message),
          })
        } else {
          throw error
        }
      }
    } finally {
      globalThis.clearTimeout(timeout)
      externalSignal?.removeEventListener?.('abort', onExternalAbort)
      const durationMs = Date.now() - startedAt
      await recordExternalApiCall({ apiType: 'opengolfapi', endpoint, method: 'GET', statusCode, ok, durationMs, correlationId })
      logApi('opengolfapi_request_completed', { correlationId, apiType: 'opengolfapi', endpoint, statusCode, ok, durationMs, attempt: totalAttempt })
    }

    if (dailyLimitWait) continue
    if (retryDelayMs != null) await sleep(retryDelayMs, externalSignal)
  }

  throw lastError || new Error('OpenGolfAPI request failed after retry attempts')
}

function firstPresent(record, keys) {
  if (!record || typeof record !== 'object') return null
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key) && record[key] != null && record[key] !== '') return record[key]
  }
  return null
}

export function extractOpenGolfApiCourseList(payload) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  if (Array.isArray(payload.courses)) return payload.courses
  if (Array.isArray(payload.data)) return payload.data
  if (Array.isArray(payload.results)) return payload.results
  if (payload.course && typeof payload.course === 'object') return [payload.course]
  return []
}

export function extractOpenGolfApiCoursePage(payload) {
  const courses = extractOpenGolfApiCourseList(payload)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { courses, total: null, returnedCount: courses.length }
  // OpenGolfAPI's state/search `count` field is the number returned, not the total
  // number available. Only explicit total-style fields are treated as a total.
  const total = toInteger(payload.total ?? payload.total_count ?? payload.totalCount ?? payload.meta?.total ?? payload.pagination?.total)
  const returnedCount = toInteger(payload.count ?? payload.returned_count ?? payload.returnedCount)
  return {
    courses,
    total: total != null && total >= 0 ? total : null,
    returnedCount: returnedCount != null && returnedCount >= 0 ? returnedCount : courses.length,
  }
}

export function buildOpenGolfApiStateCoursesPath(state, { limit = null } = {}) {
  const stateCode = normalizeStateCode(state)
  if (!stateCode) throw new Error('OpenGolfAPI state code is required')
  return buildPathWithQuery(`/courses/state/${encodeURIComponent(stateCode)}`, { limit })
}

export async function fetchOpenGolfApiStateCoursePage(state, { limit = null, correlationId = null, signal = null, waitForDailyReset = undefined, adaptiveDailyPacing = undefined, requestIntervalMs = undefined, onRateLimitEvent = null } = {}) {
  const stateCode = normalizeStateCode(state)
  if (!stateCode) return { courses: [], total: null, limit: null, offset: 0 }
  const pageLimit = Math.min(500, Math.max(1, Math.trunc(Number(limit || getOpenGolfApiStateImportConfig().pageLimit) || DEFAULT_STATE_PAGE_LIMIT)))
  const payload = await openGolfApiRequest(buildOpenGolfApiStateCoursesPath(stateCode, { limit: pageLimit }), { correlationId, signal, waitForDailyReset, adaptiveDailyPacing, requestIntervalMs, onRateLimitEvent })
  const page = extractOpenGolfApiCoursePage(payload)
  logApi('opengolfapi_state_course_page_loaded', {
    correlationId,
    apiType: 'opengolfapi',
    state: stateCode,
    limit: pageLimit,
    pageCount: page.courses.length,
    total: page.total,
    returnedCount: page.returnedCount,
  })
  return { ...page, limit: pageLimit, offset: 0 }
}

function courseListDedupKey(record) {
  return normalizeText(firstPresent(record, ['id', 'course_id', 'courseId', 'uuid']) || [
    firstPresent(record, ['course_name', 'courseName', 'name', 'club_name', 'clubName']),
    firstPresent(record, ['city', 'town', 'municipality']),
    firstPresent(record, ['state', 'state_code', 'stateCode']),
  ].map(normalizeText).join('|')).toLowerCase()
}

export function extractOpenGolfApiBulkCourseList(payload) {
  if (!payload || typeof payload !== 'object') return []
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.features)) {
    return payload.features.map((feature) => {
      const properties = feature?.properties && typeof feature.properties === 'object' ? feature.properties : {}
      const coordinates = feature?.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates)
        ? feature.geometry.coordinates
        : []
      return {
        ...properties,
        id: firstPresent(properties, ['id', 'course_id', 'courseId', 'uuid']) || feature?.id || null,
        longitude: firstPresent(properties, ['longitude', 'lng', 'lon']) ?? coordinates[0] ?? null,
        latitude: firstPresent(properties, ['latitude', 'lat']) ?? coordinates[1] ?? null,
      }
    })
  }
  return extractOpenGolfApiCourseList(payload)
}

async function loadOpenGolfApiBulkDataset(correlationId = null) {
  const datasetUrl = getOpenGolfApiBulkDatasetUrl()
  const startedAt = Date.now()
  let statusCode = null
  let ok = false
  try {
    logApi('opengolfapi_bulk_dataset_request_started', { correlationId, apiType: 'opengolfapi', endpoint: datasetUrl })
    const response = await fetch(datasetUrl, { method: 'GET', headers: { Accept: 'application/gzip, application/geo+json, application/json' } })
    statusCode = response.status
    ok = response.ok
    if (!response.ok) {
      const error = new Error(`OpenGolfAPI bulk dataset request failed with status ${response.status}`)
      error.statusCode = response.status
      throw error
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    const body = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes
    const payload = JSON.parse(body.toString('utf8'))
    const courses = extractOpenGolfApiBulkCourseList(payload)
    logApi('opengolfapi_bulk_dataset_loaded', { correlationId, apiType: 'opengolfapi', endpoint: datasetUrl, courseCount: courses.length })
    return courses
  } finally {
    const durationMs = Date.now() - startedAt
    await recordExternalApiCall({ apiType: 'opengolfapi', endpoint: '/bulk/opengolfapi-us.geojson.gz', method: 'GET', statusCode, ok, durationMs, correlationId })
    logApi('opengolfapi_bulk_dataset_request_completed', { correlationId, apiType: 'opengolfapi', endpoint: datasetUrl, statusCode, ok, durationMs })
  }
}

export async function fetchOpenGolfApiBulkCourseCatalog({ forceRefresh = false, correlationId = null } = {}) {
  if (forceRefresh || !openGolfApiBulkDatasetPromise) {
    openGolfApiBulkDatasetPromise = loadOpenGolfApiBulkDataset(correlationId).catch((error) => {
      openGolfApiBulkDatasetPromise = null
      throw error
    })
  }
  return openGolfApiBulkDatasetPromise
}

export function resetOpenGolfApiBulkDatasetCache() {
  openGolfApiBulkDatasetPromise = null
}

function recordStateCode(record) {
  return normalizeStateCode(firstPresent(record, ['state', 'state_code', 'stateCode']) || firstNested(record, [['location', 'state'], ['address', 'state']]))
}

function mergeCourseLists(primary, supplemental) {
  const merged = []
  const seen = new Set()
  for (const course of [...primary, ...supplemental]) {
    const key = courseListDedupKey(course)
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    merged.push(course)
  }
  return merged
}

export async function fetchOpenGolfApiStateCourses(state, { pageLimit = null, useBulkFallback = true, correlationId = null, signal = null, waitForDailyReset = undefined, adaptiveDailyPacing = undefined, requestIntervalMs = undefined, onRateLimitEvent = null } = {}) {
  const stateCode = normalizeStateCode(state)
  if (!stateCode) return []
  const config = getOpenGolfApiStateImportConfig()
  const effectiveLimit = Math.min(500, Math.max(1, Math.trunc(Number(pageLimit || config.pageLimit) || DEFAULT_STATE_PAGE_LIMIT)))

  // The current official /courses/state/:code implementation has a hard limit (max 500)
  // and no offset/cursor support. Always query it, then merge the official bulk dataset
  // when enabled so states with more rows than the endpoint cap are complete.
  const page = await fetchOpenGolfApiStateCoursePage(stateCode, { limit: effectiveLimit, correlationId, signal, waitForDailyReset, adaptiveDailyPacing, requestIntervalMs, onRateLimitEvent })
  let records = mergeCourseLists([], page.courses)
  let bulkCount = null
  let bulkAdded = 0
  let bulkFallbackUsed = false

  if (useBulkFallback) {
    try {
      const bulkCatalog = await fetchOpenGolfApiBulkCourseCatalog({ correlationId })
      const bulkStateRecords = bulkCatalog.filter((record) => recordStateCode(record) === stateCode)
      bulkCount = bulkStateRecords.length
      const before = records.length
      records = mergeCourseLists(records, bulkStateRecords)
      bulkAdded = Math.max(0, records.length - before)
      bulkFallbackUsed = true
    } catch (error) {
      // The state endpoint exposes no offset/cursor. Without the official bulk catalog we
      // cannot prove the state is complete, so fail this state instead of silently importing
      // only the capped endpoint response.
      if (!error.code) error.code = 'OPENGOLFAPI_STATE_COMPLETENESS_UNAVAILABLE'
      logApi('opengolfapi_state_bulk_completeness_failed', {
        correlationId,
        apiType: 'opengolfapi',
        state: stateCode,
        endpointCount: page.courses.length,
        message: normalizeText(error?.message),
      })
      throw error
    }
  }

  logApi('opengolfapi_state_course_pages_completed', {
    correlationId,
    apiType: 'opengolfapi',
    state: stateCode,
    pageLimit: effectiveLimit,
    endpointCount: page.courses.length,
    bulkCount,
    bulkAdded,
    bulkFallbackUsed,
    discovered: records.length,
    endpointHasNoOffsetPagination: true,
  })
  return records
}

export function buildOpenGolfApiCourseDetailPath(courseId) {
  const id = normalizeText(courseId)
  if (!id) throw new Error('OpenGolfAPI course id is required')
  return `/courses/${encodeURIComponent(id)}`
}

export function buildOpenGolfApiCourseHolesPath(courseId) {
  const id = normalizeText(courseId)
  if (!id) throw new Error('OpenGolfAPI course id is required')
  return `/courses/${encodeURIComponent(id)}/holes`
}

export function buildOpenGolfApiCourseTeesPath(courseId) {
  const id = normalizeText(courseId)
  if (!id) throw new Error('OpenGolfAPI course id is required')
  return `/courses/${encodeURIComponent(id)}/tees`
}

export async function fetchOpenGolfApiCourseDetail(courseId, options = {}) {
  return openGolfApiRequest(buildOpenGolfApiCourseDetailPath(courseId), options)
}

export async function fetchOpenGolfApiCourseHoles(courseId, options = {}) {
  return openGolfApiRequest(buildOpenGolfApiCourseHolesPath(courseId), options)
}

export async function fetchOpenGolfApiCourseTees(courseId, options = {}) {
  return openGolfApiRequest(buildOpenGolfApiCourseTeesPath(courseId), options)
}

function firstNested(record, paths) {
  for (const path of paths) {
    let value = record
    for (const segment of path) value = value && typeof value === 'object' ? value[segment] : undefined
    if (value != null && value !== '') return value
  }
  return null
}

function extractCourseRoot(payload) {
  if (!payload || typeof payload !== 'object') return {}
  if (payload.course && typeof payload.course === 'object') return payload.course
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data
  return payload
}

function normalizeExternalId(listRecord, detailRecord) {
  return normalizeText(firstPresent(detailRecord, ['id', 'course_id', 'courseId', 'uuid']) || firstPresent(listRecord, ['id', 'course_id', 'courseId', 'uuid']))
}

function collectCandidateRecords(listRecord, detailRecord) {
  const nestedDetail = extractCourseRoot(detailRecord)
  const nestedList = extractCourseRoot(listRecord)
  return [nestedDetail, detailRecord || {}, nestedList, listRecord || {}].filter((item) => item && typeof item === 'object')
}

function firstValue(records, keys, paths = []) {
  for (const record of records) {
    const direct = firstPresent(record, keys)
    if (direct != null && direct !== '') return direct
    const nested = firstNested(record, paths)
    if (nested != null && nested !== '') return nested
  }
  return null
}

export function normalizeOpenGolfCoursePayload(listRecord = {}, detailPayload = {}) {
  const detailRecord = extractCourseRoot(detailPayload)
  const records = collectCandidateRecords(listRecord, detailRecord)
  const externalCourseId = normalizeExternalId(listRecord, detailRecord)
  const name = normalizeText(firstValue(records, ['name', 'course_name', 'courseName', 'club_name', 'clubName']))
  const rawState = firstValue(records, ['state', 'state_code', 'stateCode'], [['location', 'state'], ['address', 'state']])
  const stateCode = normalizeStateCode(rawState)
  const holesCount = toInteger(firstValue(records, ['holes_count', 'holesCount', 'holes']))
  const parTotal = toInteger(firstValue(records, ['par_total', 'parTotal', 'par']))

  return {
    id: externalCourseId || null,
    externalCourseId: externalCourseId || null,
    source: 'opengolfapi',
    name,
    normalizedName: normalizeCourseName(name),
    stateCode,
    stateName: normalizeText(firstValue(records, ['state_name', 'stateName'])) || stateNameForCode(stateCode),
    county: normalizeText(firstValue(records, ['county', 'county_name', 'countyName'])) || null,
    city: normalizeText(firstValue(records, ['city', 'town', 'municipality'], [['location', 'city'], ['address', 'city']])) || null,
    country: normalizeText(firstValue(records, ['country'], [['location', 'country'], ['address', 'country']])) || 'US',
    courseType: normalizeText(firstValue(records, ['type', 'course_type', 'courseType'])) || null,
    holesCount: holesCount && holesCount > 0 ? holesCount : null,
    parTotal: parTotal && parTotal > 0 ? parTotal : null,
    totalYardage: toInteger(firstValue(records, ['total_yardage', 'totalYardage', 'total_yards', 'totalYards'])) || null,
    courseRating: toNumber(firstValue(records, ['course_rating', 'courseRating', 'rating'])) || null,
    slopeRating: toInteger(firstValue(records, ['slope_rating', 'slopeRating', 'slope'])) || null,
    address: normalizeText(firstValue(records, ['address', 'street', 'street_address', 'streetAddress'], [['location', 'address'], ['address', 'line1']])) || null,
    postalCode: normalizeText(firstValue(records, ['postal_code', 'postalCode', 'zip', 'zip_code'], [['location', 'postal_code'], ['address', 'postal_code']])) || null,
    phone: normalizeText(firstValue(records, ['phone', 'phone_number', 'phoneNumber'])) || null,
    website: normalizeText(firstValue(records, ['website', 'url', 'web_url'])) || null,
    latitude: toNumber(firstValue(records, ['latitude', 'lat'], [['location', 'latitude'], ['location', 'lat']])) || null,
    longitude: toNumber(firstValue(records, ['longitude', 'lng', 'lon'], [['location', 'longitude'], ['location', 'lng'], ['location', 'lon']])) || null,
    rawListPayload: listRecord || null,
    rawDetailPayload: detailPayload || null,
  }
}

export function normalizeCourseName(value) {
  return normalizeText(value).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function teeNameFromRecord(record, fallback = '') {
  return normalizeText(firstPresent(record, ['tee_name', 'teeName', 'tee', 'name', 'color', 'colour']) || fallback || 'default') || 'default'
}

function teeColorFromName(value) {
  const normalized = normalizeText(value).toLowerCase()
  if (/black/.test(normalized)) return 'black'
  if (/blue/.test(normalized)) return 'blue'
  if (/white/.test(normalized)) return 'white'
  if (/gold|yellow/.test(normalized)) return 'gold'
  if (/red/.test(normalized)) return 'red'
  if (/green/.test(normalized)) return 'green'
  return normalized.slice(0, 32) || 'default'
}

function normalizeHoleRecord(rawHole, index, teeRecord = {}, sourcePayload = rawHole) {
  if (!rawHole || typeof rawHole !== 'object') return null
  const holeNumber = toInteger(firstPresent(rawHole, ['hole', 'hole_number', 'holeNumber', 'number', 'id'])) || index + 1
  if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 36) return null
  const teeName = teeNameFromRecord(teeRecord, firstPresent(rawHole, ['tee_name', 'teeName', 'tee', 'tee_box', 'teeBox']))
  const par = toInteger(firstPresent(rawHole, ['par']))
  const yards = toInteger(firstPresent(rawHole, ['yards', 'yardage', 'total_yards', 'totalYards', 'length']))
  const strokeIndex = toInteger(firstPresent(rawHole, ['stroke_index', 'strokeIndex', 'handicap', 'hcp', 'hdcp', 'difficulty']))
  const front = rawHole.front || rawHole.green_front || rawHole.front_green || {}
  const center = rawHole.center || rawHole.green_center || rawHole.middle || rawHole.green || {}
  const back = rawHole.back || rawHole.green_back || rawHole.back_green || {}

  return {
    holeNumber,
    teeName,
    teeColor: teeColorFromName(teeName),
    par: par && par > 0 ? par : null,
    yards: yards && yards > 0 ? yards : null,
    strokeIndex: strokeIndex && strokeIndex > 0 ? strokeIndex : null,
    frontLatitude: toNumber(rawHole.front_latitude ?? rawHole.frontLatitude ?? front.latitude ?? front.lat),
    frontLongitude: toNumber(rawHole.front_longitude ?? rawHole.frontLongitude ?? front.longitude ?? front.lng ?? front.lon),
    centerLatitude: toNumber(rawHole.center_latitude ?? rawHole.centerLatitude ?? center.latitude ?? center.lat),
    centerLongitude: toNumber(rawHole.center_longitude ?? rawHole.centerLongitude ?? center.longitude ?? center.lng ?? center.lon),
    backLatitude: toNumber(rawHole.back_latitude ?? rawHole.backLatitude ?? back.latitude ?? back.lat),
    backLongitude: toNumber(rawHole.back_longitude ?? rawHole.backLongitude ?? back.longitude ?? back.lng ?? back.lon),
    rawPayload: sourcePayload || rawHole,
  }
}

function arraysFromValue(value) {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return [value]
  return Object.values(value).filter(Array.isArray)
}

function extractTeeHoleRows(record) {
  const rows = []
  const teeCollections = []
  for (const key of ['tees', 'tee_boxes', 'teeBoxes']) {
    const value = record?.[key]
    if (Array.isArray(value)) teeCollections.push(...value)
    else if (value && typeof value === 'object') teeCollections.push(...Object.values(value).flatMap((item) => Array.isArray(item) ? item : [item]))
  }

  for (const teeRecord of teeCollections) {
    if (!teeRecord || typeof teeRecord !== 'object') continue
    const holeArrays = arraysFromValue(teeRecord.holes || teeRecord.scorecard || teeRecord.score_card)
    for (const holes of holeArrays) {
      holes.forEach((hole, index) => {
        const normalized = normalizeHoleRecord(hole, index, teeRecord, hole)
        if (normalized) rows.push(normalized)
      })
    }
  }
  return rows
}

function extractDirectHoleRows(record) {
  const rows = []
  for (const key of ['holes', 'scorecard', 'score_card', 'hole_details', 'holeDetails']) {
    const value = record?.[key]
    if (!Array.isArray(value)) continue
    value.forEach((hole, index) => {
      const normalized = normalizeHoleRecord(hole, index, {}, hole)
      if (normalized) rows.push(normalized)
    })
  }
  return rows
}

function extractFlatHoleRows(record) {
  const rows = []
  if (!record || typeof record !== 'object') return rows
  for (let holeNumber = 1; holeNumber <= 18; holeNumber += 1) {
    const par = toInteger(record[`hole_${holeNumber}_par`] ?? record[`hole${holeNumber}_par`])
    const yards = toInteger(record[`hole_${holeNumber}_yards`] ?? record[`hole${holeNumber}_yards`] ?? record[`hole_${holeNumber}_yardage`])
    const strokeIndex = toInteger(record[`hole_${holeNumber}_hcp`] ?? record[`hole${holeNumber}_hcp`] ?? record[`hole_${holeNumber}_handicap`] ?? record[`hole_${holeNumber}_stroke_index`])
    if (!par && !yards && !strokeIndex) continue
    rows.push({ holeNumber, teeName: 'default', teeColor: 'default', par: par || null, yards: yards || null, strokeIndex: strokeIndex || null, frontLatitude: null, frontLongitude: null, centerLatitude: null, centerLongitude: null, backLatitude: null, backLongitude: null, rawPayload: { holeNumber, par, yards, strokeIndex } })
  }
  return rows
}

export function extractOpenGolfCourseHoles(detailPayload = {}) {
  const root = extractCourseRoot(detailPayload)
  const candidates = [root, detailPayload].filter((item) => item && typeof item === 'object')
  const rows = []
  for (const record of candidates) {
    rows.push(...extractTeeHoleRows(record))
    rows.push(...extractDirectHoleRows(record))
    rows.push(...extractFlatHoleRows(record))
  }

  const seen = new Set()
  return rows
    .filter((row) => Number.isInteger(row.holeNumber) && row.holeNumber >= 1 && row.holeNumber <= 36)
    .filter((row) => {
      const key = `${row.holeNumber}::${row.teeName || 'default'}::${row.par || ''}::${row.yards || ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.holeNumber - b.holeNumber || String(a.teeName).localeCompare(String(b.teeName)))
}

function objectValuesFromPayload(payload, keys) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  for (const key of keys) {
    const value = payload[key]
    if (Array.isArray(value)) return value
    if (value && typeof value === 'object' && Array.isArray(value.data)) return value.data
  }
  if (payload.course && typeof payload.course === 'object') return objectValuesFromPayload(payload.course, keys)
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return objectValuesFromPayload(payload.data, keys)
  return []
}

function normalizeTeeKey(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function readLatLng(value, { geoJsonPair = false } = {}) {
  if (!value) return { latitude: null, longitude: null }
  if (Array.isArray(value) && value.length >= 2) {
    const first = toNumber(value[0])
    const second = toNumber(value[1])
    if (first == null || second == null) return { latitude: null, longitude: null }
    if (geoJsonPair) return { latitude: second, longitude: first }
    if (Math.abs(first) > 90 && Math.abs(second) <= 90) return { latitude: second, longitude: first }
    if (Math.abs(second) > 90 && Math.abs(first) <= 90) return { latitude: first, longitude: second }
    return { latitude: first, longitude: second }
  }
  if (typeof value === 'object') {
    const latitude = toNumber(value.latitude ?? value.lat ?? value.y)
    const longitude = toNumber(value.longitude ?? value.lng ?? value.lon ?? value.x)
    return { latitude, longitude }
  }
  return { latitude: null, longitude: null }
}

function flattenCoordinatePairs(value, results = []) {
  if (!value) return results
  if (Array.isArray(value)) {
    if (value.length >= 2 && typeof value[0] !== 'object' && typeof value[1] !== 'object') {
      const point = readLatLng(value, { geoJsonPair: true })
      if (point.latitude != null && point.longitude != null) results.push(point)
      return results
    }
    value.forEach((item) => flattenCoordinatePairs(item, results))
    return results
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.coordinates)) return flattenCoordinatePairs(value.coordinates, results)
    const direct = readLatLng(value)
    if (direct.latitude != null && direct.longitude != null) results.push(direct)
  }
  return results
}

function distanceSquared(a, b) {
  if (!a || !b || a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return null
  return (a.latitude - b.latitude) ** 2 + (a.longitude - b.longitude) ** 2
}

function emptyGreenSummary() {
  return {
    center: { latitude: null, longitude: null },
    front: { latitude: null, longitude: null },
    back: { latitude: null, longitude: null },
  }
}

function averagePoints(points = []) {
  const valid = points.filter((point) => point?.latitude != null && point?.longitude != null)
  if (!valid.length) return { latitude: null, longitude: null }
  return {
    latitude: Number((valid.reduce((sum, point) => sum + point.latitude, 0) / valid.length).toFixed(7)),
    longitude: Number((valid.reduce((sum, point) => sum + point.longitude, 0) / valid.length).toFixed(7)),
  }
}

function summarizeGreenPolygon(greenPolygon, teePoint = null) {
  const points = flattenCoordinatePairs(greenPolygon)
  if (!points.length) return emptyGreenSummary()
  const center = averagePoints(points)
  if (!teePoint || teePoint.latitude == null || teePoint.longitude == null) return { center, front: center, back: center }

  let front = points[0]
  let back = points[0]
  let frontDistance = distanceSquared(front, teePoint)
  let backDistance = frontDistance
  for (const point of points.slice(1)) {
    const distance = distanceSquared(point, teePoint)
    if (distance == null) continue
    if (frontDistance == null || distance < frontDistance) {
      front = point
      frontDistance = distance
    }
    if (backDistance == null || distance > backDistance) {
      back = point
      backDistance = distance
    }
  }
  return { center, front, back }
}

function summarizeGreenGeometry(greenGeometry, teePoint = null) {
  if (!greenGeometry) return emptyGreenSummary()
  if (typeof greenGeometry === 'object' && !Array.isArray(greenGeometry)) {
    const center = readLatLng(greenGeometry.center ?? greenGeometry.middle ?? greenGeometry.pin)
    const front = readLatLng(greenGeometry.front)
    const back = readLatLng(greenGeometry.back)
    const namedPoints = [center, front, back].filter((point) => point.latitude != null && point.longitude != null)
    if (namedPoints.length) {
      const resolvedCenter = center.latitude != null && center.longitude != null ? center : averagePoints(namedPoints)
      return {
        center: resolvedCenter,
        front: front.latitude != null && front.longitude != null ? front : resolvedCenter,
        back: back.latitude != null && back.longitude != null ? back : resolvedCenter,
      }
    }
    const polygon = greenGeometry.polygon ?? greenGeometry.coordinates ?? greenGeometry.coords ?? greenGeometry.green_polygon ?? greenGeometry.greenPolygon
    if (polygon) return summarizeGreenPolygon(polygon, teePoint)
  }
  return summarizeGreenPolygon(greenGeometry, teePoint)
}

function extractYardageEntries(rawHole) {
  const yardages = rawHole?.yardages ?? rawHole?.yards_by_tee ?? rawHole?.yardsByTee ?? rawHole?.tee_yardages ?? rawHole?.teeYardages
  const entries = []
  if (Array.isArray(yardages)) {
    yardages.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const teeName = normalizeText(firstPresent(entry, ['tee_name', 'teeName', 'tee', 'name', 'color', 'colour'])) || 'default'
      const yards = toInteger(firstPresent(entry, ['yards', 'yardage', 'length', 'value']))
      if (yards && yards > 0) entries.push({ teeName, yards })
    })
  } else if (yardages && typeof yardages === 'object') {
    Object.entries(yardages).forEach(([key, value]) => {
      const yards = typeof value === 'object' ? toInteger(firstPresent(value, ['yards', 'yardage', 'length', 'value'])) : toInteger(value)
      if (yards && yards > 0) entries.push({ teeName: normalizeText(key) || 'default', yards })
    })
  }

  if (!entries.length) {
    const yards = toInteger(firstPresent(rawHole, ['yards', 'yardage', 'total_yards', 'totalYards', 'length']))
    const teeName = normalizeText(firstPresent(rawHole, ['tee_name', 'teeName', 'tee', 'name', 'color', 'colour'])) || 'default'
    if (yards && yards > 0) entries.push({ teeName, yards })
  }
  return entries.length ? entries : [{ teeName: 'default', yards: null }]
}

function extractTeeCoordinateMap(rawHole) {
  const teeCoords = rawHole?.tee_coords ?? rawHole?.teeCoords ?? rawHole?.tee_coordinates ?? rawHole?.teeCoordinates ?? rawHole?.tees
  const coordinates = new Map()
  if (Array.isArray(teeCoords)) {
    teeCoords.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const teeName = normalizeText(firstPresent(entry, ['tee_name', 'teeName', 'tee', 'name', 'color', 'colour'])) || 'default'
      const point = readLatLng(entry.coordinates ?? entry.coords ?? entry)
      if (point.latitude != null && point.longitude != null) coordinates.set(normalizeTeeKey(teeName), point)
    })
  } else if (teeCoords && typeof teeCoords === 'object') {
    Object.entries(teeCoords).forEach(([key, value]) => {
      const point = readLatLng(value?.coordinates ?? value?.coords ?? value)
      if (point.latitude != null && point.longitude != null) coordinates.set(normalizeTeeKey(key), point)
    })
  }

  const direct = readLatLng(rawHole?.tee_coordinate ?? rawHole?.teeCoordinate ?? rawHole?.tee_box ?? rawHole?.teeBox)
  if (direct.latitude != null && direct.longitude != null) coordinates.set('default', direct)
  return coordinates
}

function findTeePoint(teeCoordinateMap, teeName) {
  if (!teeCoordinateMap?.size) return { latitude: null, longitude: null }
  const key = normalizeTeeKey(teeName)
  if (teeCoordinateMap.has(key)) return teeCoordinateMap.get(key)
  const color = teeColorFromName(teeName)
  if (teeCoordinateMap.has(color)) return teeCoordinateMap.get(color)
  if (teeCoordinateMap.has('default')) return teeCoordinateMap.get('default')
  return [...teeCoordinateMap.values()][0] || { latitude: null, longitude: null }
}

export function extractOpenGolfCourseHoleEndpointRows(holesPayload = {}) {
  const holes = objectValuesFromPayload(holesPayload, ['holes', 'scorecard', 'score_card', 'data', 'results'])
  const rows = []
  holes.forEach((rawHole, index) => {
    if (!rawHole || typeof rawHole !== 'object') return
    const holeNumber = toInteger(firstPresent(rawHole, ['hole', 'hole_number', 'holeNumber', 'number', 'id'])) || index + 1
    if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 36) return
    const par = toInteger(firstPresent(rawHole, ['par']))
    const strokeIndex = toInteger(firstPresent(rawHole, ['handicap_index', 'handicapIndex', 'stroke_index', 'strokeIndex', 'handicap', 'hcp', 'hdcp', 'difficulty']))
    const greenGeometry = rawHole.green ?? rawHole.green_geometry ?? rawHole.greenGeometry ?? rawHole.green_polygon ?? rawHole.greenPolygon ?? rawHole.polygon
    const teeCoordinateMap = extractTeeCoordinateMap(rawHole)
    const yardageEntries = extractYardageEntries(rawHole)

    yardageEntries.forEach((entry) => {
      const teeName = normalizeText(entry.teeName) || 'default'
      const teePoint = findTeePoint(teeCoordinateMap, teeName)
      const green = summarizeGreenGeometry(greenGeometry, teePoint)
      rows.push({
        holeNumber,
        teeName,
        teeColor: teeColorFromName(teeName),
        par: par && par > 0 ? par : null,
        yards: entry.yards && entry.yards > 0 ? entry.yards : null,
        strokeIndex: strokeIndex && strokeIndex > 0 ? strokeIndex : null,
        teeLatitude: teePoint.latitude,
        teeLongitude: teePoint.longitude,
        frontLatitude: green.front.latitude,
        frontLongitude: green.front.longitude,
        centerLatitude: green.center.latitude,
        centerLongitude: green.center.longitude,
        backLatitude: green.back.latitude,
        backLongitude: green.back.longitude,
        rawPayload: rawHole,
      })
    })
  })

  const seen = new Set()
  return rows.filter((row) => {
    const key = `${row.holeNumber}::${normalizeTeeKey(row.teeName) || 'default'}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((a, b) => a.holeNumber - b.holeNumber || String(a.teeName).localeCompare(String(b.teeName)))
}

function extractTeeRecords(teesPayload = {}) {
  const tees = objectValuesFromPayload(teesPayload, ['tees', 'tee_sets', 'teeSets', 'data', 'results'])
  if (tees.length) return tees
  const root = extractCourseRoot(teesPayload)
  if (root && typeof root === 'object' && !Array.isArray(root)) {
    for (const key of ['tees', 'tee_sets', 'teeSets']) {
      if (Array.isArray(root[key])) return root[key]
    }
  }
  return []
}

function readTeeMetric(record, field) {
  if (!record || typeof record !== 'object') return null
  if (field === 'totalYardage') return toInteger(firstPresent(record, ['yardage', 'yards', 'total_yardage', 'totalYardage', 'total_yards', 'totalYards']))
  if (field === 'courseRating') return toNumber(firstPresent(record, ['course_rating', 'courseRating', 'rating']))
  if (field === 'slopeRating') return toInteger(firstPresent(record, ['slope_rating', 'slopeRating', 'slope']))
  return null
}

function teeRecordName(record) {
  return normalizeText(firstPresent(record, ['tee_name', 'teeName', 'tee', 'name', 'color', 'colour'])) || 'default'
}

function chooseTeeMetric(tees, field) {
  const white = tees.find((tee) => normalizeTeeKey(teeRecordName(tee)).includes('white') && readTeeMetric(tee, field) != null)
  const fallback = tees.find((tee) => readTeeMetric(tee, field) != null)
  const selected = white || fallback
  return selected ? readTeeMetric(selected, field) : null
}

export function extractOpenGolfCourseTeeSummary(teesPayload = {}) {
  const tees = extractTeeRecords(teesPayload)
  return {
    totalYardage: chooseTeeMetric(tees, 'totalYardage'),
    courseRating: chooseTeeMetric(tees, 'courseRating'),
    slopeRating: chooseTeeMetric(tees, 'slopeRating'),
    teeCount: tees.length,
    rawTeesPayload: teesPayload || null,
  }
}

export const extractOpenGolfApiCourseHoleEndpointRows = extractOpenGolfCourseHoleEndpointRows
