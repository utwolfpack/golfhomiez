import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { fetchUserTournaments, type UserRegisteredTournament } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { formatFriendlyDateTime } from '../lib/time-format'

function formatDateTime(value?: string | null) {
  if (!value) return 'Not set'
  return formatFriendlyDateTime(value)
}

function formatDate(value?: string | null) {
  if (!value) return 'Not set'
  return formatFriendlyDateTime(value)
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
        <div className="compactLineItemList tournamentLineItemList">
          {tournaments.map((tournament) => {
            const destination = tournament.portalPath || `/tournaments/${encodeURIComponent(tournament.tournamentIdentifier || tournament.id)}`
            return (
              <Link
                key={`${tournament.id}-${tournament.registration.id}`}
                className="compactLineItem tournamentLineItem"
                to={destination}
                aria-label={`Open ${tournament.name} tournament details`}
                onClick={() => logFrontendEvent({
                  category: 'user.tournaments',
                  message: 'tournament_line_item_selected',
                  data: {
                    tournamentId: tournament.id,
                    registrationId: tournament.registration.id,
                    registrationStatus: tournament.registration.status,
                    destination,
                  },
                })}
              >
                <span className="compactLineItemType">Tournament</span>
                <span className="compactLineItemMain">
                  <strong className="compactLineItemTitle">{tournament.name}</strong>
                  <span className="compactLineItemMeta"><strong>Date:</strong> {formatDate(tournament.startDate)} • <strong>Host:</strong> {tournament.hostGolfCourseName || 'Host to be announced'}</span>
                  <span className="compactLineItemSecondary"><strong>Location:</strong> {(tournament.templateData as any)?.locationAddress || tournament.hostGolfCourseAddress || tournament.hostGolfCourseName || 'Location to be announced'}</span>
                </span>
                <span className="compactLineItemSummary">
                  <strong className="compactLineItemStatus">{tournament.registration.status || 'Registered'}</strong>
                  <span>{formatDateTime(tournament.registration.registeredAt)}</span>
                </span>
                <span className="compactLineItemChevron" aria-hidden="true">›</span>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
