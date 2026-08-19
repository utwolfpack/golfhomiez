import { DEFAULT_USER_TIME_ZONE, resolveUserTimeZone } from './time-zone.js'

export function getTodayInTimeZone(timeZone) {
  const effectiveTimeZone = resolveUserTimeZone(timeZone)
  try {
    if (effectiveTimeZone) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: effectiveTimeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date())
      const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]))
      if (map.year && map.month && map.day) return `${map.year}-${map.month}-${map.day}`
    }
  } catch {
  }

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_USER_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]))
    if (map.year && map.month && map.day) return `${map.year}-${map.month}-${map.day}`
  } catch {
  }

  return new Date().toISOString().slice(0, 10)
}

export function isValidPastOrTodayDate(dateStr, timeZone) {
  const value = String(dateStr || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const dt = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(dt.getTime())) return false
  return value <= getTodayInTimeZone(timeZone)
}
