import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation } from 'react-router'
import PageHero from '../components/PageHero'
import { archiveOrganizerTournamentRecord, fetchOrganizerPortal, restoreOrganizerTournamentRecord, updateOrganizerTournamentRecord, type OrganizerPortalSummary, type Tournament, type TournamentInput } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { formatFriendlyDateTime } from '../lib/time-format'
import TournamentTemplateFields, { TournamentRegistrationDeadlineField, TournamentSummaryField } from '../components/TournamentTemplateFields'
import TournamentStartScheduleManager from '../components/TournamentStartScheduleManager'
import TournamentManagementLineItem, { TournamentManagementPagination } from '../components/TournamentManagementLineItem'
import { DEFAULT_TEE_TIME_INTERVAL_MINUTES, DEFAULT_TOURNAMENT_CHECK_IN_TIME, DEFAULT_TOURNAMENT_TEE_TIME, emptyTournamentTemplateData } from '../lib/tournament-templates'
import { getFriendlyTournamentError, validateTournamentForSave } from '../lib/tournament-errors'

const DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT = 24
const TOURNAMENTS_PER_PAGE = 10

function readTeamSlotLimit(value?: number | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT
}


function tournamentStats(tournament: Tournament) {
  const registeredTeamCount = tournament.registeredTeamCount ?? tournament.registrationCount ?? tournament.registrations?.length ?? 0
  const teamSlotLimit = readTeamSlotLimit(tournament.teamSlotLimit)
  return {
    registeredTeamCount,
    verifiedUserCount: tournament.verifiedUserCount ?? 0,
    teamSlotLimit,
    openTeamSlotCount: tournament.openTeamSlotCount ?? Math.max(teamSlotLimit - registeredTeamCount, 0),
  }
}

function TournamentCapacitySummary({ tournament }: { tournament: Tournament }) {
  const stats = tournamentStats(tournament)
  return (
    <div className="tournament-capacity-grid" aria-label="Tournament team registration summary">
      <div className="card statCardCompact tournament-capacity-card"><div className="statCardLabel">Teams registered</div><div className="statCardValue">{stats.registeredTeamCount}</div></div>
      <div className="card statCardCompact tournament-capacity-card"><div className="statCardLabel">Verified users</div><div className="statCardValue">{stats.verifiedUserCount}</div></div>
      <div className="card statCardCompact tournament-capacity-card"><div className="statCardLabel">Team slots open</div><div className="statCardValue">{stats.openTeamSlotCount}</div><div className="small">of {stats.teamSlotLimit} teams</div></div>
    </div>
  )
}

function formatRegisteredAt(value?: string | null) {
  if (!value) return 'Unknown time'
  return formatFriendlyDateTime(value)
}


function tournamentMemberStatus(member: { registered?: boolean; verified?: boolean }) {
  if (member.registered && member.verified) return 'Registered and verified'
  if (member.registered) return 'Registered; verification pending'
  return 'Needs tournament registration'
}

function tournamentMemberStatusClass(member: { registered?: boolean; verified?: boolean }) {
  if (member.registered && member.verified) return 'tournament-member-status tournament-member-status--verified'
  if (member.registered) return 'tournament-member-status tournament-member-status--registered'
  return 'tournament-member-status tournament-member-status--needs-registration'
}

