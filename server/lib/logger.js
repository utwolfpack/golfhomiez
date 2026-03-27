import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const LOG_DIR = path.resolve(process.cwd(), 'logging')
const ACCESS_LOG_PATH = path.join(LOG_DIR, 'access.log')
const API_LOG_PATH = path.join(LOG_DIR, 'api.log')
const FRONTEND_LOG_PATH = path.join(LOG_DIR, 'frontend.log')
const REDACT_KEYS = new Set(['password', 'passwordhash', 'token', 'authorization', 'cookie', 'secret', 'smtp_pass', 'smtp_key'])

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

function createStream(filePath) {
  ensureLogDir()
  return fs.createWriteStream(filePath, { flags: 'a' })
}

const accessStream = createStream(ACCESS_LOG_PATH)
const apiStream = createStream(API_LOG_PATH)
const frontendStream = createStream(FRONTEND_LOG_PATH)

function safeValue(value, depth = 0) {
  if (value == null) return value
  if (depth > 4) return '[truncated]'
  if (Array.isArray(value)) return value.map((item) => safeValue(item, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => {
      if (REDACT_KEYS.has(String(key).toLowerCase())) return [key, '[redacted]']
      return [key, safeValue(val, depth + 1)]
    }))
  }
  if (typeof value === 'string' && value.length > 1000) return `${value.slice(0, 997)}...`
  return value
}

function serializeError(error) {
  if (!error) return null
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: error.code,
    errno: error.errno,
    sqlMessage: error.sqlMessage,
  }
}

function writeLine(stream, payload) {
  stream.write(`${JSON.stringify(payload)}\n`)
}

export function createCorrelationId() {
  return crypto.randomUUID()
}

export function getOrCreateCorrelationId(value) {
  const trimmed = String(value || '').trim()
  return trimmed || createCorrelationId()
}

export function getLogPaths() {
  ensureLogDir()
  return {
    logDir: LOG_DIR,
    accessLogPath: ACCESS_LOG_PATH,
    apiLogPath: API_LOG_PATH,
    frontendLogPath: FRONTEND_LOG_PATH,
  }
}

function basePayload(entry = {}) {
  return {
    timestamp: new Date().toISOString(),
    ...safeValue(entry),
  }
}

export function logAccess(entry) {
  writeLine(accessStream, basePayload(entry))
}

export function logApi(level, message, details = {}) {
  const payload = {
    ...basePayload(details),
    level,
    message,
  }
  if (details.error) payload.error = serializeError(details.error)
  writeLine(apiStream, payload)
  const printer = level === 'error' ? console.error : console.log
  printer(message, payload.error || safeValue(details))
}

export function logError(message, details = {}) {
  logApi('error', message, details)
}

export function logInfo(message, details = {}) {
  logApi('info', message, details)
}

export function logFrontend(entry) {
  writeLine(frontendStream, basePayload(entry))
}

export function requestContext(req) {
  return safeValue({
    correlationId: req.correlationId || req.headers['x-correlation-id'] || null,
    method: req.method,
    path: req.originalUrl || req.url,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
    user: req.user ? { id: req.user.id, email: req.user.email } : null,
    params: req.params,
    query: req.query,
    body: req.body,
  })
}

export function requestCorrelationMiddleware(req, res, next) {
  req.correlationId = getOrCreateCorrelationId(req.headers['x-correlation-id'])
  res.setHeader('X-Correlation-Id', req.correlationId)
  next()
}

export function accessLogMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint()
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    logAccess({
      type: 'http_access',
      correlationId: req.correlationId || null,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
      userId: req.user?.id || null,
      userEmail: req.user?.email || null,
    })
  })
  next()
}
