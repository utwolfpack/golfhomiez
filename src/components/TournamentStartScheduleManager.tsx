import { useEffect, useMemo, useState } from 'react'
import {
  autoCreateHostTournamentStartSchedule,
  autoCreateOrganizerTournamentStartSchedule,
  updateHostTournamentStartSchedule,
  updateOrganizerTournamentStartSchedule,
  type TournamentRegistration,
  type TournamentStartAssignment,
} from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { DEFAULT_TEE_TIME_INTERVAL_MINUTES } from '../lib/tournament-templates'

type Props = {
  tournamentId: string
  actor: 'host' | 'organizer'
  registrations: TournamentRegistration[]
  assignments?: TournamentStartAssignment[] | null
  startType?: string | null
  firstStartTime?: string | null
  intervalMinutes?: number | null
  onAssignmentsChange?: (assignments: TournamentStartAssignment[]) => void
}

function teamKeyForRegistration(registration: TournamentRegistration) {
  if (registration.teamId) return `team:${registration.teamId}`
  if (registration.teamName) return `name:${registration.teamName.trim().toLowerCase()}`
  return `registration:${registration.id}`
}

function normalizeStartType(value?: string | null): 'shotgun' | 'tee-times' {
  return value === 'tee-times' ? 'tee-times' : 'shotgun'
}

function normalizeInterval(value?: number | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 5 && parsed <= 60 ? Math.trunc(parsed) : DEFAULT_TEE_TIME_INTERVAL_MINUTES
}

function normalizeRows(assignments?: TournamentStartAssignment[] | null) {
  return [...(assignments || [])].sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
}

