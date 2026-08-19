export const DEFAULT_USER_TIME_ZONE = 'America/Denver'

export function getUserTimeZone(): string {
  try {
    const candidate = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (candidate) return candidate
  } catch {
    // Fall through to the application default.
  }
  return DEFAULT_USER_TIME_ZONE
}

export function getCurrentYearInUserTimeZone(date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: getUserTimeZone(),
      year: 'numeric',
    }).formatToParts(date)
    const year = Number(parts.find((part) => part.type === 'year')?.value)
    if (Number.isFinite(year) && year > 0) return year
  } catch {
    // Fall through to the Mountain Time formatter below.
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_USER_TIME_ZONE,
      year: 'numeric',
    }).formatToParts(date)
    const year = Number(parts.find((part) => part.type === 'year')?.value)
    if (Number.isFinite(year) && year > 0) return year
  } catch {
    // Last-resort fallback for environments without Intl time-zone support.
  }

  return date.getUTCFullYear()
}
