import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import ProtectedRoute from '../components/ProtectedRoute'
import RoundDetailModal from '../components/RoundDetailModal'
import HandicapBreakdownModal from '../components/HandicapBreakdownModal'
import FilteredGolfProfileSummary from '../components/FilteredGolfProfileSummary'
import { useAuth } from '../context/AuthContext'
import { useGolfCourseStates } from '../hooks/useGolfCourseStates'
import { api } from '../lib/api'
import { fetchTeamChallengeScoreRecords } from '../lib/inbox'
import { logFrontendEvent } from '../lib/frontend-logger'
import { getIncompleteRoundStatus } from '../lib/round-status'
import { sortScoresNewestFirst } from '../lib/roundInsights'
import { calculateHandicapFromScores } from '../lib/handicap'
import type { ScoreEntry, SoloScoreEntry, TeamScoreEntry } from '../types'

function parseScoreHoleSource(value: any) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function readScoreHoles(raw: any, keys: string[]) {
  for (const key of keys) {
    const holes = parseScoreHoleSource(raw?.[key])
    if (holes && holes.length > 0) return holes
  }

  return null
}

function normalizeScoreEntry(raw: any): ScoreEntry {
  const hasTeamFields = Boolean(raw?.team || raw?.opponentTeam || raw?.teamTotal != null || raw?.opponentTotal != null)
  const mode = raw?.roundScore != null && !hasTeamFields ? 'solo' : (raw?.mode === 'solo' ? 'solo' : 'team')
  return {
    ...raw,
    mode,
    holes: readScoreHoles(raw, ['holes', 'holes_json', 'holeScores', 'hole_scores_json']) ?? raw?.holes ?? null,
    opponentHoles: mode === 'team' ? readScoreHoles(raw, ['opponentHoles', 'opponent_holes_json', 'opponent_holes', 'opponentHoleScores', 'opponent_hole_scores_json']) : null,
  } as ScoreEntry
}

function isTeamScore(s: ScoreEntry): s is TeamScoreEntry { return (s as any).mode !== 'solo' }
function isSoloScore(s: ScoreEntry): s is SoloScoreEntry { return (s as any).mode === 'solo' }
function isTeamChallengeScore(s: ScoreEntry): s is TeamScoreEntry { return isTeamScore(s) && (s as any).source === 'team_challenge' }
function scoreMatchesState(score: ScoreEntry, stateFilter: string) {
  if (stateFilter === 'all') return true
  if (isTeamChallengeScore(score)) return true
  return String((score as any).state || '').toUpperCase() === stateFilter
}
function formatTeamScoreValue(round: TeamScoreEntry) {
  const teamTotal = (round as any).teamTotal
  const opponentTotal = (round as any).opponentTotal
  const teamScore = teamTotal === null || teamTotal === undefined ? 'Pending' : teamTotal
  const opponentScore = opponentTotal === null || opponentTotal === undefined ? 'Pending' : opponentTotal
  return `${teamScore}-${opponentScore}`
}
function teamResultLabel(round: TeamScoreEntry) {
  if ((round as any).teamTotal == null || (round as any).opponentTotal == null) return 'Pending'
  if (round.won === true) return 'Win'
  if (round.won === false) return 'Loss'
  return 'Tie'
}
function scoreLineItemClass(round: ScoreEntry) {
  if (round.mode !== 'team') return 'compactLineItem loggedRoundLineItem'
  return `compactLineItem loggedRoundLineItem ${round.won === true ? 'rowWin' : round.won === false ? 'rowLoss' : 'rowTie'}`
}

