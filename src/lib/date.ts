import { loadSavedLocation } from './location-store'

export function getUserTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz || undefined
  } catch {
    return undefined
  }
}

export function getUserTodayISO() {
  loadSavedLocation()
  try {
    const tz = getUserTimeZone()
    if (tz) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date())
      const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]))
      if (map.year && map.month && map.day) return `${map.year}-${map.month}-${map.day}`
    }
  } catch {
  }
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
