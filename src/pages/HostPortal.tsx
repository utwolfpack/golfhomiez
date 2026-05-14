import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { useHostAuth } from '../context/HostAuthContext'
import { createHostTournament, sendHostTournamentInvite, updateHostTournamentRecord, type Tournament, type TournamentInput } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { formatFriendlyDateTime } from '../lib/time-format'
import TournamentTemplateFields, { TournamentRegistrationDeadlineField } from '../components/TournamentTemplateFields'
import { fetchHostPortal } from '../lib/host-auth'

const DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT = 24

type HostPortalState = {
  account?: {
    golfCourseName: string
    email: string
    isValidated: boolean
  }
  invites?: Array<{ id: string; email: string; golfCourseName: string | null; consumedAt: string | null }>
  tournaments?: Tournament[]
}

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

function tournamentCreatedTimestamp(tournament: Tournament) {
  const parsed = Date.parse(String(tournament.createdAt || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function sortTournamentsByCreatedDescending(tournaments: Tournament[] = []) {
  return [...tournaments].sort((left, right) => tournamentCreatedTimestamp(right) - tournamentCreatedTimestamp(left))
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

const EMPTY_FORM: TournamentInput = {
  name: '',
  description: '',
  status: 'draft',
  isPublic: false,
  organizerEmail: '',
  templateKey: 'classic-flyer',
  templateBackgroundImageUrl: null,
  teamSlotLimit: DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT,
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

export default function HostPortal() {
  const { hostAccount, logoutHost } = useHostAuth()
  const navigate = useNavigate()
  const [portalData, setPortalData] = useState<HostPortalState | null>(null)
  const [form, setForm] = useState<TournamentInput>(EMPTY_FORM)
  const [editForm, setEditForm] = useState<TournamentInput | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sendingInviteId, setSendingInviteId] = useState<string | null>(null)
  const [createTournamentOpen, setCreateTournamentOpen] = useState(false)

  async function loadPortal() {
    const result = await fetchHostPortal()
    if (!result.response.ok) throw new Error((result.data as any)?.message || 'Could not load host portal')
    setPortalData(result.data as HostPortalState)
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        await loadPortal()
      } catch (err: any) {
        if (active) setError(err?.message || 'Could not load host portal')
      } finally {
        if (active) setBusy(false)
      }
    })()
    return () => { active = false }
  }, [])


  useEffect(() => {
    const cancelledTournaments = (portalData?.tournaments || []).filter((tournament) => tournament.status === 'cancelled')
    if (!cancelledTournaments.length) return
    logFrontendEvent({
      category: 'host.portal',
      message: 'cancelled_tournament_deletion_notice_shown',
      data: { count: cancelledTournaments.length, tournamentIds: cancelledTournaments.map((tournament) => tournament.id) },
    })
  }, [portalData?.tournaments])

  function startEditing(tournament: Tournament) {
    setEditingId(tournament.id)
    setEditForm(toEditForm(tournament))
    setError(null)
    setSuccess(null)
    logFrontendEvent({ category: 'host.portal', message: 'host_tournament_edit_started', data: { tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier || null } })
  }

  async function onCreateTournament(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const created = await createHostTournament(form)
      logFrontendEvent({ category: 'host.portal', message: 'host_tournament_created', data: { tournamentId: created.tournament.id, tournamentIdentifier: created.tournament.tournamentIdentifier, teamSlotLimit: created.tournament.teamSlotLimit } })
      if (form.organizerEmail) {
        const invited = await sendHostTournamentInvite(created.tournament.id, { organizerEmail: form.organizerEmail })
        setSuccess(`Tournament created. Organizer invite sent to ${form.organizerEmail}. Link: ${invited.organizerUrl}`)
      } else {
        setSuccess(`Tournament created with identifier ${created.tournament.tournamentIdentifier}.`)
      }
      setForm(EMPTY_FORM)
      setCreateTournamentOpen(false)
      await loadPortal()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create tournament.'
      setError(message)
      logFrontendEvent({ category: 'host.portal', level: 'error', message: 'host_tournament_create_failed', data: { error: message } })
    } finally {
      setSaving(false)
    }
  }

  async function onSaveTournament(event: FormEvent) {
    event.preventDefault()
    if (!editingId || !editForm) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const saved = await updateHostTournamentRecord(editingId, { ...editForm, endDate: null })
      setPortalData((prev) => prev ? { ...prev, tournaments: (prev.tournaments || []).map((item) => item.id === saved.id ? { ...item, ...saved } : item) } : prev)
      setSuccess(saved.status === 'published' && (saved.registrationUrl || saved.portalUrl) ? `Tournament updated. Registration URL: ${saved.registrationUrl || saved.portalUrl}` : 'Tournament updated.')
      setEditingId(null)
      setEditForm(null)
      logFrontendEvent({ category: 'host.portal', message: 'host_tournament_updated', data: { tournamentId: saved.id, status: saved.status, teamSlotLimit: saved.teamSlotLimit, registeredTeamCount: saved.registeredTeamCount, openTeamSlotCount: saved.openTeamSlotCount } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update tournament.'
      setError(message)
      logFrontendEvent({ category: 'host.portal', level: 'error', message: 'host_tournament_update_failed', data: { tournamentId: editingId, error: message } })
    } finally {
      setSaving(false)
    }
  }


  async function onSendInvite(tournamentId: string, organizerEmail: string) {
    if (!organizerEmail) {
      setError('Add an organizer email before sending an invite.')
      return
    }
    setSendingInviteId(tournamentId)
    setError(null)
    setSuccess(null)
    try {
      const result = await sendHostTournamentInvite(tournamentId, { organizerEmail })
      setSuccess(`Organizer invite sent. Registration or login link: ${result.organizerUrl}`)
      await loadPortal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send organizer invite.')
    } finally {
      setSendingInviteId(null)
    }
  }

  const hostedTournaments = sortTournamentsByCreatedDescending(portalData?.tournaments || [])

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Golf-course portal" title={hostAccount ? hostAccount.golfCourseName : 'Host portal'} subtitle="Create tournaments, click a tournament tile to modify it, copy registration URLs after publishing, and invite organizers into their portal." />
        {busy ? <div className="small">Loading host portal…</div> : null}
        {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
        {success ? <div className="small" style={{ color: '#166534' }}>{success}</div> : null}

        {portalData?.account ? (
          <div className="formStack" style={{ maxWidth: 760 }}>
            <div className="card" style={{ padding: 16 }}>
              <div><strong>Golf-course:</strong> {portalData.account.golfCourseName}</div>
              <div><strong>Email:</strong> {portalData.account.email}</div>
              <div><strong>Validated:</strong> {portalData.account.isValidated ? 'Yes' : 'No'}</div>
              <div style={{ marginTop: 10 }}><Link className="btn" to="/host/portal/profile">Update host profile</Link></div>
            </div>

            <section className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <strong>Create tournament</strong>
                  <div className="small">The create tournament panel starts minimized when you enter the host portal.</div>
                </div>
                <button
                  className="btn btnPrimary"
                  type="button"
                  aria-expanded={createTournamentOpen}
                  aria-controls="host-create-tournament-panel"
                  onClick={() => {
                    const nextOpen = !createTournamentOpen
                    setCreateTournamentOpen(nextOpen)
                    logFrontendEvent({ category: 'host.portal', message: nextOpen ? 'host_tournament_create_panel_opened' : 'host_tournament_create_panel_minimized' })
                  }}
                >
                  {createTournamentOpen ? 'Minimize create tournament' : 'Create tournament'}
                </button>
              </div>
              {createTournamentOpen ? (
                <form id="host-create-tournament-panel" onSubmit={onCreateTournament} className="formStack" style={{ marginTop: 16 }}>
                  <div>
                    <label className="label">Tournament name</label>
                    <input className="input" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Spring Member Classic" />
                  </div>
                  <div>
                    <label className="label">Tournament organizer email</label>
                    <input className="input" type="email" value={form.organizerEmail || ''} onChange={(e) => setForm((prev) => ({ ...prev, organizerEmail: e.target.value }))} placeholder="organizer@example.com" />
                  </div>
                  <div>
                    <label className="label">Number of teams to play in the tournament</label>
                    <input className="input" type="number" min={1} step={1} value={form.teamSlotLimit ?? DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT} onChange={(e) => setForm((prev) => ({ ...prev, teamSlotLimit: readTeamSlotLimit(Number(e.target.value)) }))} />
                  </div>
                  <TournamentTemplateFields value={form} onChange={(next) => setForm((prev) => ({ ...prev, ...next }))} />
                  <div>
                    <button className="btn btnPrimary" disabled={saving}>{saving ? 'Creating…' : 'Create tournament'}</button>
                  </div>
                </form>
              ) : null}
            </section>

            <div>
              <strong>Tournaments hosted here</strong>
              <div className="small">Click a tile to modify the tournament. Published tournaments show a golfer registration URL.</div>
              <div className="formStack" style={{ marginTop: 12 }}>
                {hostedTournaments.length === 0 ? <div className="small">No tournaments created yet.</div> : hostedTournaments.map((tournament) => (
                  <div key={tournament.id} className="card" role="button" tabIndex={0} onClick={() => editingId === tournament.id ? undefined : startEditing(tournament)} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && editingId !== tournament.id) startEditing(tournament) }} style={{ padding: 16, cursor: editingId === tournament.id ? 'default' : 'pointer' }}>
                    {editingId === tournament.id && editForm ? (
                      <form onSubmit={onSaveTournament} className="formStack" onClick={(e) => e.stopPropagation()}>
                        <RegisteredGolfers tournament={tournament} />
                        <div>
                          <label className="label">Status</label>
                          <select className="input" value={editForm.status || 'draft'} onChange={(e) => setEditForm((prev) => prev ? ({ ...prev, status: e.target.value }) : prev)}>
                            <option value="draft">Draft</option>
                            <option value="published">Published</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </div>
                        {editForm.status === 'cancelled' ? <div className="small" style={{ color: '#b91c1c', fontWeight: 700 }}>This tournament is scheduled to be deleted because it is cancelled</div> : null}
                        <div>
                          <label className="label">Tournament name</label>
                          <input className="input" value={editForm.name} onChange={(e) => setEditForm((prev) => prev ? ({ ...prev, name: e.target.value }) : prev)} />
                        </div>
                        <div>
                          <label className="label">Description</label>
                          <textarea className="input" rows={4} value={editForm.description || ''} onChange={(e) => setEditForm((prev) => prev ? ({ ...prev, description: e.target.value }) : prev)} />
                        </div>
                        <div className="formRow formRow--split">
                          <div>
                            <label className="label">Tournament date</label>
                            <input className="input" type="date" value={editForm.startDate || ''} onChange={(e) => setEditForm((prev) => prev ? ({ ...prev, startDate: e.target.value, endDate: null }) : prev)} />
                          </div>
                        </div>
                        <TournamentRegistrationDeadlineField value={editForm} onChange={(next) => setEditForm((prev) => prev ? ({ ...prev, ...next }) : prev)} />
                        <div>
                          <label className="label">Number of teams to play in the tournament</label>
                          <input className="input" type="number" min={1} step={1} value={editForm.teamSlotLimit ?? DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT} onChange={(e) => setEditForm((prev) => prev ? ({ ...prev, teamSlotLimit: readTeamSlotLimit(Number(e.target.value)) }) : prev)} />
                        </div>
                        <TournamentTemplateFields value={editForm} hideRegistrationDeadline onChange={(next) => setEditForm((prev) => prev ? ({ ...prev, ...next }) : prev)} />
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <button className="btn btnPrimary" disabled={saving}>{saving ? 'Saving…' : 'Save tournament changes'}</button>
                          <button type="button" className="btn" onClick={() => { setEditingId(null); setEditForm(null); setError(null) }}>Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div style={{ fontWeight: 700 }}>{tournament.name}</div>
                        <div className="small">Tournament identifier: {tournament.tournamentIdentifier}</div>
                        <div className="small">Organizer email: {tournament.organizerEmail || 'Not invited yet'}</div>
                        <div className="small">Invite status: {tournament.inviteStatus || 'not_sent'} · Status: {tournament.status || 'draft'}</div>
                        {tournament.status === 'cancelled' ? <div className="small" style={{ color: '#b91c1c', fontWeight: 700 }}>This tournament is scheduled to be deleted because it is cancelled</div> : null}
                        <TournamentCapacitySummary tournament={tournament} />
                        {tournament.status === 'published' && (tournament.registrationUrl || tournament.portalUrl) ? <div className="small">Golfer registration URL: <a href={tournament.registrationUrl || tournament.portalUrl || undefined} onClick={(e) => e.stopPropagation()}>{tournament.registrationUrl || tournament.portalUrl}</a></div> : null}
                        {tournament.inviteUrl ? <div className="small">Organizer link: <a href={tournament.inviteUrl} onClick={(e) => e.stopPropagation()}>{tournament.inviteUrl}</a></div> : null}
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                          {tournament.organizerEmail ? <button className="btn" type="button" onClick={(e) => { e.stopPropagation(); void onSendInvite(tournament.id, tournament.organizerEmail || '') }} disabled={sendingInviteId === tournament.id}>{sendingInviteId === tournament.id ? 'Sending…' : 'Resend organizer invite'}</button> : null}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btnPrimary" onClick={() => { void logoutHost().finally(() => navigate('/host/login', { replace: true })) }}>Sign out of host portal</button>
          <Link className="btn" to="/host/request-password-reset">Reset host password</Link>
        </div>
      </div>
    </div>
  )
}
