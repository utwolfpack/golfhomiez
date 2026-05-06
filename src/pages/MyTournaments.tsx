import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { fetchUserTournaments, type UserRegisteredTournament } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'

function formatDateTime(value?: string | null) {
  if (!value) return 'Not set'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatDate(value?: string | null) {
  if (!value) return 'Not set'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

export default function MyTournaments() {
  const [tournaments, setTournaments] = useState<UserRegisteredTournament[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const result = await fetchUserTournaments()
        if (!active) return
        setTournaments(result.tournaments || [])
        logFrontendEvent({ category: 'user.tournaments', message: 'registered_tournaments_loaded', data: { tournamentCount: result.tournaments?.length || 0 } })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load your registered tournaments.'
        if (active) setError(message)
        logFrontendEvent({ category: 'user.tournaments', level: 'error', message: 'registered_tournaments_load_failed', data: { error: message } })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="My tournaments" title="Registered tournaments" subtitle="Tournament details for events you have registered to play." />
        {loading ? <div className="card">Loading your tournaments…</div> : null}
        {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
        {!loading && !error && tournaments.length === 0 ? (
          <div className="card" style={{ padding: 16 }}>
            <strong>No tournament registrations yet.</strong>
            <p className="small">Published tournament registrations will appear here after you register.</p>
          </div>
        ) : null}
        <div className="formStack">
          {tournaments.map((tournament) => (
            <Link key={`${tournament.id}-${tournament.registration.id}`} className="card cardClickable" style={{ padding: 16, textDecoration: 'none', color: 'inherit' }} to={tournament.portalPath || `/tournaments/${encodeURIComponent(tournament.tournamentIdentifier || tournament.id)}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: 0 }}>{tournament.name}</h3>
                  <p className="small" style={{ margin: '4px 0 0' }}>{tournament.description || 'No description provided.'}</p>
                </div>
                <span className="small" style={{ textTransform: 'uppercase', fontWeight: 700 }}>{tournament.status}</span>
              </div>
              <div className="small" style={{ marginTop: 12 }}><strong>Dates:</strong> {formatDate(tournament.startDate)}{tournament.endDate ? ` to ${formatDate(tournament.endDate)}` : ''}</div>
              <div className="small"><strong>Host:</strong> {tournament.hostGolfCourseName || 'Host to be announced'}</div>
              <div className="small"><strong>Organizer:</strong> {tournament.organizerName || 'Golf Homiez organizer'}</div>
              <div className="small"><strong>Registered golfers:</strong> {tournament.registrationCount ?? 0}</div>
              <div className="small"><strong>Your registration:</strong> {formatDateTime(tournament.registration.registeredAt)}</div>
              {tournament.portalUrl ? <div className="small"><strong>Tournament URL:</strong> {tournament.portalUrl}</div> : null}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
