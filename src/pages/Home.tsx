import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import bannerImg from '../assets/GolfHomiezEmblem.png'
import RoundDetailModal from '../components/RoundDetailModal'
import HandicapBreakdownModal from '../components/HandicapBreakdownModal'
import FilteredGolfProfileSummary from '../components/FilteredGolfProfileSummary'
import { useAuth } from '../context/AuthContext'
import { useGolfCourseStates } from '../hooks/useGolfCourseStates'
import { api } from '../lib/api'
import { GUEST_HOME_EMAIL, GUEST_HOME_SCORES } from '../lib/dashboardSample'
import { jumpToFirstByLetter } from '../lib/selectHotkey'
import { sortScoresNewestFirst } from '../lib/roundInsights'
import { calculateHandicapFromScores } from '../lib/handicap'
import { logFrontendEvent } from '../lib/frontend-logger'
import { getIncompleteRoundStatus } from '../lib/round-status'
import { fetchTeamChallengeScoreRecords } from '../lib/inbox'
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

function isTeamScore(s: ScoreEntry): s is TeamScoreEntry {
  return (s as any).mode !== 'solo'
}

function isSoloScore(s: ScoreEntry): s is SoloScoreEntry {
  return (s as any).mode === 'solo'
}

function isTeamChallengeScore(s: ScoreEntry): s is TeamScoreEntry {
  return isTeamScore(s) && (s as any).source === 'team_challenge'
}

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

function roundLineItemClass(round: ScoreEntry) {
  if (round.mode !== 'team') return 'compactLineItem loggedRoundLineItem homeLoggedRoundLineItem'
  return `compactLineItem loggedRoundLineItem homeLoggedRoundLineItem ${round.won === true ? 'rowWin' : round.won === false ? 'rowLoss' : 'rowTie'}`
}