function RegisteredGolfers({ tournament }: { tournament: Tournament }) {
  const registrations = tournament.registrations || []
  return (
    <div className="card" style={{ padding: 12, background: '#f8fafc' }}>
      <div style={{ fontWeight: 700 }}>Teams signed up ({tournamentStats(tournament).registeredTeamCount})</div>
      <TournamentCapacitySummary tournament={tournament} />
      {registrations.length === 0 ? (
        <div className="small">No teams have signed up yet.</div>
      ) : (
        <div className="formStack" style={{ marginTop: 8 }}>
          {registrations.map((registration) => {
            const members = registration.teamMembers || []
            const registeredCount = members.filter((member) => member.registered).length
            return (
              <div key={registration.id} className="card tournament-team-registration-card" style={{ padding: 12, background: '#fff' }}>
                <div><strong>{registration.teamName || registration.name || 'Registered team'}</strong> · {formatRegisteredAt(registration.registeredAt)}</div>
                <div className="small">Registrant: {registration.name || 'Registered golfer'} · {registration.email}</div>
                <div className="small" style={{ marginTop: 4 }}>{registeredCount} of {members.length || 1} members have registered for this tournament.</div>
                {members.length ? (
                  <ul className="tournament-team-member-status-list" aria-label={`${registration.teamName || 'Team'} member registration statuses`}>
                    {members.map((member) => (
                      <li key={member.email || member.id || member.name}>
                        <span className="tournament-team-member-name">{member.name || member.email || 'Team member'}</span>
                        {member.email ? <span className="small tournament-team-member-email">{member.email}</span> : null}
                        <span className={tournamentMemberStatusClass(member)}>{tournamentMemberStatus(member)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="small" style={{ marginTop: 6 }}>Team roster unavailable.</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function toEditableTemplateData(tournament: Tournament): Record<string, unknown> {
  const templateData = { ...emptyTournamentTemplateData(), ...(tournament.templateData || {}) }
  return {
    ...templateData,
    locationAddress: String((templateData as any).locationAddress || '').trim() || tournament.hostGolfCourseAddress || tournament.hostGolfCourseName || '',
    hostOrganization: String((templateData as any).hostOrganization || '').trim() || tournament.hostGolfCourseName || '',
    checkInTime: String((templateData as any).checkInTime || '').trim() || DEFAULT_TOURNAMENT_CHECK_IN_TIME,
    teeTime: String((templateData as any).teeTime || '').trim() || DEFAULT_TOURNAMENT_TEE_TIME,
    teeTimeIntervalMinutes: Number((templateData as any).teeTimeIntervalMinutes) >= 5 && Number((templateData as any).teeTimeIntervalMinutes) <= 60
      ? Math.trunc(Number((templateData as any).teeTimeIntervalMinutes))
      : DEFAULT_TEE_TIME_INTERVAL_MINUTES,
  }
}

function toEditForm(tournament: Tournament): TournamentInput {
  return {
    name: tournament.name || '',
    description: tournament.description || '',
    startDate: tournament.startDate ? String(tournament.startDate).slice(0, 10) : '',
    endDate: null,
    status: tournament.status || 'draft',
    isPublic: tournament.status === 'published',
    templateKey: tournament.templateKey || 'classic-flyer',
    templateBackgroundImageUrl: tournament.templateBackgroundImageUrl || null,
    templateData: toEditableTemplateData(tournament),
    teamSlotLimit: readTeamSlotLimit(tournament.teamSlotLimit),
  }
}

export default function OrganizerTournaments() {
  const [summary, setSummary] = useState<OrganizerPortalSummary | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<TournamentInput | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showArchivedTournaments, setShowArchivedTournaments] = useState(false)
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null)
  const [tournamentPage, setTournamentPage] = useState(1)
  const location = useLocation()

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const portalSummary = await fetchOrganizerPortal()
        if (!active) return
        setSummary(portalSummary)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load invited tournaments.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])


  useEffect(() => {
    const cancelledTournaments = (summary?.tournaments || []).filter((tournament) => tournament.status === 'cancelled' && !tournament.archivedAt)
    if (!cancelledTournaments.length) return
    logFrontendEvent({
      category: 'tournaments.organizer',
      message: 'cancelled_tournament_deletion_notice_shown',
      data: { count: cancelledTournaments.length, tournamentIds: cancelledTournaments.map((tournament) => tournament.id) },
    })
  }, [summary?.tournaments])

  const tournaments = useMemo(() => [...(summary?.tournaments || [])].sort((a, b) => {
    const activityA = Date.parse(String(a.activityAt || a.updatedAt || a.createdAt || a.startDate || '')) || 0
    const activityB = Date.parse(String(b.activityAt || b.updatedAt || b.createdAt || b.startDate || '')) || 0
    return activityB - activityA
  }), [summary?.tournaments])
  const activeTournaments = useMemo(() => tournaments.filter((tournament) => !tournament.archivedAt), [tournaments])
  const archivedTournaments = useMemo(() => tournaments.filter((tournament) => Boolean(tournament.archivedAt)), [tournaments])
  const statusCounts = useMemo(() => activeTournaments.reduce<Record<string, number>>((counts, item) => {
    const status = String(item.status || 'draft').toLowerCase()
    counts[status] = (counts[status] || 0) + 1
    return counts
  }, {}), [activeTournaments])
  const statusSummary = useMemo(() => {
    const statuses = ['draft', 'published', 'completed', 'cancelled']
    return statuses.map((status) => `${status}: ${statusCounts[status] || 0}`).join(' · ')
  }, [statusCounts])
  const selectedTournaments = showArchivedTournaments ? archivedTournaments : activeTournaments
  const totalTournamentPages = Math.max(1, Math.ceil(selectedTournaments.length / TOURNAMENTS_PER_PAGE))
  const safeTournamentPage = Math.min(tournamentPage, totalTournamentPages)
  const pagedTournaments = selectedTournaments.slice((safeTournamentPage - 1) * TOURNAMENTS_PER_PAGE, safeTournamentPage * TOURNAMENTS_PER_PAGE)
  const visibleTournaments = editingId ? selectedTournaments.filter((tournament) => tournament.id === editingId) : pagedTournaments

  useEffect(() => {
    if (tournamentPage > totalTournamentPages) setTournamentPage(totalTournamentPages)
  }, [tournamentPage, totalTournamentPages])

  useEffect(() => {
    if (!summary || editingId) return
    const requestedTournament = new URLSearchParams(location.search).get('tournament')
    if (!requestedTournament) return
    const invitedTournament = summary.tournaments.find((item) => item.id === requestedTournament || item.tournamentIdentifier === requestedTournament)
    if (invitedTournament?.archivedAt) setShowArchivedTournaments(true)
    else if (invitedTournament) startEditing(invitedTournament)
  }, [summary, location.search, editingId])

  function startEditing(tournament: Tournament) {
    setEditingId(tournament.id)
    setForm(toEditForm(tournament))
    setError(null)
    setSuccess(null)
    logFrontendEvent({
      category: 'tournaments.organizer',
      message: 'tournament_edit_started',
      data: {
        tournamentId: tournament.id,
        inviteId: tournament.inviteId || null,
        otherTournamentCountHidden: Math.max(activeTournaments.length - 1, 0),
        defaultLocationApplied: Boolean(String((toEditableTemplateData(tournament) as any).locationAddress || '').trim()),
        defaultHostOrganizationApplied: Boolean(String((toEditableTemplateData(tournament) as any).hostOrganization || '').trim()),
        defaultCheckInTime: DEFAULT_TOURNAMENT_CHECK_IN_TIME,
        defaultTeeTime: DEFAULT_TOURNAMENT_TEE_TIME,
      },
    })
  }


  async function onArchiveTournament(tournament: Tournament) {
    setArchiveBusyId(tournament.id)
    setError(null)
    setSuccess(null)
    try {
      const archived = await archiveOrganizerTournamentRecord(tournament.id)
      setSummary((previous) => previous ? { ...previous, tournaments: previous.tournaments.map((item) => item.id === archived.id ? { ...item, ...archived } : item) } : previous)
      setSuccess(`${tournament.name} was archived.`)
      logFrontendEvent({ category: 'tournaments.organizer', message: 'tournament_archived', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The tournament could not be archived. Try again.'
      setError(message)
      logFrontendEvent({ category: 'tournaments.organizer', level: 'error', message: 'tournament_archive_failed', data: { tournamentId: tournament.id, error: message } })
    } finally {
      setArchiveBusyId(null)
    }
  }

  async function onRestoreTournament(tournament: Tournament) {
    setArchiveBusyId(tournament.id)
    setError(null)
    setSuccess(null)
    try {
      const restored = await restoreOrganizerTournamentRecord(tournament.id)
      setSummary((previous) => previous ? { ...previous, tournaments: previous.tournaments.map((item) => item.id === restored.id ? { ...item, ...restored } : item) } : previous)
      setSuccess(`${tournament.name} was restored to active tournaments.`)
      logFrontendEvent({ category: 'tournaments.organizer', message: 'tournament_restored', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null, status: restored.status } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The tournament could not be restored. Try again.'
      setError(message)
      logFrontendEvent({ category: 'tournaments.organizer', level: 'error', message: 'tournament_restore_failed', data: { tournamentId: tournament.id, error: message } })
    } finally {
      setArchiveBusyId(null)
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!editingId || !form) return
    const validationMessage = validateTournamentForSave(form)
    if (validationMessage) {
      setError(validationMessage)
      logFrontendEvent({ category: 'tournaments.organizer', level: 'warn', message: 'tournament_update_validation_failed', data: { tournamentId: editingId, validationMessage } })
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const saved = await updateOrganizerTournamentRecord(editingId, { ...form, endDate: null })
      setSummary((prev) => prev ? { ...prev, tournaments: prev.tournaments.map((item) => item.id === saved.id ? { ...item, ...saved } : item) } : prev)
      setEditingId(null)
      setForm(null)
      logFrontendEvent({ category: 'tournaments.organizer', message: 'tournament_updated', data: { tournamentId: saved.id, status: saved.status, templateKey: saved.templateKey || form.templateKey || 'classic-flyer', teamSlotLimit: saved.teamSlotLimit, registeredTeamCount: saved.registeredTeamCount, openTeamSlotCount: saved.openTeamSlotCount, tournamentSummaryPresent: Boolean(String((form.templateData as any)?.tournamentSummary || '').trim()), tournamentSummaryLength: String((form.templateData as any)?.tournamentSummary || '').length } })
    } catch (err) {
      const message = getFriendlyTournamentError(err, 'save')
      setError(message)
      logFrontendEvent({ category: 'tournaments.organizer', level: 'error', message: 'tournament_update_failed', data: { tournamentId: editingId, error: message } })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="container"><div className="card">Loading invited tournaments…</div></div>

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          title="Manage invited tournaments"
          subtitle={`Tournament status counts — ${statusSummary}`}
        />
        {error ? <div className="small" style={{ color: '#b91c1c', marginBottom: 16 }}>{error}</div> : null}
        {success ? <div className="small" style={{ color: '#166534', marginBottom: 16 }}>{success}</div> : null}

        <div className="formStack">
          {tournaments.length === 0 ? <div className="small">No host tournament invitations were found for this organizer account.</div> : null}
          {tournaments.length ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <strong>{showArchivedTournaments ? 'Archived invited tournaments' : 'Invited tournaments'}</strong>
                {showArchivedTournaments ? <div className="small">Archived tournaments remain stored and can be restored to the active list.</div> : null}
              </div>
              {!editingId ? (
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    const next = !showArchivedTournaments
                    setShowArchivedTournaments(next)
                    setTournamentPage(1)
                    setError(null)
                    setSuccess(null)
                    logFrontendEvent({ category: 'tournaments.organizer', message: next ? 'archived_tournaments_view_opened' : 'active_tournaments_view_opened', data: { archivedCount: archivedTournaments.length, activeCount: activeTournaments.length } })
                  }}
                >
                  {showArchivedTournaments ? `View active tournaments (${activeTournaments.length})` : `View archived tournaments (${archivedTournaments.length})`}
                </button>
              ) : null}
            </div>
          ) : null}
          {tournaments.length && visibleTournaments.length === 0 ? <div className="small">{showArchivedTournaments ? 'No archived tournaments.' : 'No active invited tournaments.'}</div> : null}
          {visibleTournaments.map((tournament) => (
            <div className={editingId === tournament.id ? 'card' : undefined} key={tournament.id} style={editingId === tournament.id ? { padding: 16 } : undefined}>
              {editingId === tournament.id && form ? (
                <form onSubmit={onSubmit} className="formStack">
                  <RegisteredGolfers tournament={tournament} />
                  <div>
                    <label className="label">Status</label>
                    <select className="input" value={form.status || 'draft'} onChange={(e) => setForm((prev) => prev ? ({ ...prev, status: e.target.value }) : prev)}>
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                  {form.status === 'cancelled' ? <div className="small" style={{ color: '#b91c1c', fontWeight: 700 }}>This tournament is scheduled to be deleted because it is cancelled</div> : null}
                  <div>
                    <label className="label">Tournament name</label>
                    <input className="input" value={form.name} onChange={(e) => setForm((prev) => prev ? ({ ...prev, name: e.target.value }) : prev)} />
                  </div>
                  <div>
                    <label className="label">Description</label>
                    <textarea className="input" rows={4} value={form.description || ''} onChange={(e) => setForm((prev) => prev ? ({ ...prev, description: e.target.value }) : prev)} />
                  </div>
                  <div className="formRow formRow--split">
                    <div>
                      <label className="label">Tournament date</label>
                      <input className="input" type="date" value={form.startDate || ''} onChange={(e) => setForm((prev) => prev ? ({ ...prev, startDate: e.target.value, endDate: null }) : prev)} />
                    </div>
                  </div>
                  <TournamentRegistrationDeadlineField value={form} onChange={(next) => setForm((prev) => prev ? ({ ...prev, ...next }) : prev)} />
                  <div>
                    <label className="label">Number of teams to play in the tournament</label>
                    <input className="input" type="number" min={1} step={1} value={form.teamSlotLimit ?? DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT} onChange={(e) => setForm((prev) => prev ? ({ ...prev, teamSlotLimit: readTeamSlotLimit(Number(e.target.value)) }) : prev)} />
                  </div>
                  <TournamentTemplateFields value={form} hideRegistrationDeadline onChange={(next) => setForm((prev) => prev ? ({ ...prev, ...next }) : prev)} />
                  <TournamentStartScheduleManager
                    tournamentId={tournament.id}
                    actor="organizer"
                    registrations={tournament.registrations || []}
                    assignments={tournament.startAssignments || []}
                    startType={String((form.templateData as any)?.startType || 'shotgun')}
                    firstStartTime={String((form.templateData as any)?.teeTime || DEFAULT_TOURNAMENT_TEE_TIME)}
                    intervalMinutes={Number((form.templateData as any)?.teeTimeIntervalMinutes || DEFAULT_TEE_TIME_INTERVAL_MINUTES)}
                    onAssignmentsChange={(startAssignments) => setSummary((previous) => previous ? {
                      ...previous,
                      tournaments: previous.tournaments.map((item) => item.id === tournament.id ? { ...item, startAssignments } : item),
                    } : previous)}
                  />
                  <TournamentSummaryField value={form} onChange={(next) => setForm((prev) => prev ? ({ ...prev, ...next }) : prev)} />
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button className="btn btnPrimary" disabled={saving}>{saving ? 'Saving…' : 'Save tournament changes'}</button>
                    <button type="button" className="btn" onClick={() => {
                      logFrontendEvent({ category: 'tournaments.organizer', message: 'tournament_edit_cancelled', data: { tournamentId: editingId } })
                      setEditingId(null)
                      setForm(null)
                      setError(null)
                    }}>Cancel</button>
                  </div>
                </form>
              ) : (
                <TournamentManagementLineItem
                  tournament={tournament}
                  archived={showArchivedTournaments}
                  busy={archiveBusyId === tournament.id}
                  onSelect={showArchivedTournaments ? undefined : startEditing}
                  onArchive={onArchiveTournament}
                  onRestore={onRestoreTournament}
                />
              )}
            </div>
          ))}
          {!editingId ? (
            <TournamentManagementPagination
              currentPage={safeTournamentPage}
              totalPages={totalTournamentPages}
              totalItems={selectedTournaments.length}
              onPageChange={(page) => {
                setTournamentPage(page)
                logFrontendEvent({ category: 'tournaments.organizer', message: 'tournament_page_selected', data: { archived: showArchivedTournaments, page, totalPages: totalTournamentPages } })
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
