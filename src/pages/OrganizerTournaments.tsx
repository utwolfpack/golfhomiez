import { FormEvent, useEffect, useMemo, useState } from 'react'
import PageHero from '../components/PageHero'
import { createTournamentRecord, fetchGolfCourses, fetchTournaments, type HostAccount, type Tournament, type TournamentInput } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'

const EMPTY_FORM: TournamentInput = {
  name: '',
  description: '',
  startDate: '',
  endDate: '',
  hostAccountId: '',
  status: 'draft',
  isPublic: false,
}

export default function OrganizerTournaments() {
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [hosts, setHosts] = useState<HostAccount[]>([])
  const [form, setForm] = useState<TournamentInput>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const [tournamentResults, hostResults] = await Promise.all([
          fetchTournaments(),
          fetchGolfCourses().catch(() => []),
        ])
        if (!active) return
        setTournaments(tournamentResults)
        setHosts(hostResults)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load tournament workspace.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  const publishedCount = useMemo(() => tournaments.filter((item) => item.status === 'published').length, [tournaments])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const saved = await createTournamentRecord(form)
      setTournaments((prev) => [saved, ...prev])
      setForm(EMPTY_FORM)
      logFrontendEvent({ category: 'tournaments.organizer', message: 'tournament_created', data: { name: saved.name, status: saved.status, hostAccountId: saved.hostAccountId || null } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create tournament.'
      setError(message)
      logFrontendEvent({ category: 'tournaments.organizer', level: 'error', message: 'tournament_create_failed', data: { error: message } })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="container"><div className="card">Loading tournaments…</div></div>

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow="Tournament workspace"
          title="Manage organizer tournaments"
          subtitle={`Track private drafts and public tournaments in one place. ${publishedCount} published.`}
        />

        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 720, marginBottom: 24 }}>
          <div>
            <label className="label">Tournament name</label>
            <input className="input" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input" rows={4} value={form.description || ''} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
          </div>
          <div className="formRow formRow--split">
            <div>
              <label className="label">Start date</label>
              <input className="input" type="date" value={form.startDate} onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))} />
            </div>
            <div>
              <label className="label">End date</label>
              <input className="input" type="date" value={form.endDate || ''} onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))} />
            </div>
          </div>
          <div className="formRow formRow--split">
            <div>
              <label className="label">Host golf course</label>
              <select className="input" value={form.hostAccountId || ''} onChange={(e) => setForm((prev) => ({ ...prev, hostAccountId: e.target.value }))}>
                <option value="">Choose a host account</option>
                {hosts.map((host) => <option key={host.id} value={host.id}>{host.golfCourseName}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status || 'draft'} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
          <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={Boolean(form.isPublic)} onChange={(e) => setForm((prev) => ({ ...prev, isPublic: e.target.checked }))} />
            Make this tournament publicly visible
          </label>

          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          <div><button className="btn btnPrimary" disabled={saving}>{saving ? 'Creating…' : 'Create tournament'}</button></div>
        </form>

        <div className="formStack">
          {tournaments.length === 0 ? <div className="small">No tournaments yet.</div> : tournaments.map((tournament) => (
            <div className="card" key={tournament.id} style={{ padding: 16 }}>
              <div style={{ fontWeight: 700 }}>{tournament.name}</div>
              <div className="small">{tournament.startDate}{tournament.endDate ? ` to ${tournament.endDate}` : ''} · {tournament.status}</div>
              <div className="small">Organizer: {tournament.organizerName || 'Unknown'}{tournament.hostGolfCourseName ? ` · Host: ${tournament.hostGolfCourseName}` : ''}</div>
              {tournament.description ? <div className="small">{tournament.description}</div> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
