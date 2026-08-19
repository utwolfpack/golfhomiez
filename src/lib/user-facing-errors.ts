const TECHNICAL_ERROR_PATTERN = /(?:\b(?:SQLSTATE|ER_[A-Z0-9_]+|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|TypeError|ReferenceError|SyntaxError)\b|information_schema|mysql2?|node_modules|stack trace|\bat\s+\S+\s*\(|missing values for required columns|incorrect arguments to|unknown column|foreign key constraint|request failed \(\d{3}\))/i

function cleanMessage(value: unknown) {
  return value instanceof Error ? value.message.trim() : String(value || '').trim()
}

function supportMessage(fallback: string, correlationId?: string | null) {
  const base = fallback.trim() || 'We could not complete that request.'
  const direction = /try again|refresh|contact support/i.test(base)
    ? base
    : `${base} Try again. If the problem continues, contact support.`
  return correlationId ? `${direction} Correlation ID: ${correlationId}.` : direction
}

export function toUserFacingErrorMessage(
  value: unknown,
  options: { status?: number; correlationId?: string | null; fallback?: string } = {},
) {
  const raw = cleanMessage(value)
  const status = Number(options.status || 0)
  const fallback = options.fallback || 'We could not complete that request.'

  if (/\[body\.email\].*invalid email|invalid email address|valid email is required/i.test(raw)) {
    return 'Enter a valid email address and try again.'
  }
  if (status === 401 && !raw) return 'Your session has expired. Sign in again and retry the request.'
  if (status >= 500 || TECHNICAL_ERROR_PATTERN.test(raw) || !raw) {
    return supportMessage(fallback, options.correlationId)
  }
  return raw
}

export function sanitizeErrorResponseData<T>(data: T | null, status: number, correlationId?: string | null): T | null {
  if (!data || typeof data !== 'object') return data
  const source = data as Record<string, unknown>
  const rawMessage = source.message ?? (source.error && typeof source.error === 'object' ? (source.error as Record<string, unknown>).message : null)
  const safeMessage = toUserFacingErrorMessage(rawMessage, { status, correlationId })
  const next: Record<string, unknown> = { ...source, message: safeMessage }
  if (source.error && typeof source.error === 'object') {
    next.error = { ...(source.error as Record<string, unknown>), message: safeMessage }
  }
  return next as T
}
