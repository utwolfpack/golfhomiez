import fs from 'fs'
import path from 'path'

const LOG_DIR = path.resolve(process.cwd(), 'logging')
const ACCESS_LOG_PATH = path.join(LOG_DIR, 'access.log')
const ERROR_LOG_PATH = path.join(LOG_DIR, 'error.log')
const REDACT_KEYS = new Set(['password', 'passwordhash', 'token', 'authorization', 'cookie', 'secret', 'smtp_pass', 'smtp_key'])

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

function createStream(filePath) {
  ensureLogDir()
  return fs.createWriteStream(filePath, { flags: 'a' })
}

const accessStream = createStream(ACCESS_LOG_PATH)
const errorStream = createStream(ERROR_LOG_PATH)

function safeValue(value, depth = 0) {
  if (value == null) return value
  if (depth > 5) return '[truncated]'
  if (Array.isArray(value)) return value.map((item) => safeValue(item, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => {
      if (REDACT_KEYS.has(String(key).toLowerCase())) return [key, '[redacted]']
      return [key, safeValue(val, depth + 1)]
    }))
  }
  if (typeof value === 'string' && value.length > 3000) return `${value.slice(0, 2997)}...`
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

function normalizePayload(message, details = {}, level = 'info') {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...safeValue(details),
  }
  if (details.error) payload.error = serializeError(details.error)
  return payload
}

export function getLogPaths() {
  ensureLogDir()
  return { logDir: LOG_DIR, accessLogPath: ACCESS_LOG_PATH, errorLogPath: ERROR_LOG_PATH }
}

export function logAccess(entry) {
  writeLine(accessStream, {
    timestamp: new Date().toISOString(),
    ...safeValue(entry),
  })
}

export function logInfo(message, details = {}) {
  const payload = normalizePayload(message, details, 'info')
  writeLine(accessStream, payload)
  return payload
}

export function logError(message, details = {}) {
  const payload = normalizePayload(message, details, 'error')
  writeLine(errorStream, payload)
  console.error(message, payload.error || details)
  return payload
}

export function requestContext(req) {
  return safeValue({
    method: req.method,
    path: req.originalUrl || req.url,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
    user: req.user ? { id: req.user.id, email: req.user.email, dbUserId: req.user.dbUserId || null } : null,
    params: req.params,
    query: req.query,
    body: req.body,
  })
}

export function accessLogMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint()
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    logAccess({
      type: 'http_access',
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

export function logClientDiagnostic(message, details = {}) {
  const level = details.level === 'error' ? 'error' : 'info'
  return level === 'error'
    ? logError(message, { source: 'client', ...details })
    : logInfo(message, { source: 'client', ...details })
}
