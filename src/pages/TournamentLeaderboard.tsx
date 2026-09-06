import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { fetchTournamentLiveLeaderboard, type TournamentLiveLeaderboardResponse } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { formatFriendlyDate } from '../lib/time-format'
import golfHomiezEmblem from '../assets/GolfHomiezEmblem.png'

const LIVE_LEADERBOARD_REFRESH_MS = 30_000

function displayText(value: unknown, fallback = 'To be announced') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function displayThru(value?: number | null) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? String(Number(value)) : '—'
}

function displayTotal(value?: number | null) {
  return value != null && Number.isFinite(Number(value)) ? String(Number(value)) : '—'
}

function displayRoundScore(value?: string | null) {
  const score = String(value || '').trim()
  return score === 'E' ? 'Par' : score || '—'
}

export default function TournamentLeaderboard() {
  const { id = '' } = useParams()
  const [data, setData] = useState<TournamentLiveLeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadLeaderboard = useCallback(async (reason: 'initial' | 'interval' | 'visible' = 'interval') => {
    if (!id) return
    if (reason === 'initial') setLoading(true)
    else setRefreshing(true)
    setError(null)
    logFrontendEvent({ category: 'tournament.leaderboard', message: 'live_leaderboard_refresh_started', data: { tournamentId: id, reason } })
    try {
      const next = await fetchTournamentLiveLeaderboard(id)
      setData(next)
      logFrontendEvent({
        category: 'tournament.leaderboard',
        message: 'live_leaderboard_refresh_succeeded',
        data: { tournamentId: id, reason, teamCount: next.leaderboard?.length || 0, refreshIntervalSeconds: next.refreshIntervalSeconds || 30, holeByHoleIncluded: next.holeByHoleIncluded },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load the tournament leaderboard.'
      setError(message)
      logFrontendEvent({ category: 'tournament.leaderboard', level: 'error', message: 'live_leaderboard_refresh_failed', data: { tournamentId: id, reason, error: message } })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [id])

  useEffect(() => {
    logFrontendEvent({ category: 'tournament.leaderboard', message: 'live_leaderboard_view_opened', data: { tournamentId: id, refreshIntervalMs: LIVE_LEADERBOARD_REFRESH_MS } })
    void loadLeaderboard('initial')
    const interval = window.setInterval(() => void loadLeaderboard('interval'), LIVE_LEADERBOARD_REFRESH_MS)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadLeaderboard('visible')
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      logFrontendEvent({ category: 'tournament.leaderboard', message: 'live_leaderboard_view_closed', data: { tournamentId: id } })
    }
  }, [id, loadLeaderboard])

  const tournament = data?.tournament
  const templateData = useMemo(() => (tournament?.templateData && typeof tournament.templateData === 'object' ? tournament.templateData as Record<string, unknown> : {}), [tournament?.templateData])
  const tournamentFormat = displayText(templateData.tournamentFormat || templateData.format, 'Format to be announced')
  const startType = displayText(templateData.startType, '')
  const startTime = displayText(templateData.teeTime || templateData.startTime, '')
  const checkInTime = displayText(templateData.checkInTime, '')
  const hostOrganization = displayText(templateData.hostOrganization, '')
  const teamSize = Number(templateData.tournamentTeamSize)
  const location = displayText(templateData.locationAddress || tournament?.hostGolfCourseAddress || tournament?.hostGolfCourseName)

  if (loading && !data) {
    return <div className="container leaderboardPage"><div className="card leaderboardPanel"><div className="small">Loading live leaderboard…</div></div></div>
  }

  if (!data || !tournament) {
    return <div className="container leaderboardPage"><div className="card leaderboardPanel"><h1>Leaderboard unavailable</h1><p className="small">{error || 'This tournament leaderboard is not available.'}</p></div></div>
  }

  return (
    <div className="container leaderboardPage" data-testid="tournament-live-leaderboard">
      <section className="card leaderboardPanel">
        <header className="leaderboardHeader">
          <div>
            <div className="leaderboardEyebrow">Golf Homiez Live Leaderboard</div>
            <h1>{tournament.name}</h1>
            <div className="leaderboardMeta">
              {hostOrganization ? <span><strong>Hosted by:</strong> {hostOrganization}</span> : null}
              <span><strong>Course:</strong> {displayText(tournament.hostGolfCourseName)}</span>
              <span><strong>Date:</strong> {tournament.startDate ? formatFriendlyDate(tournament.startDate) : 'To be announced'}</span>
              <span><strong>Location:</strong> {location}</span>
              <span><strong>Format:</strong> {tournamentFormat}</span>
              {Number.isFinite(teamSize) && teamSize > 0 ? <span><strong>Players / team:</strong> {teamSize}</span> : null}
              {checkInTime ? <span><strong>Check-in:</strong> {checkInTime}</span> : null}
              {startType || startTime ? <span><strong>Start:</strong> {[startType, startTime].filter(Boolean).join(' — ')}</span> : null}
            </div>
          </div>
          <div className="leaderboardRefreshStatus" aria-live="polite">
            <img className="leaderboardBrandIcon" src={golfHomiezEmblem} alt="Golf Homiez" />
            <strong>{refreshing ? 'Refreshing…' : 'Live'}</strong>
            <span>Updates every 30 seconds</span>
            <span>Last updated {new Date(data.refreshedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
          </div>
        </header>

        {error ? <div className="leaderboardWarning" role="alert">Latest refresh failed: {error}. Showing the most recent available scores.</div> : null}

        <div className="leaderboardTableWrap">
          <table className="leaderboardTable">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Team</th>
                <th scope="col">Round Score</th>
                <th scope="col">Thru</th>
                <th scope="col">Total Strokes</th>
              </tr>
            </thead>
            <tbody>
              {data.leaderboard.length ? data.leaderboard.map((row) => (
                <tr key={row.teamKey}>
                  <td className="leaderboardRank">{row.position}</td>
                  <td className="leaderboardTeam">{row.teamName}</td>
                  <td className="leaderboardRoundScore">{displayRoundScore(row.roundLabel)}</td>
                  <td>{displayThru(row.thru)}</td>
                  <td>{displayTotal(row.totalScore)}</td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="leaderboardEmpty">No registered teams are available yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