function RoundRow({ round, onClick }: { round: ScoreEntry; onClick: () => void }) {
  const incompleteStatus = getIncompleteRoundStatus(round)
  const incompleteBadge = incompleteStatus.incomplete ? <span className="roundIncompleteBadge">Incomplete round • {incompleteStatus.label}</span> : null

  if (round.mode === 'solo') {
    return (
      <button type="button" className={roundLineItemClass(round)} onClick={onClick} aria-label={`Open ${round.course} solo round details`}>
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
  const rowType = isTeamChallengeScore(round) ? 'Team Challenge' : 'Team round'
  return (
    <button type="button" className={roundLineItemClass(round)} onClick={onClick} aria-label={`Open ${round.team} versus ${round.opponentTeam} ${rowType} details`}>
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

export default function Home() {
  const { user } = useAuth()
  const [scores, setScores] = useState<ScoreEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedRound, setSelectedRound] = useState<ScoreEntry | null>(null)
  const [showHandicapModal, setShowHandicapModal] = useState(false)

  const [view, setView] = useState<'all' | 'team' | 'solo'>('all')
  const [stateFilter, setStateFilter] = useState('UT')
  const { states: apiStateOptions } = useGolfCourseStates()
  const [courseFilter, setCourseFilter] = useState('all')
  const [teamFilter, setTeamFilter] = useState('all')
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    ;(async () => {
      if (!user) {
        setScores(GUEST_HOME_SCORES)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const [data, challengeData] = await Promise.all([
          api<ScoreEntry[]>('/api/scores'),
          fetchTeamChallengeScoreRecords(),
        ])
        const normalized = [
          ...data.map(normalizeScoreEntry),
          ...(challengeData.scores || []).map(normalizeScoreEntry),
        ]
        setScores(normalized)
        logFrontendEvent({ category: 'home.teamChallengeScores', message: 'team_challenge_score_records_loaded', data: { count: challengeData.scores?.length || 0 } })
      } catch (e: any) {
        setScores([])
        setError(e?.message || null)
      } finally {
        setLoading(false)
      }
    })()
  }, [user])

  const userScores = useMemo(() => {
    const email = String(user?.email || GUEST_HOME_EMAIL).toLowerCase()
    if (!email) return []
    return scores.filter((s) => isTeamChallengeScore(s) || String((s as any).createdByEmail || '').toLowerCase() === email)
  }, [scores, user?.email])

  const scopedScores = useMemo(() => {
    return userScores.filter((s) => (view === 'all' ? true : view === 'solo' ? isSoloScore(s) : isTeamChallengeScore(s)))
  }, [userScores, view])

  const nameByAbbr = useMemo(() => new Map(apiStateOptions.map((s) => [s.abbr, s.name])), [apiStateOptions])
  const stateOptions = useMemo(() => {
    const fromLogs = scopedScores.map((s) => String((s as any).state || '').toUpperCase()).filter(Boolean)
    const unique = Array.from(new Set(fromLogs))
    const list = unique.length ? unique : ['UT']
    return Array.from(new Set(list)).sort((a, b) => {
      if (a === 'UT') return -1
      if (b === 'UT') return 1
      return (nameByAbbr.get(a) || a).localeCompare(nameByAbbr.get(b) || b)
    })
  }, [scopedScores, nameByAbbr])

  useEffect(() => {
    if (stateOptions.length && stateFilter !== 'all' && !stateOptions.includes(stateFilter)) {
      setStateFilter(stateOptions[0])
      setCourseFilter('all')
      setTeamFilter('all')
    }
  }, [stateOptions, stateFilter])

  const courseOptions = useMemo(() => {
    return Array.from(new Set(scopedScores
      .filter((s) => scoreMatchesState(s, stateFilter))
      .map((s) => s.course)
      .filter(Boolean))).sort((a, b) => a.localeCompare(b))
  }, [scopedScores, stateFilter])

  const teamOptions = useMemo(() => {
    return Array.from(new Set(scopedScores
      .filter(isTeamScore)
      .filter((s) => scoreMatchesState(s, stateFilter))
      .filter((s) => courseFilter === 'all' ? true : s.course === courseFilter)
      .map((s) => s.team)
      .filter(Boolean))).sort((a, b) => a.localeCompare(b))
  }, [scopedScores, stateFilter, courseFilter])

  const filteredScores = useMemo(() => {
    return scopedScores.filter((s) => {
      if (!scoreMatchesState(s, stateFilter)) return false
      if (courseFilter !== 'all' && s.course !== courseFilter) return false
      if (view === 'team' && teamFilter !== 'all' && (s as any).team !== teamFilter) return false
      if (view === 'all' && teamFilter !== 'all' && s.mode === 'team' && (s as any).team !== teamFilter) return false
      return true
    })
  }, [scopedScores, view, stateFilter, courseFilter, teamFilter])

  const teamScores = useMemo(() => filteredScores.filter(isTeamScore), [filteredScores])
  const soloScores = useMemo(() => filteredScores.filter(isSoloScore), [filteredScores])
  const recent = useMemo<ScoreEntry[]>(() => sortScoresNewestFirst(filteredScores) as ScoreEntry[], [filteredScores])
  const recentRounds = useMemo<ScoreEntry[]>(() => recent.slice(0, 10), [recent])

  const teamStats = useMemo(() => {
    const total = teamScores.length
    const completed = teamScores.filter((s) => (s as any).teamTotal != null && (s as any).opponentTotal != null)
    const wins = completed.filter((s) => s.won === true).length
    const losses = completed.filter((s) => s.won === false).length
    const ties = completed.filter((s) => s.won === null).length
    return { total, wins, losses, ties, winPct: completed.length ? (wins / completed.length) * 100 : 0 }
  }, [teamScores])

  const soloStats = useMemo(() => {
    const total = soloScores.length
    const avg = total ? soloScores.reduce((sum, s) => sum + s.roundScore, 0) / total : 0
    const best = total ? Math.min(...soloScores.map((s) => s.roundScore)) : 0
    return { total, avg, best }
  }, [soloScores])
  const handicapStats = useMemo(() => calculateHandicapFromScores(filteredScores), [filteredScores])

  useEffect(() => {
    logFrontendEvent({
      category: 'home.filters',
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
      category: 'home.handicap',
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

  const hasActiveScoreFilters = stateFilter !== 'all' || courseFilter !== 'all' || teamFilter !== 'all'

  function clearFilters() {
    setStateFilter('all')
    setCourseFilter('all')
    setTeamFilter('all')
    logFrontendEvent({ category: 'home.filters', message: 'score_filters_cleared', data: { view } })
  }

  function toggleFilters() {
    setShowFilters((current) => {
      const next = !current
      logFrontendEvent({
        category: 'home.filters',
        message: next ? 'score_filters_shown' : 'score_filters_hidden',
        data: { view, stateFilter, courseFilter, teamFilter, filtersVisible: next },
      })
      return next
    })
  }

  function handleRoundSelected(round: ScoreEntry) {
    setSelectedRound(round)
    logFrontendEvent({
      category: 'home.rounds',
      message: 'logged_round_line_item_selected',
      data: {
        roundId: round.id,
        mode: round.mode,
        course: round.course,
        source: (round as any).source || 'scores',
      },
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

  return (
    <div className="container">
      <div className="bannerCard">
        <img src={bannerImg} alt="Golf Homiez emblem" className="bannerImg bannerImg--emblem" onLoad={() => logFrontendEvent({ category: 'home.banner', message: 'app_banner_emblem_loaded' })} onError={() => logFrontendEvent({ category: 'home.banner', level: 'error', message: 'app_banner_emblem_load_failed' })} />
        <div className="bannerOverlay">
          <div className="bannerTitle">Fairways, Friends & Scorecards</div>
          <div className="bannerSubtitle">Track scrambles • Track solo rounds • Keep it fun</div>
        </div>
      </div>

      <div className="card">
        {!user ? <div className="small homeDemoNotice">Showing homepage demo data. <Link to="/login"><strong>Log in</strong></Link> to view and track your own rounds.</div> : null}

        <div className={`scoreFilterToolbar ${showFilters ? '' : 'scoreFilterToolbar--collapsed'}`}>
          {showFilters ? (
            <>
              <div className="scoreViewTabs" role="group" aria-label="Round type filters">
                <button type="button" className={view === 'all' ? 'btnPrimary btnSmall' : 'btn btnSmall'} aria-pressed={view === 'all'} onClick={() => { setView('all'); setTeamFilter('all') }}>All Rounds</button>
                <button type="button" className={view === 'team' ? 'btnPrimary btnSmall' : 'btn btnSmall'} aria-pressed={view === 'team'} onClick={() => { setView('team'); setStateFilter('all'); setCourseFilter('all'); setTeamFilter('all') }}>Team Challenges</button>
                <button type="button" className={view === 'solo' ? 'btnPrimary btnSmall' : 'btn btnSmall'} aria-pressed={view === 'solo'} onClick={() => { setView('solo'); setTeamFilter('all') }}>Solo Rounds</button>
              </div>

              <div className={`scoreFilterGrid ${view === 'solo' ? 'scoreFilterGrid--solo' : ''}`}>
                <label className="scoreFilterControl scoreFilterControl--state">
                  <span>State</span>
                  <select className="input" value={stateFilter} onChange={(e) => { setStateFilter(e.target.value); setCourseFilter('all'); setTeamFilter('all') }} onKeyDown={(e) => jumpToFirstByLetter(e.key, stateOptions.map((value) => ({ value })), (v) => { setStateFilter(v); setCourseFilter('all'); setTeamFilter('all') }, stateFilter)}>
                    {stateOptions.length > 1 || stateFilter === 'all' ? <option value="all">All states</option> : null}
                    {stateOptions.map((abbr) => <option key={abbr} value={abbr}>{nameByAbbr.get(abbr) || abbr}</option>)}
                  </select>
                </label>
                <label className="scoreFilterControl scoreFilterControl--course">
                  <span>Course</span>
                  <select className="input" value={courseFilter} onChange={(e) => { setCourseFilter(e.target.value); setTeamFilter('all') }} onKeyDown={(e) => jumpToFirstByLetter(e.key, courseOptions.map((value) => ({ value })), (v) => { setCourseFilter(v); setTeamFilter('all') }, courseFilter)}>
                    <option value="all">All courses</option>
                    {courseOptions.map((course) => <option key={course} value={course}>{course}</option>)}
                  </select>
                </label>
                {view !== 'solo' ? (
                  <label className="scoreFilterControl scoreFilterControl--team">
                    <span>Team</span>
                    <select className="input" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} onKeyDown={(e) => jumpToFirstByLetter(e.key, teamOptions.map((value) => ({ value })), (v) => setTeamFilter(v), teamFilter)}>
                      <option value="all">All teams</option>
                      {teamOptions.map((teamName) => <option key={teamName} value={teamName}>{teamName}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
            </>
          ) : null}
          <div className="scoreFilterActions">
            {hasActiveScoreFilters ? <button type="button" className="scoreFiltersClear" onClick={clearFilters}>Clear filters</button> : null}
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

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 16, gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Most Recent 10 Logged Events</h3>
          {!user ? <Link className="small" to="/login">Log in to save rounds</Link> : view === 'team' ? <Link className="small" to="/challenges">Open Team Challenges</Link> : view === 'solo' ? <Link className="small" to="/solo-logger">Log a solo round</Link> : <Link className="small" to="/my-golf-scores">View all rounds</Link>}
        </div>

        <div className="roundRowsStack compactLineItemList loggedRoundLineItemList" style={{ marginTop: 12 }}>
          {recentRounds.map((round) => <RoundRow key={round.id} round={round} onClick={() => handleRoundSelected(round)} />)}
          {!recentRounds.length ? <div className="small">No rounds yet for this view and filters.</div> : null}
        </div>
      </div>

      <RoundDetailModal round={selectedRound} allScores={filteredScores} onClose={() => setSelectedRound(null)} onRoundUpdated={handleRoundUpdated} onRoundDeleted={handleRoundDeleted} />
      <HandicapBreakdownModal open={showHandicapModal} stats={handicapStats} onClose={() => setShowHandicapModal(false)} />
    </div>
  )
}
