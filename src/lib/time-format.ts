function parseDateValue(value: string): Date {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number)
    return new Date(year, month - 1, day, 0, 0, 0)
  }
  return new Date(trimmed)
}

export function getUserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

export function formatFriendlyDateTime(value?: string | null): string {
  if (!value) return 'Unknown time'
  const date = parseDateValue(String(value))
  if (Number.isNaN(date.getTime())) return String(value).replace(/\.\d{1,3}(?=Z|[+-]\d{2}:?\d{2}|$)/, '')

  const formatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: getUserTimeZone(),
  })

  const parts = formatter.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value || ''
  return `${part('month')} ${part('day')} ${part('year')} – ${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase()}`
}

export function formatDateTimeNoMilliseconds(value?: string | null): string {
  return formatFriendlyDateTime(value)
}
