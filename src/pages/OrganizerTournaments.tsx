import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import PageHero from '../components/PageHero'
import { fetchOrganizerPortal, updateOrganizerTournamentRecord, type OrganizerPortalSummary, type Tournament, type TournamentInput } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { formatFriendlyDateTime } from '../lib/time-format'
import TournamentTemplateFields, { TournamentRegistrationDeadlineField } from '../components/TournamentTemplateFields'

const DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT = 24

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
  const templateData = { ...(tournament.templateData || {}) }
  const locationAddress = String((templateData as any).locationAddress || '').trim()
  if (!locationAddress) {
    templateData.locationAddress = tournament.hostGolfCourseAddress || tournament.hostGolfCourseName || ''
  }
  return templateData
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
    const cancelledTournaments = (summary?.tournaments || []).filter((tournament) => tournament.status === 'cancelled')
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
  const statusCounts = useMemo(() => tournaments.reduce<Record<string, number>>((counts, item) => {
    const status = String(item.status || 'draft').toLowerCase()
    counts[status] = (counts[status] || 0) + 1
    return counts
  }, {}), [tournaments])
  const statusSummary = useMemo(() => {
    const statuses = ['draft', 'published', 'completed', 'cancelled']
    return statuses.map((status) => `${status}: ${statusCounts[status] || 0}`).join(' · ')
  }, [statusCounts])

  useEffect(() => {
    if (!summary || editingId) return
    const requestedTournament = new URLSearchParams(location.search).get('tournament')
    if (!requestedTournament) return
    const invitedTournament = summary.tournaments.find((item) => item.id === requestedTournament || item.tournamentIdentifier === requestedTournament)
    if (invitedTournament) startEditing(invitedTournament)
  }, [summary, location.search, editingId])

  function startEditing(tournament: Tournament) {
    setEditingId(tournament.id)
    setForm(toEditForm(tournament))
    setError(null)
    setSuccess(null)
    logFrontendEvent({ category: 'tournaments.organizer', message: 'tournament_edit_started', data: { tournamentId: tournament.id, inviteId: tournament.inviteId || null } })
  }


  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!editingId || !form) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const saved = await updateOrganizerTournamentRecord(editingId, { ...form, endDate: null })
      setSummary((prev) => prev ? { ...prev, tournaments: prev.tournaments.map((item) => item.id === saved.id ? { ...item, ...saved } : item) } : prev)
      setEditingId(null)
      setForm(null)
      logFrontendEvent({ category: 'tournaments.organizer', message: 'tournament_updated', data: { tournamentId: saved.id, status: saved.status, teamSlotLimit: saved.teamSlotLimit, registeredTeamCount: saved.registeredTeamCount, openTeamSlotCount: saved.openTeamSlotCount } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update tournament.'
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <Link className="btn" to="/organizer/portal/profile">Update organizer profile</Link>
        </div>

        {error ? <div className="small" style={{ color: '#b91c1c', marginBottom: 16 }}>{error}</div> : null}
        {success ? <div className="small" style={{ color: '#166534', marginBottom: 16 }}>{success}</div> : null}

        <div className="formStack">
          {tournaments.length === 0 ? <div className="small">No host tournament invitations were found for this organizer account.</div> : tournaments.map((tournament) => (
            <div className="card" key={tournament.id} style={{ padding: 16 }}>
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
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button className="btn btnPrimary" disabled={saving}>{saving ? 'Saving…' : 'Save tournament changes'}</button>
                    <button type="button" className="btn" onClick={() => { setEditingId(null); setForm(null); setError(null) }}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <div style={{ fontWeight: 700 }}>{tournament.name}</div>
                  <div className="small">{tournament.startDate ? formatFriendlyDateTime(tournament.startDate) : 'No tournament date'} · {tournament.status}</div>
                  {tournament.status === 'cancelled' ? <div className="small" style={{ color: '#b91c1c', fontWeight: 700 }}>This tournament is scheduled to be deleted because it is cancelled</div> : null}
                  <div className="small">Host: {tournament.hostGolfCourseName || 'Host golf course'}{tournament.inviteStatus ? ` · Invite: ${tournament.inviteStatus}` : ''}</div>
                  <TournamentCapacitySummary tournament={tournament} />
                  {tournament.status === 'published' && (tournament.registrationUrl || tournament.portalUrl) ? <div className="small">Golfer registration URL: <a href={tournament.registrationUrl || tournament.portalUrl || undefined}>{tournament.registrationUrl || tournament.portalUrl}</a></div> : null}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                    <button type="button" className="btn btnPrimary" onClick={() => startEditing(tournament)}>Modify tournament</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
