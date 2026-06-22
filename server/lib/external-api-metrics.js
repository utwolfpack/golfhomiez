import { getPool } from '../db.js'
import { getCorrelationId, logApi, logWarn } from './logger.js'

export const EXTERNAL_API_TYPES = Object.freeze({
  BREVO: 'brevo',
  GOLFBERT: 'golfbert',
  OTHER: 'other',
})

const VALID_API_TYPES = new Set(Object.values(EXTERNAL_API_TYPES))
const MAX_ENDPOINT_LENGTH = 512
let schemaReady = false
let metricsDisabledUntil = 0

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function normalizeExternalApiType(value) {
  const normalized = normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!normalized) return EXTERNAL_API_TYPES.OTHER
  if (normalized.includes('brevo') || normalized.includes('sendinblue')) return EXTERNAL_API_TYPES.BREVO
  if (normalized.includes('golfbert')) return EXTERNAL_API_TYPES.GOLFBERT
  return VALID_API_TYPES.has(normalized) ? normalized : EXTERNAL_API_TYPES.OTHER
}

export function normalizeExternalEndpoint(endpoint) {
  const raw = normalizeText(endpoint || '/') || '/'
  try {
    const parsed = new URL(raw)
    return normalizeText(`${parsed.pathname || '/'}${parsed.search ? '' : ''}`).slice(0, MAX_ENDPOINT_LENGTH) || '/'
  } catch {
    const withoutQuery = raw.split('?')[0] || '/'
    const withLeadingSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`
    return normalizeText(withLeadingSlash).slice(0, MAX_ENDPOINT_LENGTH) || '/'
  }
}

function normalizeHttpMethod(method) {
  const normalized = normalizeText(method || 'GET').toUpperCase()
  return normalized.slice(0, 16) || 'GET'
}

function normalizeStatusCode(statusCode) {
  const numeric = Number(statusCode)
  return Number.isInteger(numeric) && numeric >= 100 && numeric <= 599 ? numeric : null
}

function normalizeDurationMs(durationMs) {
  const numeric = Number(durationMs)
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null
}

async function ensureExternalApiMetricsSchema() {
  if (schemaReady) return
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS external_api_call_metrics (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      api_type VARCHAR(32) NOT NULL,
      endpoint VARCHAR(512) NOT NULL,
      method VARCHAR(16) NOT NULL DEFAULT 'GET',
      status_code SMALLINT UNSIGNED NULL,
      ok TINYINT(1) NOT NULL DEFAULT 0,
      duration_ms INT UNSIGNED NULL,
      correlation_id VARCHAR(191) NULL,
      occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_external_api_call_metrics_occurred_at (occurred_at),
      INDEX idx_external_api_call_metrics_api_date (api_type, occurred_at),
      INDEX idx_external_api_call_metrics_endpoint (endpoint(128)),
      INDEX idx_external_api_call_metrics_api_endpoint_date (api_type, endpoint(128), occurred_at)
    )
  `)
  schemaReady = true
}

