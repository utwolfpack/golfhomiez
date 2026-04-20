import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'

const LOG_DIR = path.resolve(process.cwd(), 'logging')
const ACCESS_LOG_PATH = path.join(LOG_DIR, 'access.log')
const ERROR_LOG_PATH = path.join(LOG_DIR, 'error.log')
const FRONTEND_LOG_PATH = path.join(LOG_DIR, 'frontend.log')
const API_LOG_PATH = path.join(LOG_DIR, 'api.log')
const SMTP_LOG_PATH = path.join(LOG_DIR, 'smtp.log')
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
const frontendStream = createStream(FRONTEND_LOG_PATH)
const apiStream = createStream(API_LOG_PATH)
const smtpStream = createStream(SMTP_LOG_PATH)

const requestStore = new AsyncLocalStorage()

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

function normalizeDetails(details = {}) {
  const payload = safeValue(details)
  if (details.error) payload.error = serializeError(details.error)
  return payload
}

export function getLogPaths() {
  ensureLogDir()
  return {
    logDir: LOG_DIR,
    accessLogPath: ACCESS_LOG_PATH,
    errorLogPath: ERROR_LOG_PATH,
    frontendLogPath: FRONTEND_LOG_PATH,
    apiLogPath: API_LOG_PATH,
    smtpLogPath: SMTP_LOG_PATH,
  }
}

export function logAccess(entry) {
  writeLine(accessStream, {
    timestamp: new Date().toISOString(),
    ...safeValue(entry),
  })
}

export function logError(message, details = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level: 'error',
    correlationId: details.correlationId || getCorrelationId() || null,
    message,
    ...normalizeDetails(details),
  }
  writeLine(errorStream, payload)
  console.error(message, payload.error || details)
}


export function logWarn(message, details = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level: 'warn',
    correlationId: details.correlationId || getCorrelationId() || null,
    message,
    ...normalizeDetails(details),
  }
  writeLine(errorStream, payload)
  console.warn(message)
}

export function logFrontend(message, details = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level: 'info',
    correlationId: details.correlationId || getCorrelationId() || null,
    message,
    ...normalizeDetails(details),
  }
  writeLine(frontendStream, payload)
}

export function logApi(message, details = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level: 'info',
    correlationId: details.correlationId || getCorrelationId() || null,
    message,
    ...normalizeDetails(details),
  }
  writeLine(apiStream, payload)
}


export function logSmtp(message, details = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level: 'info',
    correlationId: details.correlationId || getCorrelationId(),
    message,
    ...normalizeDetails(details),
  }
  writeLine(smtpStream, payload)
}

export function getCorrelationId() {
  return requestStore.getStore()?.correlationId || null
}

export function logInfo(message, details = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level: 'info',
    correlationId: details.correlationId || getCorrelationId() || null,
    message,
    ...normalizeDetails(details),
  }
  writeLine(accessStream, payload)
  console.log(message)
}

export function requestContext(req) {
  return safeValue({
    correlationId: req?.correlationId || getCorrelationId() || null,
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
  const incoming = req.headers['x-correlation-id'] || req.headers['x-request-id']
  const correlationId = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID()
  req.correlationId = correlationId
  res.setHeader('X-Correlation-Id', correlationId)
  requestStore.run({ correlationId }, () => next())
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
