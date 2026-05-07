import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { useHostAuth } from '../context/HostAuthContext'
import { createHostTournament, sendHostTournamentInvite, updateHostTournamentRecord, type Tournament, type TournamentInput } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { formatFriendlyDateTime } from '../lib/time-format'
import TournamentTemplateFields from '../components/TournamentTemplateFields'
import { fetchHostPortal } from '../lib/host-auth'

type HostPortalState = {
  account?: {
    golfCourseName: string
    email: string
    isValidated: boolean
  }
  invites?: Array<{ id: string; email: string; golfCourseName: string | null; consumedAt: string | null }>
  tournaments?: Tournament[]
}

const EMPTY_FORM: TournamentInput = {
  name: '',
  description: '',
  status: 'draft',
  isPublic: false,
  organizerEmail: '',
  templateKey: 'classic-flyer',
  templateBackgroundImageUrl: null,
}

function formatRegisteredAt(value?: string | null) {
  if (!value) return 'Unknown time'
  return formatFriendlyDateTime(value)
}

function RegisteredGolfers({ tournament }: { tournament: Tournament }) {
  const registrations = tournament.registrations || []
  return (
    <div className="card" style={{ padding: 12, background: '#f8fafc' }}>
      <div style={{ fontWeight: 700 }}>Registered teams and golfers ({tournament.registrationCount ?? registrations.length})</div>
      {registrations.length === 0 ? (
        <div className="small">No golfers have registered yet.</div>
      ) : (
        <div className="formStack" style={{ marginTop: 8 }}>
          {registrations.map((registration) => (
            <div key={registration.id} className="small">
              <strong>{registration.teamName || registration.name || 'Registered team'}</strong> · {formatRegisteredAt(registration.registeredAt)}
              <div>Registrant: {registration.name || 'Registered golfer'} · {registration.email}</div>
              <div>Members: {(registration.teamMembers || []).map((member) => `${member.name || member.email} <${member.email}>`).join(', ') || 'Team roster unavailable'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
    templateData: tournament.templateData || null,
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
      logFrontendEvent({ category: 'host.portal', message: 'host_tournament_created', data: { tournamentId: created.tournament.id, tournamentIdentifier: created.tournament.tournamentIdentifier } })
      if (form.organizerEmail) {
        const invited = await sendHostTournamentInvite(created.tournament.id, { organizerEmail: form.organizerEmail })
        setSuccess(`Tournament created. Organizer invite sent to ${form.organizerEmail}. Link: ${invited.organizerUrl}`)
      } else {
        setSuccess(`Tournament created with identifier ${created.tournament.tournamentIdentifier}.`)
      }
      setForm(EMPTY_FORM)
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
      logFrontendEvent({ category: 'host.portal', message: 'host_tournament_updated', data: { tournamentId: saved.id, status: saved.status } })
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
            </div>

            <form onSubmit={onCreateTournament} className="formStack">
              <div>
                <label className="label">Tournament name</label>
                <input className="input" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Spring Member Classic" />
              </div>
              <div>
                <label className="label">Tournament organizer email</label>
                <input className="input" type="email" value={form.organizerEmail || ''} onChange={(e) => setForm((prev) => ({ ...prev, organizerEmail: e.target.value }))} placeholder="organizer@example.com" />
              </div>
              <TournamentTemplateFields value={form} onChange={(next) => setForm((prev) => ({ ...prev, ...next }))} />
              <div>
                <button className="btn btnPrimary" disabled={saving}>{saving ? 'Creating…' : 'Create tournament'}</button>
              </div>
            </form>

            <div>
              <strong>Tournaments hosted here</strong>
              <div className="small">Click a tile to modify the tournament. Published tournaments show a golfer registration URL.</div>
              <div className="formStack" style={{ marginTop: 12 }}>
                {(portalData.tournaments || []).length === 0 ? <div className="small">No tournaments created yet.</div> : (portalData.tournaments || []).map((tournament) => (
                  <div key={tournament.id} className="card" role="button" tabIndex={0} onClick={() => editingId === tournament.id ? undefined : startEditing(tournament)} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && editingId !== tournament.id) startEditing(tournament) }} style={{ padding: 16, cursor: editingId === tournament.id ? 'default' : 'pointer' }}>
                    {editingId === tournament.id && editForm ? (
                      <form onSubmit={onSaveTournament} className="formStack" onClick={(e) => e.stopPropagation()}>
                        <RegisteredGolfers tournament={tournament} />
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
                        <div>
                          <label className="label">Status</label>
                          <select className="input" value={editForm.status || 'draft'} onChange={(e) => setEditForm((prev) => prev ? ({ ...prev, status: e.target.value }) : prev)}>
                            <option value="draft">Draft</option>
                            <option value="published">Published</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </div>
                        <TournamentTemplateFields value={editForm} onChange={(next) => setEditForm((prev) => prev ? ({ ...prev, ...next }) : prev)} />
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
                        <div className="small">Registered golfers: {tournament.registrationCount ?? tournament.registrations?.length ?? 0}</div>
                        {tournament.status === 'published' && (tournament.registrationUrl || tournament.portalUrl) ? <div className="small">Golfer registration URL: <a href={tournament.registrationUrl || tournament.portalUrl || undefined} onClick={(e) => e.stopPropagation()}>{tournament.registrationUrl || tournament.portalUrl}</a></div> : null}
                        {tournament.inviteUrl ? <div className="small">Organizer link: <a href={tournament.inviteUrl} onClick={(e) => e.stopPropagation()}>{tournament.inviteUrl}</a></div> : null}
                        {tournament.organizerEmail ? <div style={{ marginTop: 10 }}><button className="btn" type="button" onClick={(e) => { e.stopPropagation(); void onSendInvite(tournament.id, tournament.organizerEmail || '') }} disabled={sendingInviteId === tournament.id}>{sendingInviteId === tournament.id ? 'Sending…' : 'Resend organizer invite'}</button></div> : null}
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
