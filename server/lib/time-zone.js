export const DEFAULT_USER_TIME_ZONE = 'America/Denver'

export function resolveUserTimeZone(value) {
  const candidate = Array.isArray(value) ? value[0] : value
  const normalized = String(candidate || '').trim()
  if (normalized) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date())
      return normalized
    } catch {
      // Invalid or unavailable client time zone; use the application default.
    }
  }
  return DEFAULT_USER_TIME_ZONE
}

export function requestUserTimeZone(req) {
  return resolveUserTimeZone(req?.headers?.['x-user-timezone'])
}