function ScoreButton({ round, onClick }: { round: ScoreEntry; onClick: () => void }) {
  const incompleteStatus = getIncompleteRoundStatus(round)
  const incompleteBadge = incompleteStatus.incomplete ? <span className="roundIncompleteBadge">Incomplete round • {incompleteStatus.label}</span> : null

  if (round.mode === 'solo') {
    return (
      <button type="button" className={scoreLineItemClass(round)} onClick={onClick} aria-label={`Open ${round.course} solo round details`}>
        <span className="compactLineItemMain">
          <strong className="compactLineItemTitle">{round.course}</strong>
          <span className="compactLineItemMeta">{round.date} • {String((round as any).state || '').toUpperCase()} • Solo Round</span>
          {incompleteBadge}
        </span>
        <span className="compactLineItemSummary">
          <strong className="compactLineItemValue">{round.roundScore}</strong>
          <span>Score</span>
        </span>
        <span className="compactLineItemChevron" aria-hidden="true">›</span>
      </button>
    )
  }

  const result = teamResultLabel(round)
  const rowType = 'Team Challenge'
  return (
    <button type="button" className={scoreLineItemClass(round)} onClick={onClick} aria-label={`Open ${round.team} versus ${round.opponentTeam} Team Challenge details`}>
      <span className="compactLineItemMain">
        <strong className="compactLineItemTitle">{round.course}</strong>
        <span className="compactLineItemMeta">{round.date} • {rowType} • {round.team} vs {round.opponentTeam}</span>
        {incompleteBadge}
      </span>
      <span className="compactLineItemSummary">
        <strong className="compactLineItemValue">{formatTeamScoreValue(round)}</strong>
        <span>{result}</span>
      </span>
      <span className="compactLineItemChevron" aria-hidden="true">›</span>
    </button>
  )
}

export default function MyGolfScoresPage() {
  return (
    <ProtectedRoute>
      <MyGolfScoresInner />
    </ProtectedRoute>
  )
}