export async function recordExternalApiCall({
  apiType = EXTERNAL_API_TYPES.OTHER,
  endpoint = '/',
  method = 'GET',
  statusCode = null,
  ok = false,
  durationMs = null,
  correlationId = null,
} = {}) {
  const normalized = {
    apiType: normalizeExternalApiType(apiType),
    endpoint: normalizeExternalEndpoint(endpoint),
    method: normalizeHttpMethod(method),
    statusCode: normalizeStatusCode(statusCode),
    ok: ok ? 1 : 0,
    durationMs: normalizeDurationMs(durationMs),
    correlationId: normalizeText(correlationId || getCorrelationId() || '') || null,
  }

  if (Date.now() < metricsDisabledUntil) return

  try {
    await ensureExternalApiMetricsSchema()
    await getPool().execute(
      `INSERT INTO external_api_call_metrics
        (api_type, endpoint, method, status_code, ok, duration_ms, correlation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [normalized.apiType, normalized.endpoint, normalized.method, normalized.statusCode, normalized.ok, normalized.durationMs, normalized.correlationId],
    )
    logApi('external_api_call_metric_recorded', normalized)
  } catch (error) {
    metricsDisabledUntil = Date.now() + 30_000
    schemaReady = false
    logWarn('External API call metric could not be persisted', { ...normalized, error })
  }
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function todayUtcIsoDate() {
  const now = new Date()
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function normalizeDateRange(fromDate, toDate) {
  const today = todayUtcIsoDate()
  const from = isIsoDate(fromDate) ? String(fromDate) : today
  const to = isIsoDate(toDate) ? String(toDate) : from
  if (from > to) throw new Error('Start date must be on or before end date.')
  return { fromDate: from, toDate: to, startDateTime: `${from} 00:00:00`, endDateTime: `${addDays(to, 1)} 00:00:00` }
}

function normalizeOptionalApiType(apiType) {
  const raw = normalizeText(apiType).toLowerCase()
  if (!raw || raw === 'all') return ''
  const normalized = normalizeExternalApiType(raw)
  return VALID_API_TYPES.has(normalized) ? normalized : ''
}

function normalizeOptionalEndpoint(endpoint) {
  const raw = normalizeText(endpoint)
  return raw ? normalizeExternalEndpoint(raw) : ''
}

function countValue(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

export async function getExternalApiCallSummary({ fromDate = '', toDate = '', apiType = '', endpoint = '' } = {}) {
  await ensureExternalApiMetricsSchema()
  const filters = normalizeDateRange(fromDate, toDate)
  const selectedApiType = normalizeOptionalApiType(apiType)
  const selectedEndpoint = normalizeOptionalEndpoint(endpoint)

  const baseWhere = ['occurred_at >= ?', 'occurred_at < ?']
  const baseParams = [filters.startDateTime, filters.endDateTime]
  if (selectedApiType) {
    baseWhere.push('api_type = ?')
    baseParams.push(selectedApiType)
  }

  const where = [...baseWhere]
  const params = [...baseParams]
  if (selectedEndpoint) {
    where.push('endpoint = ?')
    params.push(selectedEndpoint)
  }

  const db = getPool()
  const [rows] = await db.execute(
    `SELECT
       api_type AS apiType,
       endpoint,
       COUNT(*) AS callCount,
       SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS successCount,
       SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failureCount,
       MIN(occurred_at) AS firstCallAt,
       MAX(occurred_at) AS lastCallAt,
       ROUND(AVG(duration_ms), 0) AS averageDurationMs
     FROM external_api_call_metrics
     WHERE ${where.join(' AND ')}
     GROUP BY api_type, endpoint
     ORDER BY callCount DESC, api_type ASC, endpoint ASC`,
    params,
  )

  const [[totalRow = {}] = []] = await db.execute(
    `SELECT COUNT(*) AS totalCalls
       FROM external_api_call_metrics
      WHERE ${where.join(' AND ')}`,
    params,
  )

  const [apiTypeRows] = await db.execute(
    `SELECT api_type AS apiType, COUNT(*) AS callCount
       FROM external_api_call_metrics
      WHERE ${baseWhere.join(' AND ')}
      GROUP BY api_type
      ORDER BY callCount DESC, api_type ASC`,
    baseParams,
  )

  const [endpointRows] = await db.execute(
    `SELECT endpoint, COUNT(*) AS callCount
       FROM external_api_call_metrics
      WHERE ${baseWhere.join(' AND ')}
      GROUP BY endpoint
      ORDER BY callCount DESC, endpoint ASC
      LIMIT 250`,
    baseParams,
  )

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      apiType: selectedApiType,
      endpoint: selectedEndpoint,
    },
    totalCalls: countValue(totalRow.totalCalls),
    rows: rows.map((row) => ({
      apiType: row.apiType,
      endpoint: row.endpoint,
      callCount: countValue(row.callCount),
      successCount: countValue(row.successCount),
      failureCount: countValue(row.failureCount),
      averageDurationMs: row.averageDurationMs == null ? null : countValue(row.averageDurationMs),
      firstCallAt: row.firstCallAt || null,
      lastCallAt: row.lastCallAt || null,
    })),
    apiTypes: apiTypeRows.map((row) => ({ apiType: row.apiType, callCount: countValue(row.callCount) })),
    endpoints: endpointRows.map((row) => ({ endpoint: row.endpoint, callCount: countValue(row.callCount) })),
  }
}

export function __resetExternalApiMetricsSchemaForTests() {
  schemaReady = false
  metricsDisabledUntil = 0
}
