import { randomUUID } from 'node:crypto'

export const DEFAULT_TEE_TIME_INTERVAL_MINUTES = 10
export const MAX_TOURNAMENT_START_ASSIGNMENTS = 500

export function normalizeTournamentStartType(value) {
  return String(value || '').trim().toLowerCase() === 'tee-times' ? 'tee-times' : 'shotgun'
}

export function normalizeTournamentStartTime(value, fallback = '08:30') {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match) return fallback
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function normalizeTeeTimeIntervalMinutes(value, fallback = DEFAULT_TEE_TIME_INTERVAL_MINUTES) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed < 5 || parsed > 60) return fallback
  return parsed
}

export function tournamentRegistrationStartTeamKey(registration) {
  const teamId = String(registration?.teamId || '').trim()
  if (teamId) return `team:${teamId}`
  const teamName = String(registration?.teamName || '').trim().toLowerCase()
  if (teamName) return `name:${teamName}`
  return `registration:${String(registration?.id || '').trim()}`
}

function addMinutes(time, minutesToAdd) {
  const normalized = normalizeTournamentStartTime(time)
  const [hours, minutes] = normalized.split(':').map(Number)
  const totalMinutes = ((hours * 60 + minutes + minutesToAdd) % (24 * 60) + (24 * 60)) % (24 * 60)
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
}

function shotgunHoleLabel(index) {
  const hole = (index % 18) + 1
  const wave = Math.floor(index / 18)
  if (wave === 0) return String(hole)
  const suffix = String.fromCharCode(65 + Math.min(wave, 25))
  return `${hole}${suffix}`
}

function registrationSortValue(registration) {
  const timestamp = Date.parse(String(registration?.registeredAt || ''))
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER
}

export function buildSuggestedTournamentStartAssignments(registrations = [], options = {}) {
  const teams = [...(Array.isArray(registrations) ? registrations : [])]
    .filter((registration) => registration?.id)
    .sort((left, right) => {
      const timestampDifference = registrationSortValue(left) - registrationSortValue(right)
      if (timestampDifference !== 0) return timestampDifference
      return String(left?.teamName || left?.name || '').localeCompare(String(right?.teamName || right?.name || ''))
    })

  if (!teams.length) throw new Error('No registered teams are available. Register at least one team before creating the start schedule.')
  if (teams.length > MAX_TOURNAMENT_START_ASSIGNMENTS) throw new Error(`A maximum of ${MAX_TOURNAMENT_START_ASSIGNMENTS} teams can be scheduled at one time.`)

  const startType = normalizeTournamentStartType(options.startType)
  const firstStartTime = normalizeTournamentStartTime(options.firstStartTime || options.teeTime)
  const intervalMinutes = normalizeTeeTimeIntervalMinutes(options.intervalMinutes)

  return teams.map((registration, index) => ({
    id: null,
    tournamentId: String(options.tournamentId || ''),
    teamKey: tournamentRegistrationStartTeamKey(registration),
    registrationId: registration.id || null,
    teamId: registration.teamId || null,
    teamName: String(registration.teamName || registration.name || `Team ${index + 1}`).trim(),
    startType,
    startTime: startType === 'tee-times' ? addMinutes(firstStartTime, index * intervalMinutes) : firstStartTime,
    startingHole: startType === 'shotgun' ? shotgunHoleLabel(index) : '1',
    sortOrder: index,
    notes: null,
  }))
}

function cleanStartingHole(value, startType) {
  const cleaned = String(value || '').trim().replace(/[^0-9A-Za-z-]/g, '').slice(0, 12)
  if (cleaned) return cleaned.toUpperCase()
  return startType === 'tee-times' ? '1' : ''
}

function cleanNotes(value) {
  const cleaned = String(value || '').trim()
  return cleaned ? cleaned.slice(0, 500) : null
}

