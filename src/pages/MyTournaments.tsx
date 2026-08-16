import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import PageHero from '../components/PageHero'
import TournamentTeamScoreModal from '../components/TournamentTeamScoreModal'
import { fetchUserTournaments, type UserRegisteredTournament } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { formatFriendlyDateTime } from '../lib/time-format'

function formatDateTime(value?: string | null) {
  if (!value) return 'Not set'
  return formatFriendlyDateTime(value)
}

function formatDate(value?: string | null) {
  if (!value) return 'Not set'
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value)
  if (Number.isNaN(dateOnly.getTime())) return value
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(dateOnly)
}

function cleanLocationPart(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function cityFromAddress(address: string, state: string) {
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return ''
  if (state) {
    const normalizedState = state.toUpperCase()
    const stateIndex = parts.findIndex((part) => {
      const normalizedPart = part.toUpperCase()
      return normalizedPart === normalizedState || normalizedPart.startsWith(`${normalizedState} `)
    })
    if (stateIndex > 0) return parts[stateIndex - 1]
  }
  if (parts.length === 2) return parts[0]
  if (parts.length >= 3) return parts[parts.length - 3]
  return ''
}

function formatTournamentLocation(tournament: UserRegisteredTournament) {
  const templateData = tournament.templateData && typeof tournament.templateData === 'object'
    ? tournament.templateData as Record<string, unknown>
    : null
  const state = cleanLocationPart(tournament.hostGolfCourseState)
  const address = cleanLocationPart(templateData?.locationAddress) || cleanLocationPart(tournament.hostGolfCourseAddress)
  const city = cleanLocationPart(tournament.hostGolfCourseCity) || cityFromAddress(address, state)
  const location = [city, state].filter(Boolean)
  return location.length ? location.join(', ') : 'Location to be announced'
}

function tournamentDisplayStatus(status?: string | null) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'completed') return { label: 'Completed', className: 'tournamentStatusText tournamentStatusText--completed' }
  if (normalized === 'published' || normalized === 'active') return { label: 'Active', className: 'tournamentStatusText tournamentStatusText--active' }
  const label = normalized ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : 'Status unavailable'
  return { label, className: 'tournamentStatusText' }
}

function tournamentTeamScore(tournament: UserRegisteredTournament) {
  if (tournament.teamScore == null) return null
  const score = Number(tournament.teamScore)
  return Number.isFinite(score) ? score : null
}

export default function MyTournaments() {
  const [tournaments, setTournaments] = useState<UserRegisteredTournament[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeScoreTournament, setActiveScoreTournament] = useState<UserRegisteredTournament | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const result = await fetchUserTournaments()
        if (!active) return
        const loadedTournaments = result.tournaments || []
        setTournaments(loadedTournaments)
        logFrontendEvent({
          category: 'user.tournaments',
          message: 'registered_tournaments_loaded',
          data: {
            tournamentCount: loadedTournaments.length,
            activeTournamentCount: loadedTournaments.filter((tournament) => ['published', 'active'].includes(String(tournament.status || '').toLowerCase())).length,
            completedTournamentCount: loadedTournaments.filter((tournament) => String(tournament.status || '').toLowerCase() === 'completed').length,
            tournamentWithTeamScoreCount: loadedTournaments.filter((tournament) => tournamentTeamScore(tournament) != null).length,
          },
        })
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
        <PageHero
          title="My Tournaments"
          actions={(
            <Link
              className="btnPrimary"
              to="/find-tournament"
              onClick={() => logFrontendEvent({ category: 'user.tournaments', message: 'find_tournament_selected', data: { destination: '/find-tournament' } })}
            >
              Find Tournament
            </Link>
          )}
        />

        <section aria-labelledby="registered-tournaments-heading">
          <h2 id="registered-tournaments-heading" style={{ marginTop: 24 }}>My registered tournaments</h2>
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
              const displayStatus = tournamentDisplayStatus(tournament.status)
              const teamScore = tournamentTeamScore(tournament)
              const openTournament = () => logFrontendEvent({
                category: 'user.tournaments',
                message: 'tournament_line_item_selected',
                data: {
                  tournamentId: tournament.id,
                  registrationId: tournament.registration.id,
                  registrationStatus: tournament.registration.status,
                  tournamentStatus: tournament.status,
                  teamScore,
                  destination,
                },
              })
              return (
                <div key={`${tournament.id}-${tournament.registration.id}`} className="compactLineItem tournamentLineItem">
                  <Link className="tournamentLineItemPrimary" to={destination} aria-label={`Open ${tournament.name} tournament details`} onClick={openTournament}>
                    <span className="compactLineItemMain">
                      <strong className="compactLineItemTitle">{tournament.name}</strong>
                      <span className="compactLineItemMeta"><strong>Date:</strong> {formatDate(tournament.startDate)} • <strong>Host:</strong> {tournament.hostGolfCourseName || 'Host to be announced'}</span>
                      <span className="compactLineItemSecondary"><strong>Location:</strong> {formatTournamentLocation(tournament)}</span>
                    </span>
                  </Link>
                  <span className="compactLineItemSummary tournamentLineItemSummary">
                    <span className="tournamentLineItemActionRow">
                      <span className="tournamentStatusLabel">Status: <strong className={displayStatus.className}>{displayStatus.label}</strong></span>
                      <button
                        type="button"
                        className="btn btnSmall tournamentTeamScoreButton"
                        aria-label={teamScore != null ? `Open team score, current score ${teamScore}` : 'Open team score'}
                        onClick={() => {
                          setActiveScoreTournament(tournament)
                          logFrontendEvent({ category: 'user.tournaments', message: 'team_score_button_selected', data: { tournamentId: tournament.id, registrationId: tournament.registration.id, tournamentStatus: tournament.status, teamId: tournament.registration.teamId || null, teamName: tournament.registration.teamName || null, teamScore } })
                        }}
                      >
                        {teamScore != null ? `Team Score: ${teamScore}` : 'Team Score'}
                      </button>
                    </span>
                    <span>{formatDateTime(tournament.registration.registeredAt)}</span>
                  </span>
                  <Link className="compactLineItemChevron tournamentLineItemChevronLink" to={destination} aria-label={`Open ${tournament.name} tournament details`} onClick={openTournament}>›</Link>
                </div>
              )
            })}
          </div>
        </section>
      </div>
      {activeScoreTournament ? (
        <TournamentTeamScoreModal
          tournament={activeScoreTournament}
          onClose={() => setActiveScoreTournament(null)}
          onScoreUpdated={(totalScore) => {
            setTournaments((current) => current.map((tournament) => tournament.id === activeScoreTournament.id ? { ...tournament, teamScore: totalScore } : tournament))
            setActiveScoreTournament((current) => current ? { ...current, teamScore: totalScore } : current)
            logFrontendEvent({ category: 'user.tournaments', message: 'line_item_team_score_updated', data: { tournamentId: activeScoreTournament.id, teamScore: totalScore } })
          }}
        />
      ) : null}
    </div>
  )
}
