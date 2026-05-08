import { randomUUID } from 'crypto'
import { deleteTournamentWithSafeAssociations } from './tournament-delete.js'

export const CANCELLED_TOURNAMENT_CLEANUP_TIME_ZONE = 'America/Denver'
export const CANCELLED_TOURNAMENT_CLEANUP_WEEKDAY = 0
export const CANCELLED_TOURNAMENT_CLEANUP_HOUR = 18
export const CANCELLED_TOURNAMENT_CLEANUP_MINUTE = 0

const WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

function readPart(parts, type) {
  return parts.find((part) => part.type === type)?.value || ''
}

export function getMountainTimeParts(date = new Date(), timeZone = CANCELLED_TOURNAMENT_CLEANUP_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  return {
    weekday: WEEKDAY_INDEX[readPart(parts, 'weekday')],
    year: Number(readPart(parts, 'year')),
    month: Number(readPart(parts, 'month')),
    day: Number(readPart(parts, 'day')),
    hour: Number(readPart(parts, 'hour')),
    minute: Number(readPart(parts, 'minute')),
    second: Number(readPart(parts, 'second')),
  }
}

export function mountainLocalTimeToUtc(year, month, day, hour, minute = 0, second = 0, timeZone = CANCELLED_TOURNAMENT_CLEANUP_TIME_ZONE) {
  const desiredLocalAsUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  let guess = new Date(desiredLocalAsUtc)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getMountainTimeParts(guess, timeZone)
    const actualLocalAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    const diffMs = desiredLocalAsUtc - actualLocalAsUtc
    if (diffMs === 0) break
    guess = new Date(guess.getTime() + diffMs)
  }

  return guess
}

export function nextCancelledTournamentCleanupRun(now = new Date(), timeZone = CANCELLED_TOURNAMENT_CLEANUP_TIME_ZONE) {
  const local = getMountainTimeParts(now, timeZone)
  let daysUntilSunday = (7 + CANCELLED_TOURNAMENT_CLEANUP_WEEKDAY - local.weekday) % 7
  const cleanupTimePassedToday = local.weekday === CANCELLED_TOURNAMENT_CLEANUP_WEEKDAY && (
    local.hour > CANCELLED_TOURNAMENT_CLEANUP_HOUR ||
    (local.hour === CANCELLED_TOURNAMENT_CLEANUP_HOUR && local.minute > CANCELLED_TOURNAMENT_CLEANUP_MINUTE) ||
    (local.hour === CANCELLED_TOURNAMENT_CLEANUP_HOUR && local.minute === CANCELLED_TOURNAMENT_CLEANUP_MINUTE && local.second > 0)
  )
  if (cleanupTimePassedToday) daysUntilSunday = 7

  const targetDate = new Date(Date.UTC(local.year, local.month - 1, local.day + daysUntilSunday, 12, 0, 0))
  return mountainLocalTimeToUtc(
    targetDate.getUTCFullYear(),
    targetDate.getUTCMonth() + 1,
    targetDate.getUTCDate(),
    CANCELLED_TOURNAMENT_CLEANUP_HOUR,
    CANCELLED_TOURNAMENT_CLEANUP_MINUTE,
    0,
    timeZone,
  )
}

function emptyDeletedRecords() {
  return {
    tournamentRegistrations: 0,
    organizerTournamentInvites: 0,
    tournaments: 0,
  }
}

function addDeletedRecords(total, deletedRecords = {}) {
  for (const key of Object.keys(total)) total[key] += Number(deletedRecords[key] || 0)
  return total
}

export async function deleteCancelledTournaments(pool, { correlationId = `cancelled-tournament-cleanup-${randomUUID()}`, logApi = () => {}, logError = () => {} } = {}) {
  const [rows] = await pool.execute(
    `SELECT id, tournament_identifier, name, status
       FROM tournaments
      WHERE LOWER(status) = 'cancelled'
      ORDER BY updated_at ASC, created_at ASC`,
  )

  const deletedRecords = emptyDeletedRecords()
  const deletedTournaments = []
  const failures = []

  logApi('cancelled_tournament_cleanup_started', { correlationId, candidateCount: rows.length })

  for (const row of rows) {
    try {
      const result = await deleteTournamentWithSafeAssociations(pool, row)
      if (result?.deleted) {
        deletedTournaments.push(result)
        addDeletedRecords(deletedRecords, result.deletedRecords)
        logApi('cancelled_tournament_cleanup_deleted', {
          correlationId,
          tournamentId: result.tournamentId,
          tournamentIdentifier: result.tournamentIdentifier || null,
          name: result.name || null,
          deletedRecords: result.deletedRecords,
        })
      }
    } catch (error) {
      failures.push({ tournamentId: row.id, tournamentIdentifier: row.tournament_identifier || null, error: error?.message || String(error) })
      logError('Cancelled tournament cleanup failed for tournament', { correlationId, tournamentId: row.id, tournamentIdentifier: row.tournament_identifier || null, error })
    }
  }

  const summary = {
    correlationId,
    candidateCount: rows.length,
    deletedCount: deletedTournaments.length,
    failureCount: failures.length,
    deletedRecords,
    deletedTournaments,
    failures,
  }

  logApi('cancelled_tournament_cleanup_completed', summary)
  return summary
}

export function startCancelledTournamentCleanupScheduler(getPool, { logApi = () => {}, logError = () => {}, logInfo = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, now = () => new Date() } = {}) {
  let stopped = false
  let timer = null

  const scheduleNext = () => {
    if (stopped) return
    const current = now()
    const nextRun = nextCancelledTournamentCleanupRun(current)
    const delayMs = Math.max(0, nextRun.getTime() - current.getTime())
    logInfo('Cancelled tournament cleanup scheduled', {
      correlationId: null,
      timeZone: CANCELLED_TOURNAMENT_CLEANUP_TIME_ZONE,
      schedule: 'Sunday 18:00 MT',
      nextRunAt: nextRun.toISOString(),
    })
    timer = setTimer(runCleanup, delayMs)
    if (typeof timer?.unref === 'function') timer.unref()
  }

  const runCleanup = async () => {
    if (stopped) return
    const correlationId = `cancelled-tournament-cleanup-${randomUUID()}`
    try {
      await deleteCancelledTournaments(getPool(), { correlationId, logApi, logError })
    } catch (error) {
      logError('Cancelled tournament cleanup job failed', { correlationId, error })
    } finally {
      scheduleNext()
    }
  }

  scheduleNext()

  return {
    stop() {
      stopped = true
      if (timer) clearTimer(timer)
    },
  }
}