export function sanitizeTournamentStartAssignments(assignments = [], registrations = []) {
  if (!Array.isArray(assignments)) throw new Error('Start assignments must be provided as a list.')
  if (assignments.length > MAX_TOURNAMENT_START_ASSIGNMENTS) throw new Error(`A maximum of ${MAX_TOURNAMENT_START_ASSIGNMENTS} teams can be scheduled at one time.`)

  const registrationMap = new Map((Array.isArray(registrations) ? registrations : []).map((registration) => [tournamentRegistrationStartTeamKey(registration), registration]))
  const seenTeamKeys = new Set()

  return assignments.map((assignment, index) => {
    const teamKey = String(assignment?.teamKey || '').trim()
    const registration = registrationMap.get(teamKey)
    if (!registration) throw new Error('One or more scheduled teams are no longer registered for this tournament. Refresh the page and create the schedule again.')
    if (seenTeamKeys.has(teamKey)) throw new Error(`The team ${registration.teamName || registration.name || teamKey} appears more than once in the start schedule.`)
    seenTeamKeys.add(teamKey)

    const startType = normalizeTournamentStartType(assignment?.startType)
    const startTime = normalizeTournamentStartTime(assignment?.startTime, '')
    if (!startTime) throw new Error(`Start time is required for ${registration.teamName || registration.name || 'each team'}.`)
    const startingHole = cleanStartingHole(assignment?.startingHole, startType)
    if (startType === 'shotgun' && !startingHole) throw new Error(`Starting hole is required for ${registration.teamName || registration.name || 'each team'} in a shotgun start.`)

    return {
      id: String(assignment?.id || '').trim() || null,
      teamKey,
      registrationId: registration.id || null,
      teamId: registration.teamId || null,
      teamName: String(registration.teamName || registration.name || `Team ${index + 1}`).trim(),
      startType,
      startTime,
      startingHole,
      sortOrder: Number.isFinite(Number(assignment?.sortOrder)) ? Math.max(0, Math.trunc(Number(assignment.sortOrder))) : index,
      notes: cleanNotes(assignment?.notes),
    }
  })
}

export function mapTournamentStartAssignmentRow(row) {
  if (!row) return null
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    teamKey: row.team_key,
    registrationId: row.registration_id || null,
    teamId: row.team_id || null,
    teamName: row.team_name || 'Tournament team',
    startType: normalizeTournamentStartType(row.start_type),
    startTime: normalizeTournamentStartTime(row.start_time, ''),
    startingHole: row.starting_hole || null,
    sortOrder: Number(row.sort_order || 0),
    notes: row.notes || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

export async function listTournamentStartAssignmentsForTournaments(pool, tournamentIds = []) {
  const ids = [...new Set((tournamentIds || []).map((id) => String(id || '').trim()).filter(Boolean))]
  const result = new Map(ids.map((id) => [id, []]))
  if (!ids.length) return result
  const placeholders = ids.map(() => '?').join(',')
  const [rows] = await pool.execute(
    `SELECT id, tournament_id, team_key, registration_id, team_id, team_name, start_type, start_time, starting_hole, sort_order, notes, created_at, updated_at
       FROM tournament_team_start_assignments
      WHERE tournament_id IN (${placeholders})
      ORDER BY tournament_id ASC, sort_order ASC, start_time ASC, team_name ASC`,
    ids,
  )
  for (const row of rows) {
    const tournamentId = String(row.tournament_id)
    if (!result.has(tournamentId)) result.set(tournamentId, [])
    result.get(tournamentId).push(mapTournamentStartAssignmentRow(row))
  }
  return result
}

export async function listTournamentStartAssignments(pool, tournamentId) {
  const byTournament = await listTournamentStartAssignmentsForTournaments(pool, [tournamentId])
  return byTournament.get(String(tournamentId)) || []
}

async function withTransaction(pool, operation) {
  if (typeof pool.getConnection !== 'function') return operation(pool)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await operation(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback().catch(() => undefined)
    throw error
  } finally {
    connection.release()
  }
}

export async function replaceTournamentStartAssignments(pool, options = {}) {
  const tournamentId = String(options.tournamentId || '').trim()
  if (!tournamentId) throw new Error('Tournament id is required to save the start schedule.')
  const assignments = sanitizeTournamentStartAssignments(options.assignments, options.registrations)
  const updatedByAuthUserId = String(options.updatedByAuthUserId || '').trim() || null
  const correlationId = String(options.correlationId || '').trim() || null

  await withTransaction(pool, async (db) => {
    await db.execute('DELETE FROM tournament_team_start_assignments WHERE tournament_id = ?', [tournamentId])
    for (const assignment of assignments) {
      await db.execute(
        `INSERT INTO tournament_team_start_assignments
          (id, tournament_id, team_key, registration_id, team_id, team_name, start_type, start_time, starting_hole, sort_order, notes, updated_by_auth_user_id, correlation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assignment.id || randomUUID(),
          tournamentId,
          assignment.teamKey,
          assignment.registrationId,
          assignment.teamId,
          assignment.teamName,
          assignment.startType,
          `${assignment.startTime}:00`,
          assignment.startingHole,
          assignment.sortOrder,
          assignment.notes,
          updatedByAuthUserId,
          correlationId,
        ],
      )
    }
  })

  return listTournamentStartAssignments(pool, tournamentId)
}
