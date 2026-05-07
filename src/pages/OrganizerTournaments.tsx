import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { fetchOrganizerPortal, updateOrganizerTournamentRecord, type OrganizerPortalSummary, type Tournament, type TournamentInput } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { formatFriendlyDateTime } from '../lib/time-format'
import TournamentTemplateFields from '../components/TournamentTemplateFields'

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

export default function OrganizerTournaments() {
  const [summary, setSummary] = useState<OrganizerPortalSummary | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<TournamentInput | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
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

  const tournaments = summary?.tournaments || []
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
    logFrontendEvent({ category: 'tournaments.organizer', message: 'tournament_edit_started', data: { tournamentId: tournament.id, inviteId: tournament.inviteId || null } })
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!editingId || !form) return
    setSaving(true)
    setError(null)
    try {
      const saved = await updateOrganizerTournamentRecord(editingId, { ...form, endDate: null })
      setSummary((prev) => prev ? { ...prev, tournaments: prev.tournaments.map((item) => item.id === saved.id ? { ...item, ...saved } : item) } : prev)
      setEditingId(null)
      setForm(null)
      logFrontendEvent({ category: 'tournaments.organizer', message: 'tournament_updated', data: { tournamentId: saved.id, status: saved.status } })
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

        {error ? <div className="small" style={{ color: '#b91c1c', marginBottom: 16 }}>{error}</div> : null}

        <div className="formStack">
          {tournaments.length === 0 ? <div className="small">No host tournament invitations were found for this organizer account.</div> : tournaments.map((tournament) => (
            <div className="card" key={tournament.id} style={{ padding: 16 }}>
              {editingId === tournament.id && form ? (
                <form onSubmit={onSubmit} className="formStack">
                  <RegisteredGolfers tournament={tournament} />
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
                  <div>
                    <label className="label">Status</label>
                    <select className="input" value={form.status || 'draft'} onChange={(e) => setForm((prev) => prev ? ({ ...prev, status: e.target.value }) : prev)}>
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                  <TournamentTemplateFields value={form} onChange={(next) => setForm((prev) => prev ? ({ ...prev, ...next }) : prev)} />
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button className="btn btnPrimary" disabled={saving}>{saving ? 'Saving…' : 'Save tournament changes'}</button>
                    <button type="button" className="btn" onClick={() => { setEditingId(null); setForm(null); setError(null) }}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <div style={{ fontWeight: 700 }}>{tournament.name}</div>
                  <div className="small">{tournament.startDate ? formatFriendlyDateTime(tournament.startDate) : 'No tournament date'} · {tournament.status}</div>
                  <div className="small">Host: {tournament.hostGolfCourseName || 'Host golf course'}{tournament.inviteStatus ? ` · Invite: ${tournament.inviteStatus}` : ''}</div>
                  <div className="small">Registered golfers: {tournament.registrationCount ?? tournament.registrations?.length ?? 0}</div>
                  {tournament.description ? <div className="small">{tournament.description}</div> : null}
                  {tournament.status === 'published' && (tournament.registrationUrl || tournament.portalUrl) ? <div className="small">Golfer registration URL: <a href={tournament.registrationUrl || tournament.portalUrl || undefined}>{tournament.registrationUrl || tournament.portalUrl}</a></div> : null}
                  <div style={{ marginTop: 10 }}><button type="button" className="btn btnPrimary" onClick={() => startEditing(tournament)}>Modify tournament</button></div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
