export function normalizeTournamentScheduleDate(value) {
  const normalized = String(value || '').trim()
  const directMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})/)
  if (directMatch) return directMatch[1]
  if (!normalized) return ''
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return ''
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`
}

export function formatTournamentScheduleDate(value) {
  const key = normalizeTournamentScheduleDate(value)
  if (!key) return String(value || '').trim() || 'that date'
  const [year, month, day] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day, 12))
}

export function findTournamentDateConflict(tournaments = [], startDate, excludeTournamentId = null) {
  const requestedDate = normalizeTournamentScheduleDate(startDate)
  if (!requestedDate) return null
  return (Array.isArray(tournaments) ? tournaments : []).find((tournament) => {
    if (excludeTournamentId && String(tournament?.id || '') === String(excludeTournamentId)) return false
    if (tournament?.archivedAt || tournament?.archived_at) return false
    if (String(tournament?.status || '').trim().toLowerCase() === 'cancelled') return false
    return normalizeTournamentScheduleDate(tournament?.startDate || tournament?.start_date || tournament?.starts_at) === requestedDate
  }) || null
}