function MyGolfScoresInner() {
  const { user } = useAuth()
  const [scores, setScores] = useState<ScoreEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedRound, setSelectedRound] = useState<ScoreEntry | null>(null)
  const [showHandicapModal, setShowHandicapModal] = useState(false)

  const [view, setView] = useState<'all' | 'team' | 'solo'>('all')
  const [stateFilter, setStateFilter] = useState('all')
  const [courseFilter, setCourseFilter] = useState('all')
  const [teamFilter, setTeamFilter] = useState('all')
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(1)
  const { states: apiStateOptions } = useGolfCourseStates()

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [data, challengeData] = await Promise.all([
          api<ScoreEntry[]>('/api/scores'),
          fetchTeamChallengeScoreRecords(),
        ])
        const email = String(user?.email || '').toLowerCase()
        const normalizedSoloScores = data
          .map(normalizeScoreEntry)
          .filter((s) => isSoloScore(s) && String((s as any).createdByEmail || '').toLowerCase() === email)
        const normalizedTeamChallenges = (challengeData.scores || []).map(normalizeScoreEntry).filter(isTeamChallengeScore)
        setScores([...normalizedSoloScores, ...normalizedTeamChallenges])
        logFrontendEvent({ category: 'myGolfScores.teamChallengeScores', message: 'team_challenge_score_records_loaded', data: { count: normalizedTeamChallenges.length } })
      } catch (e: any) {
        setError(e?.message || null)
        setScores([])
      } finally {
        setLoading(false)
      }
    })()
  }, [user?.email])

  const scopedByView = useMemo(() => scores.filter((s) => (view === 'all' ? true : view === 'solo' ? isSoloScore(s) : isTeamChallengeScore(s))), [scores, view])
  const nameByAbbr = useMemo(() => new Map(apiStateOptions.map((s) => [s.abbr, s.name])), [apiStateOptions])
  const stateOptions = useMemo(() => Array.from(new Set(scopedByView.map((s: any) => String(s.state || '').toUpperCase()).filter(Boolean))).sort(), [scopedByView])
  const courseOptions = useMemo(() => Array.from(new Set(scopedByView.filter((s) => scoreMatchesState(s, stateFilter)).map((s) => s.course).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [scopedByView, stateFilter])
  const teamOptions = useMemo(() => Array.from(new Set(scopedByView.filter(isTeamScore).filter((s) => scoreMatchesState(s, stateFilter)).filter((s) => courseFilter === 'all' ? true : s.course === courseFilter).map((s) => s.team).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [scopedByView, stateFilter, courseFilter])

  const filteredScores = useMemo(() => {
    const next = scopedByView.filter((s) => {
      if (!scoreMatchesState(s, stateFilter)) return false
      if (courseFilter !== 'all' && s.course !== courseFilter) return false
      if (teamFilter !== 'all' && (s.mode === 'solo' || s.team !== teamFilter)) return false
      return true
    })
    return sortScoresNewestFirst(next) as ScoreEntry[]
  }, [scopedByView, stateFilter, courseFilter, teamFilter])

  const teamFiltered = useMemo<TeamScoreEntry[]>(() => filteredScores.filter(isTeamScore), [filteredScores])
  const soloFiltered = useMemo<SoloScoreEntry[]>(() => filteredScores.filter(isSoloScore), [filteredScores])

  useEffect(() => {
    setPage(1)
  }, [view, stateFilter, courseFilter, teamFilter])

  const pageSize = 20
  const totalPages = Math.max(1, Math.ceil(filteredScores.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedScores = useMemo<ScoreEntry[]>(() => {
    const start = (currentPage - 1) * pageSize
    return filteredScores.slice(start, start + pageSize)
  }, [filteredScores, currentPage])

  const teamStats = useMemo(() => {
    const total = teamFiltered.length
    const completed = teamFiltered.filter((s) => (s as any).teamTotal != null && (s as any).opponentTotal != null)
    const wins = completed.filter((s) => s.won === true).length
    const losses = completed.filter((s) => s.won === false).length
    const ties = completed.filter((s) => s.won === null).length
    return { total, wins, losses, ties, winPct: completed.length ? (wins / completed.length) * 100 : 0 }
  }, [teamFiltered])

  const soloStats = useMemo(() => {
    const total = soloFiltered.length
    const avg = total ? soloFiltered.reduce((sum, s) => sum + s.roundScore, 0) / total : 0
    const best = total ? Math.min(...soloFiltered.map((s) => s.roundScore)) : 0
    return { total, avg, best }
  }, [soloFiltered])
  const handicapStats = useMemo(() => calculateHandicapFromScores(filteredScores), [filteredScores])

  useEffect(() => {
    logFrontendEvent({
      category: 'myGolfScores.filters',
      message: 'filtered_golf_profile_summary_updated',
      data: {
        view,
        stateFilter,
        courseFilter,
        teamFilter,
        roundCount: filteredScores.length,
        teamRoundCount: teamStats.total,
        soloRoundCount: soloStats.total,
        handicap: handicapStats.handicap,
      },
    })
  }, [view, stateFilter, courseFilter, teamFilter, filteredScores.length, teamStats.total, soloStats.total, handicapStats.handicap])

  function openHandicapDetails() {
    setShowHandicapModal(true)
    logFrontendEvent({
      category: 'myGolfScores.handicap',
      message: 'filtered_profile_handicap_link_selected',
      data: {
        view,
        stateFilter,
        courseFilter,
        teamFilter,
        handicap: handicapStats.handicap,
        ratedRounds: handicapStats.ratedRounds,
      },
    })
  }

  function clearFilters() {
    setStateFilter('all')
    setCourseFilter('all')
    setTeamFilter('all')
    logFrontendEvent({ category: 'myGolfScores.filters', message: 'score_filters_cleared', data: { view } })
  }

  function toggleFilters() {
    setShowFilters((current) => {
      const next = !current
      logFrontendEvent({
        category: 'myGolfScores.filters',
        message: next ? 'score_filters_shown' : 'score_filters_hidden',
        data: { view, stateFilter, courseFilter, teamFilter, filtersVisible: next },
      })
      return next
    })
  }


  function handleRoundUpdated(updatedRound: ScoreEntry) {
    const normalized = normalizeScoreEntry(updatedRound)
    setScores((current) => current.map((score) => score.id === normalized.id ? normalized : score))
    setSelectedRound(normalized)
  }

  function handleRoundDeleted(roundId: string) {
    setScores((current) => current.filter((score) => score.id !== roundId))
    setSelectedRound(null)
  }

  function handleRoundSelected(round: ScoreEntry) {
    setSelectedRound(round)
    logFrontendEvent({
      category: 'myGolfScores.rounds',
      message: 'logged_round_line_item_selected',
      data: {
        roundId: round.id,
        mode: round.mode,
        course: round.course,
        source: (round as any).source || 'scores',
      },
    })
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <div className="myScoresHeader myScoresHeader--actionsOnly">
          <div className="myScoresActions">
            <Link
              className="btn btnLightGreen btnLogRoundCta"
              to="/solo-logger"
              onClick={() => logFrontendEvent({ category: 'myGolfScores.actions', message: 'log_round_clicked' })}
            >
              Log a Round
            </Link>
          </div>
        </div>

        <div className={`scoreFilterToolbar ${showFilters ? '' : 'scoreFilterToolbar--collapsed'}`}>
          {showFilters ? (
            <>
              <div className="scoreViewTabs" role="group" aria-label="Round type filters">
                <button type="button" className={view === 'all' ? 'btnPrimary btnSmall' : 'btn btnSmall'} aria-pressed={view === 'all'} onClick={() => setView('all')}>All Rounds</button>
                <button type="button" className={view === 'team' ? 'btnPrimary btnSmall' : 'btn btnSmall'} aria-pressed={view === 'team'} onClick={() => { setView('team'); setStateFilter('all'); setCourseFilter('all'); setTeamFilter('all') }}>Team Challenges</button>
                <button type="button" className={view === 'solo' ? 'btnPrimary btnSmall' : 'btn btnSmall'} aria-pressed={view === 'solo'} onClick={() => setView('solo')}>Solo Rounds</button>
              </div>

              <div className={`scoreFilterGrid ${view === 'solo' ? 'scoreFilterGrid--solo' : ''}`}>
                <label className="scoreFilterControl scoreFilterControl--state">
                  <span>State</span>
                  <select className="input" value={stateFilter} onChange={e => { setStateFilter(e.target.value); setCourseFilter('all'); setTeamFilter('all') }}>
                    <option value="all">All states</option>
                    {stateOptions.map((state) => <option key={state} value={state}>{nameByAbbr.get(state) || state}</option>)}
                  </select>
                </label>
                <label className="scoreFilterControl scoreFilterControl--course">
                  <span>Course</span>
                  <select className="input" value={courseFilter} onChange={e => { setCourseFilter(e.target.value); setTeamFilter('all') }}>
                    <option value="all">All courses</option>
                    {courseOptions.map((course) => <option key={course} value={course}>{course}</option>)}
                  </select>
                </label>
                {view !== 'solo' ? (
                  <label className="scoreFilterControl scoreFilterControl--team">
                    <span>Team</span>
                    <select className="input" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
                      <option value="all">All teams</option>
                      {teamOptions.map((team) => <option key={team} value={team}>{team}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
            </>
          ) : null}
          <div className="scoreFilterActions">
            <button type="button" className="scoreFiltersClear" onClick={clearFilters}>Clear filters</button>
            <button type="button" className="scoreFiltersToggle" onClick={toggleFilters} aria-expanded={showFilters}>{showFilters ? 'Hide filters' : 'Show filters'}</button>
          </div>
        </div>

        <FilteredGolfProfileSummary
          view={view}
          roundCount={filteredScores.length}
          teamStats={teamStats}
          soloStats={soloStats}
          handicapStats={handicapStats}
          onHandicapClick={openHandicapDetails}
        />

        {loading ? <div className="small" style={{ marginTop: 12 }}>Loading…</div> : null}
        {error ? <div className="small" style={{ marginTop: 12, color: 'crimson' }}>{error}</div> : null}

        <div className="compactLineItemList loggedRoundLineItemList" style={{ marginTop: 14 }}>
          {pagedScores.map((round) => <ScoreButton key={round.id} round={round} onClick={() => handleRoundSelected(round)} />)}
          {!pagedScores.length ? <div className="small">No rounds match the current filters.</div> : null}
        </div>

        {filteredScores.length > pageSize ? (
          <div className="paginationBar">
            <button type="button" className="btn btnSmall" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <div className="small">Page {currentPage} of {totalPages}</div>
            <button type="button" className="btn btnSmall" disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        ) : null}
      </div>

      <RoundDetailModal round={selectedRound} allScores={filteredScores} onClose={() => setSelectedRound(null)} onRoundUpdated={handleRoundUpdated} onRoundDeleted={handleRoundDeleted} />
      <HandicapBreakdownModal open={showHandicapModal} stats={handicapStats} onClose={() => setShowHandicapModal(false)} />
    </div>
  )
}
