import process from 'node:process'

const DEFAULT_PEXELS_TIMEOUT_MS = 15000
let latestPexelsQuota = null

function normalizedTimeoutMs(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= 1000 && parsed <= 60000 ? parsed : DEFAULT_PEXELS_TIMEOUT_MS
}

function sourceAbortSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

function headerNumber(headers, name) {
  const value = headers?.get?.(name)
  if (value == null || value === '') return null
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function parsePexelsRateLimitHeaders(headers, {
  capturedAt = new Date(),
  jobId = null,
  endpoint = null,
} = {}) {
  const limit = headerNumber(headers, 'x-ratelimit-limit')
  const remaining = headerNumber(headers, 'x-ratelimit-remaining')
  const resetUnix = headerNumber(headers, 'x-ratelimit-reset')
  if (limit == null && remaining == null && resetUnix == null) return null
  const resetAt = resetUnix != null ? new Date(resetUnix * 1000) : null
  return {
    limit,
    remaining,
    used: limit != null && remaining != null ? Math.max(0, limit - remaining) : null,
    resetUnix,
    resetAt: resetAt && !Number.isNaN(resetAt.getTime()) ? resetAt.toISOString() : null,
    capturedAt: (capturedAt instanceof Date ? capturedAt : new Date(capturedAt)).toISOString(),
    jobId: jobId || null,
    endpoint: endpoint || null,
  }
}

export function rememberPexelsQuota(quota) {
  if (!quota || typeof quota !== 'object') return getLatestPexelsQuota()
  const captured = new Date(quota.capturedAt || 0).getTime()
  const current = new Date(latestPexelsQuota?.capturedAt || 0).getTime()
  if (!latestPexelsQuota || !Number.isFinite(current) || captured >= current) latestPexelsQuota = { ...quota }
  return getLatestPexelsQuota()
}

export function getLatestPexelsQuota() {
  return latestPexelsQuota ? { ...latestPexelsQuota } : null
}

export function resetLatestPexelsQuotaForTests() {
  latestPexelsQuota = null
}

export function pexelsApiKey() {
  return String(process.env.PEXELS_API_KEY || '').trim()
}

export async function fetchPexelsJson(url, {
  fetchImpl = globalThis.fetch,
  signal = null,
  timeoutMs = normalizedTimeoutMs(process.env.GREAT_SHOTS_FETCH_TIMEOUT_MS || process.env.CURRENT_EVENTS_FETCH_TIMEOUT_MS),
  apiKey = pexelsApiKey(),
  jobId = null,
  correlationId = null,
  logApi = () => {},
  logScheduledJob = () => {},
  userAgent = 'GolfHomiez/1.0 (+https://golfhomiez.com)',
} = {}) {
  if (!apiKey) {
    const error = new Error('PEXELS_API_KEY is not configured')
    error.code = 'PEXELS_API_KEY_MISSING'
    throw error
  }
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for Pexels API requests')

  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'follow',
    signal: sourceAbortSignal(signal, normalizedTimeoutMs(timeoutMs)),
    headers: {
      Accept: 'application/json',
      Authorization: apiKey,
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': userAgent,
    },
  })

  if (!response?.ok) {
    const error = new Error(`Pexels API returned HTTP ${response?.status || 'unknown'}`)
    error.statusCode = response?.status || null
    error.code = Number(response?.status || 0) === 429 ? 'PEXELS_RATE_LIMITED' : 'PEXELS_API_FAILED'
    throw error
  }

  const quota = parsePexelsRateLimitHeaders(response.headers, {
    jobId,
    endpoint: (() => {
      try { return new URL(url).pathname } catch { return null }
    })(),
  })
  if (quota) {
    rememberPexelsQuota(quota)
    const details = { correlationId, provider: 'Pexels', ...quota }
    logApi('pexels_api_quota_observed', details)
    logScheduledJob('pexels_api_quota_observed', details)
  }

  return {
    payload: await response.json(),
    quota: quota || getLatestPexelsQuota(),
  }
}