export default function TournamentStartScheduleManager({
  tournamentId,
  actor,
  registrations,
  assignments,
  startType,
  firstStartTime,
  intervalMinutes,
  onAssignmentsChange,
}: Props) {
  const [rows, setRows] = useState<TournamentStartAssignment[]>(() => normalizeRows(assignments))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => setRows(normalizeRows(assignments)), [assignments])

  const registeredTeamKeys = useMemo(() => new Set(registrations.map(teamKeyForRegistration)), [registrations])
  const scheduledTeamKeys = useMemo(() => new Set(rows.map((row) => row.teamKey)), [rows])
  const missingTeamCount = [...registeredTeamKeys].filter((teamKey) => !scheduledTeamKeys.has(teamKey)).length
  const staleTeamCount = [...scheduledTeamKeys].filter((teamKey) => !registeredTeamKeys.has(teamKey)).length
  const resolvedStartType = normalizeStartType(startType)
  const resolvedFirstStartTime = String(firstStartTime || '08:30').slice(0, 5)
  const resolvedIntervalMinutes = normalizeInterval(intervalMinutes)

  function applySavedAssignments(nextRows: TournamentStartAssignment[], eventName: string) {
    const normalized = normalizeRows(nextRows)
    setRows(normalized)
    onAssignmentsChange?.(normalized)
    logFrontendEvent({
      category: `tournaments.${actor}.start-schedule`,
      message: eventName,
      data: { tournamentId, assignmentCount: normalized.length, startType: resolvedStartType },
    })
  }

  async function autoCreateSchedule() {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const input = {
        startType: resolvedStartType,
        firstStartTime: resolvedFirstStartTime,
        intervalMinutes: resolvedIntervalMinutes,
      }
      const result = actor === 'host'
        ? await autoCreateHostTournamentStartSchedule(tournamentId, input)
        : await autoCreateOrganizerTournamentStartSchedule(tournamentId, input)
      applySavedAssignments(result.assignments, 'tournament_start_schedule_auto_created')
      setSuccess(`Suggested ${resolvedStartType === 'shotgun' ? 'shotgun' : 'tee-time'} schedule created for ${result.assignments.length} team${result.assignments.length === 1 ? '' : 's'}.`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create the team start schedule.'
      setError(message)
      logFrontendEvent({ category: `tournaments.${actor}.start-schedule`, level: 'error', message: 'tournament_start_schedule_auto_create_failed', data: { tournamentId, error: message } })
    } finally {
      setBusy(false)
    }
  }

  async function persistSchedule(nextRows: TournamentStartAssignment[], successMessage: string, eventName: string) {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const payload = nextRows.map((row, index) => ({ ...row, sortOrder: index }))
      const result = actor === 'host'
        ? await updateHostTournamentStartSchedule(tournamentId, payload)
        : await updateOrganizerTournamentStartSchedule(tournamentId, payload)
      applySavedAssignments(result.assignments, eventName)
      setSuccess(successMessage)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save the team start schedule.'
      setError(message)
      logFrontendEvent({ category: `tournaments.${actor}.start-schedule`, level: 'error', message: 'tournament_start_schedule_save_failed', data: { tournamentId, error: message } })
    } finally {
      setBusy(false)
    }
  }

  async function saveSchedule() {
    await persistSchedule(rows, 'Team start schedule saved.', 'tournament_start_schedule_saved')
  }

  async function clearSchedule() {
    await persistSchedule([], 'Team start schedule cleared.', 'tournament_start_schedule_cleared')
  }

  function updateRow(teamKey: string, changes: Partial<TournamentStartAssignment>) {
    setRows((current) => current.map((row) => row.teamKey === teamKey ? { ...row, ...changes } : row))
  }

  return (
    <section className="card tournament-start-schedule-manager" style={{ padding: 16, background: '#f8fafc' }}>
      <div className="tournament-start-schedule-heading">
        <div>
          <strong>Team start schedule</strong>
          <div className="small">
            Auto-create assignments from registered teams, then edit each team’s start time and starting hole before saving.
          </div>
        </div>
        <button type="button" className="btn btnTournamentScheduleAuto" disabled={busy || registrations.length === 0} onClick={() => { void autoCreateSchedule() }}>
          {busy ? 'Working…' : 'Auto-create team schedule'}
        </button>
      </div>

      <div className="small tournament-start-schedule-summary">
        Start method: <strong>{resolvedStartType === 'shotgun' ? 'Shotgun start' : 'Tee times'}</strong> · First start: <strong>{resolvedFirstStartTime}</strong>
        {resolvedStartType === 'tee-times' ? <> · Interval: <strong>{resolvedIntervalMinutes} minutes</strong></> : null}
      </div>

      {registrations.length === 0 ? <div className="small">No teams have registered yet. The schedule can be created after at least one team registers.</div> : null}
      {missingTeamCount > 0 && rows.length > 0 ? <div className="small" role="status" style={{ color: '#92400e' }}>{missingTeamCount} registered team{missingTeamCount === 1 ? ' is' : 's are'} not scheduled. Run Auto-create team schedule to include all registered teams.</div> : null}
      {staleTeamCount > 0 ? <div className="small" role="alert" style={{ color: '#b91c1c' }}>{staleTeamCount} scheduled team{staleTeamCount === 1 ? ' is' : 's are'} no longer registered. Run Auto-create team schedule before saving.</div> : null}
      {error ? <div className="small" role="alert" style={{ color: '#b91c1c' }}>{error}</div> : null}
      {success ? <div className="small" role="status" style={{ color: '#166534' }}>{success}</div> : null}

      {rows.length ? (
        <div className="tournament-start-schedule-list" style={{ marginTop: 12 }}>
          {rows.map((row, index) => (
            <div className="card tournament-start-schedule-row" key={row.teamKey}>
              <div className="tournament-start-schedule-team">
                <span className="tournament-start-schedule-number">{index + 1}</span>
                <div><strong>{row.teamName}</strong><div className="small">{row.startType === 'shotgun' ? 'Shotgun assignment' : 'Tee-time assignment'}</div></div>
              </div>
              <label>
                <span className="label">Start time</span>
                <input className="input" type="time" value={String(row.startTime || '').slice(0, 5)} onChange={(event) => updateRow(row.teamKey, { startTime: event.target.value })} />
              </label>
              <label>
                <span className="label">{row.startType === 'shotgun' ? 'Starting hole' : 'Starting tee'}</span>
                <input className="input" value={row.startingHole || ''} maxLength={12} onChange={(event) => updateRow(row.teamKey, { startingHole: event.target.value.toUpperCase() })} placeholder={row.startType === 'shotgun' ? '1 or 1B' : '1'} />
              </label>
              <label>
                <span className="label">Notes</span>
                <input className="input" value={row.notes || ''} maxLength={500} onChange={(event) => updateRow(row.teamKey, { notes: event.target.value })} placeholder="Optional" />
              </label>
            </div>
          ))}
          <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn" disabled={busy || staleTeamCount > 0} onClick={() => { void saveSchedule() }}>{busy ? 'Saving…' : 'Save team schedule'}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => { void clearSchedule() }}>Clear schedule</button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
