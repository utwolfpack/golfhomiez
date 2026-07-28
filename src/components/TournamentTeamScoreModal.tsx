import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import HoleByHoleScorecard, { type PendingHoleScoreSaveHandler } from './HoleByHoleScorecard'
import {
  fetchTournamentTeamScore,
  updateTournamentTeamScore,
  type TournamentTeamScoreContext,
  type TournamentTeamScoreTeam,
  type UserRegisteredTournament,
} from '../lib/accounts'
import { buildClientDefaultHoleScorecard, normalizeHoleScorecard } from '../lib/hole-scorecard'
import { logFrontendEvent } from '../lib/frontend-logger'
import { formatFriendlyDate } from '../lib/time-format'
import { normalizeTeeColor } from '../lib/tee-colors'
import type { HoleScoreDetail } from '../types'

type Props = {
  tournament: UserRegisteredTournament
  onClose: () => void
}

type ViewMode = 'scorecard' | 'leaderboard' | 'summary'

type LeaderboardRow = {
  team: TournamentTeamScoreTeam
  position: number
  roundLabel: string
  thru: number | null
  totalLabel: string
  sortRelative: number
  sortTotal: number
}

type SummaryRow = {
  hole: number
  par: number | null
  score: number | null
  relativeLabel: string
  totalLabel: string
}

function providedHoles(holes: HoleScoreDetail[]) {
  return holes.filter((hole) => hole?.scoreProvided === true && Number.isFinite(Number(hole.score)))
}

function relativeLabel(value: number | null) {
  if (value == null) return '—'
  if (value === 0) return 'E'
  return value > 0 ? `+${value}` : String(value)
}

function teamInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'GH'
}

function getLeaderboardRows(teams: TournamentTeamScoreTeam[]): LeaderboardRow[] {
  const rows = teams.map((team) => {
    const entered = providedHoles(team.holes || [])
    const total = team.totalScore != null && Number.isFinite(Number(team.totalScore))
      ? Number(team.totalScore)
      : (entered.length ? entered.reduce((sum, hole) => sum + Number(hole.score || 0), 0) : null)
    const par = entered.reduce((sum, hole) => sum + (Number.isFinite(Number(hole.par)) ? Number(hole.par) : 0), 0)
    const relative = total == null || entered.length === 0 ? null : total - par
    const thru = entered.length ? Math.max(...entered.map((hole) => Number(hole.hole) || 0)) : null
    return {
      team,
      position: 0,
      roundLabel: relativeLabel(relative),
      thru,
      totalLabel: total == null ? '—' : String(total),
      sortRelative: relative == null ? Number.POSITIVE_INFINITY : relative,
      sortTotal: total == null ? Number.POSITIVE_INFINITY : total,
    }
  })

  rows.sort((left, right) => (
    left.sortRelative - right.sortRelative
    || left.sortTotal - right.sortTotal
    || left.team.teamName.localeCompare(right.team.teamName)
  ))
  return rows.map((row, index) => ({ ...row, position: index + 1 }))
}

function getSummaryRows(team: TournamentTeamScoreTeam): SummaryRow[] {
  const holes = [...(team.holes || [])].sort((left, right) => Number(left.hole) - Number(right.hole))
  let runningScore = 0
  let runningPar = 0
  let hasEnteredScore = false

  return holes.map((hole) => {
    const isProvided = hole.scoreProvided === true && Number.isFinite(Number(hole.score))
    if (isProvided) {
      runningScore += Number(hole.score)
      if (Number.isFinite(Number(hole.par))) runningPar += Number(hole.par)
      hasEnteredScore = true
    }
    return {
      hole: hole.hole,
      par: Number.isFinite(Number(hole.par)) ? Number(hole.par) : null,
      score: isProvided ? Number(hole.score) : null,
      relativeLabel: isProvided && hasEnteredScore ? relativeLabel(runningScore - runningPar) : '—',
      totalLabel: isProvided && hasEnteredScore ? String(runningScore) : '—',
    }
  })
}

function tournamentDate(value?: string | null) {
  return value ? formatFriendlyDate(value) : 'Date not set'
}

export default function TournamentTeamScoreModal({ tournament, onClose }: Props) {
  const [context, setContext] = useState<TournamentTeamScoreContext | null>(null)
  const [holes, setHoles] = useState<HoleScoreDetail[]>([])
  const [view, setView] = useState<ViewMode>('scorecard')
  const [selectedTeamKey, setSelectedTeamKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const pendingHoleSaveRef = useRef<PendingHoleScoreSaveHandler | null>(null)

  const applyContext = useCallback((next: TournamentTeamScoreContext, replaceWorkingHoles = false) => {
    setContext(next)
    const currentTeam = next.teams.find((team) => team.teamKey === next.currentTeamKey)
    if (!currentTeam) return
    if (replaceWorkingHoles) {
      const stateCode = next.tournament.hostGolfCourseState || tournament.hostGolfCourseState || ''
      const course = next.tournament.hostGolfCourseName || tournament.hostGolfCourseName || ''
      const teeColor = normalizeTeeColor(currentTeam.teeColor)
      const normalized = currentTeam.holes?.length
        ? normalizeHoleScorecard(currentTeam.holes, stateCode, course, teeColor)
        : buildClientDefaultHoleScorecard(stateCode, course, teeColor)
      setHoles(normalized)
    }
  }, [tournament.hostGolfCourseName, tournament.hostGolfCourseState])

  const loadContext = useCallback(async (source: string, replaceWorkingHoles = false) => {
    const result = await fetchTournamentTeamScore(tournament.id)
    applyContext(result, replaceWorkingHoles)
    logFrontendEvent({
      category: 'tournament.teamScore',
      message: 'context_loaded',
      data: { tournamentId: tournament.id, source, teamCount: result.teams.length, currentTeamKey: result.currentTeamKey },
    })
    return result
  }, [applyContext, tournament.id])

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      logFrontendEvent({ category: 'tournament.teamScore', message: 'scorecard_opened', data: { tournamentId: tournament.id, registrationId: tournament.registration.id } })
      try {
        const result = await fetchTournamentTeamScore(tournament.id)
        if (!active) return
        applyContext(result, true)
        logFrontendEvent({ category: 'tournament.teamScore', message: 'context_loaded', data: { tournamentId: tournament.id, source: 'modal_open', teamCount: result.teams.length, currentTeamKey: result.currentTeamKey } })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load tournament team scoring.'
        if (active) setError(message)
        logFrontendEvent({ category: 'tournament.teamScore', level: 'error', message: 'context_load_failed', data: { tournamentId: tournament.id, source: 'modal_open', error: message } })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [applyContext, tournament.id, tournament.registration.id])

  const currentTeam = useMemo(() => context?.teams.find((team) => team.teamKey === context.currentTeamKey) || null, [context])
  const selectedTeam = useMemo(() => context?.teams.find((team) => team.teamKey === selectedTeamKey) || null, [context, selectedTeamKey])
  const teeColor = normalizeTeeColor(currentTeam?.teeColor)
  const stateCode = context?.tournament.hostGolfCourseState || tournament.hostGolfCourseState || ''
  const course = context?.tournament.hostGolfCourseName || tournament.hostGolfCourseName || ''
  const leaderboardRows = useMemo(() => getLeaderboardRows(context?.teams || []), [context])
  const summaryRows = useMemo(() => {
    if (!selectedTeam) return []
    const summaryHoles = selectedTeam.holes?.length
      ? normalizeHoleScorecard(selectedTeam.holes, stateCode, course, selectedTeam.teeColor || teeColor)
      : buildClientDefaultHoleScorecard(stateCode, course, selectedTeam.teeColor || teeColor)
    return getSummaryRows({ ...selectedTeam, holes: summaryHoles })
  }, [selectedTeam, stateCode, course, teeColor])
  const completedCount = leaderboardRows.filter((row) => row.totalLabel !== '—').length
  const scoringLocked = ['cancelled', 'completed'].includes(String(context?.tournament.status || tournament.status || '').toLowerCase())

  const persistScore = useCallback(async (nextHoles: HoleScoreDetail[], source: string) => {
    if (!context || !currentTeam) throw new Error('Your registered tournament team could not be resolved.')
    setSaving(true)
    setError(null)
    setSaveMessage('Saving team score…')
    const providedCount = providedHoles(nextHoles).length
    logFrontendEvent({
      category: 'tournament.teamScore',
      message: 'score_persist_started',
      data: { tournamentId: tournament.id, teamKey: currentTeam.teamKey, source, providedHoleCount: providedCount, teeColor },
    })
    try {
      const result = await updateTournamentTeamScore(tournament.id, { holes: nextHoles, teeColor })
      setHoles(nextHoles)
      applyContext(result, false)
      setSaveMessage(providedCount === 18 ? 'Team score saved. All 18 holes are entered.' : `Team score saved. ${providedCount} of 18 holes entered.`)
      logFrontendEvent({
        category: 'tournament.teamScore',
        message: 'score_persist_succeeded',
        data: { tournamentId: tournament.id, teamKey: currentTeam.teamKey, source, providedHoleCount: providedCount, leaderboardTeamCount: result.teams.length },
      })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save tournament team score.'
      setError(message)
      setSaveMessage(null)
      logFrontendEvent({ category: 'tournament.teamScore', level: 'error', message: 'score_persist_failed', data: { tournamentId: tournament.id, teamKey: currentTeam.teamKey, source, providedHoleCount: providedCount, error: message } })
      throw err
    } finally {
      setSaving(false)
    }
  }, [applyContext, context, currentTeam, teeColor, tournament.id])

  const flushPendingHole = useCallback(async (source: string) => {
    if (!pendingHoleSaveRef.current) return { saved: false, holes }
    return pendingHoleSaveRef.current(source)
  }, [holes])

  async function saveTeamScore() {
    if (scoringLocked) return
    setError(null)
    logFrontendEvent({ category: 'tournament.teamScore', message: 'save_clicked', data: { tournamentId: tournament.id, teamKey: currentTeam?.teamKey || null } })
    try {
      const result = await flushPendingHole('tournament_team_score_save_button')
      if (!result.saved) await persistScore(result.holes || holes, 'manual_save')
    } catch {
      // HoleByHoleScorecard and persistScore already log and surface the error.
    }
  }

  async function openLeaderboard() {
    setError(null)
    try {
      if (!scoringLocked) await flushPendingHole('tournament_team_score_leaderboard')
      setRefreshing(true)
      const result = await loadContext('leaderboard_open', false)
      setView('leaderboard')
      setSelectedTeamKey(null)
      logFrontendEvent({ category: 'tournament.teamScore.leaderboard', message: 'leaderboard_opened', data: { tournamentId: tournament.id, teamCount: result.teams.length, consolidatedTeamView: false } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not open tournament leaderboard.'
      setError(message)
      logFrontendEvent({ category: 'tournament.teamScore.leaderboard', level: 'error', message: 'leaderboard_open_failed', data: { tournamentId: tournament.id, error: message } })
    } finally {
      setRefreshing(false)
    }
  }

  async function refreshLeaderboard() {
    setRefreshing(true)
    setError(null)
    logFrontendEvent({ category: 'tournament.teamScore.leaderboard', message: 'refresh_started', data: { tournamentId: tournament.id } })
    try {
      const result = await loadContext('leaderboard_refresh', false)
      logFrontendEvent({ category: 'tournament.teamScore.leaderboard', message: 'refresh_succeeded', data: { tournamentId: tournament.id, teamCount: result.teams.length } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not refresh tournament leaderboard.'
      setError(message)
      logFrontendEvent({ category: 'tournament.teamScore.leaderboard', level: 'error', message: 'refresh_failed', data: { tournamentId: tournament.id, error: message } })
    } finally {
      setRefreshing(false)
    }
  }

  function openRoundSummary(team: TournamentTeamScoreTeam) {
    setSelectedTeamKey(team.teamKey)
    setView('summary')
    logFrontendEvent({ category: 'tournament.teamScore.leaderboard', message: 'round_summary_opened', data: { tournamentId: tournament.id, teamKey: team.teamKey, canEdit: team.canEdit } })
  }

  function editSelectedScore() {
    if (!selectedTeam?.canEdit || scoringLocked) return
    const normalized = selectedTeam.holes?.length
      ? normalizeHoleScorecard(selectedTeam.holes, stateCode, course, selectedTeam.teeColor || teeColor)
      : buildClientDefaultHoleScorecard(stateCode, course, teeColor)
    setHoles(normalized)
    setSelectedTeamKey(null)
    setView('scorecard')
    logFrontendEvent({ category: 'tournament.teamScore.leaderboard', message: 'round_summary_edit_score_opened', data: { tournamentId: tournament.id, teamKey: selectedTeam.teamKey } })
  }

  async function closeModal() {
    if (view === 'scorecard' && !scoringLocked) {
      try {
        await flushPendingHole('tournament_team_score_modal_close')
      } catch {
        return
      }
    }
    logFrontendEvent({ category: 'tournament.teamScore', message: 'modal_closed', data: { tournamentId: tournament.id, view } })
    onClose()
  }

  if (loading) {
    return (
      <div className="modalOverlay tournamentTeamScoreModalOverlay" role="presentation">
        <div className="modalCard tournamentTeamScoreLoadingCard" role="dialog" aria-modal="true" aria-label="Tournament team score loading">
          <strong>Loading team score…</strong>
        </div>
      </div>
    )
  }

  if (!context || !currentTeam) {
    return (
      <div className="modalOverlay tournamentTeamScoreModalOverlay" role="presentation" onClick={onClose}>
        <div className="modalCard tournamentTeamScoreLoadingCard" role="dialog" aria-modal="true" aria-label="Tournament team score error" onClick={(event) => event.stopPropagation()}>
          <strong>Team score unavailable</strong>
          <p className="small">{error || 'Your registered tournament team could not be resolved.'}</p>
          <button type="button" className="btn btnPrimary" onClick={onClose}>Close</button>
        </div>
      </div>
    )
  }

  if (view === 'leaderboard' || view === 'summary') {
    return (
      <div className="modalOverlay inboxLeaderboardModalOverlay tournamentTeamScoreModalOverlay" role="presentation" onClick={() => void closeModal()}>
        <div className="modalCard inboxLeaderboardModal" role="dialog" aria-modal="true" aria-label={view === 'summary' && selectedTeam ? `${selectedTeam.teamName} round summary` : 'Leaderboard'} onClick={(event) => event.stopPropagation()}>
          <div className="inboxLeaderboardHero">
            <div className="inboxLeaderboardHeroTopline">
              <button type="button" className="inboxLeaderboardIconButton" aria-label={view === 'summary' ? 'Back to leaderboard' : 'Back to team score'} onClick={() => {
                if (view === 'summary') {
                  setSelectedTeamKey(null)
                  setView('leaderboard')
                  logFrontendEvent({ category: 'tournament.teamScore.leaderboard', message: 'round_summary_back_to_leaderboard', data: { tournamentId: tournament.id } })
                } else setView('scorecard')
              }}>‹</button>
              <div className="inboxLeaderboardCrest" aria-hidden="true">⛳</div>
              <div className="inboxLeaderboardTopRightActions">
                {view === 'leaderboard' ? (
                  <button type="button" className="inboxLeaderboardIconButton inboxLeaderboardRefreshButton" aria-label="Refresh leaderboard" disabled={refreshing} onClick={() => void refreshLeaderboard()}>{refreshing ? '…' : '↻'}</button>
                ) : null}
                <button type="button" className="inboxLeaderboardIconButton" aria-label="Close leaderboard" onClick={() => void closeModal()}>×</button>
              </div>
            </div>
            <div className="inboxLeaderboardYear">Golf Homiez</div>
            <h2>{view === 'summary' ? 'Round Summary' : 'LEADERBOARD'}</h2>
            {view === 'leaderboard' ? <span className="inboxIndividualRoundSummaryCourse">{course || 'Course not provided'}</span> : null}
            <div className="inboxLeaderboardDivider" />
            <strong>{view === 'summary' && selectedTeam ? selectedTeam.teamName : context.tournament.name}</strong>
            {view === 'summary' ? <span className="inboxIndividualRoundSummaryCourse">{course || 'Course not provided'}</span> : null}
            <span>{[tournamentDate(context.tournament.startDate), stateCode].filter(Boolean).join(' • ')}</span>
          </div>

          {view === 'summary' && selectedTeam ? (
            <div className="inboxLeaderboardBoard inboxIndividualRoundSummaryBoard">
              <div className="inboxIndividualRoundSummaryActions">
                <button type="button" className="btn btnSmall" onClick={() => { setSelectedTeamKey(null); setView('leaderboard') }}>Back to leaderboard</button>
                {selectedTeam.canEdit && !scoringLocked ? <button type="button" className="btn btnPrimary btnSmall" onClick={editSelectedScore}>Edit my score</button> : null}
              </div>
              <div className="inboxIndividualRoundSummaryTable" role="table" aria-label={`${selectedTeam.teamName} hole-by-hole round summary`}>
                <div className="inboxIndividualRoundSummaryHeader" role="row">
                  <span>Hole</span><span>Par</span><span>Score</span><span>Round</span><span>Total</span>
                </div>
                {summaryRows.map((row) => (
                  <div className="inboxIndividualRoundSummaryRow" role="row" key={row.hole}>
                    <strong>{row.hole}</strong><span>{row.par ?? '—'}</span><span>{row.score ?? '—'}</span><strong>{row.relativeLabel}</strong><strong>{row.totalLabel}</strong>
                  </div>
                ))}
              </div>
              <div className="inboxIndividualRoundSummaryLegend">Round is the current cumulative score over or under par. Total is the current cumulative stroke score.</div>
              {error ? <div className="small tournamentTeamScoreError">{error}</div> : null}
            </div>
          ) : (
            <div className="inboxLeaderboardBoard">
              <div className="inboxLeaderboardHeaderRow"><span>POS</span><span>TEAM</span><span>ROUND</span><span>THRU</span><span>TOTAL</span></div>
              {leaderboardRows.map((row) => {
                const positionClass = row.position <= 3 ? `inboxLeaderboardRow--top${row.position}` : ''
                return (
                  <button type="button" key={row.team.teamKey} className={`inboxLeaderboardRow inboxLeaderboardRow--clickable ${positionClass}`} onClick={() => openRoundSummary(row.team)} aria-label={`View ${row.team.teamName} round summary`}>
                    <div className="inboxLeaderboardPosition"><span>{row.position}</span></div>
                    <div className="inboxLeaderboardPlayer"><div className="inboxLeaderboardAvatar" aria-hidden="true">{teamInitials(row.team.teamName)}</div><div><strong>{row.team.teamName}</strong><span>{row.team.canEdit ? 'Your team' : 'Tournament team'}</span></div></div>
                    <span>{row.roundLabel}</span><span>{row.thru || '—'}</span><strong className="inboxLeaderboardScore">{row.totalLabel}</strong>
                  </button>
                )
              })}
              <div className="inboxLeaderboardUpdated">{completedCount} of {leaderboardRows.length} team scores entered live • Select a team for the hole-by-hole round summary</div>
              {error ? <div className="small tournamentTeamScoreError">{error}</div> : null}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="modalOverlay tournamentTeamScoreModalOverlay" role="presentation" onClick={() => void closeModal()}>
      <div className="modalCard tournamentTeamScoreModal" role="dialog" aria-modal="true" aria-label={`${currentTeam.teamName} tournament team score`} onClick={(event) => event.stopPropagation()}>
        <div className="tournamentTeamScoreHeader">
          <div>
            <h2>{context.tournament.name}</h2>
            <p className="small">{currentTeam.teamName} • {course || 'Course not provided'} • {tournamentDate(context.tournament.startDate)}</p>
          </div>
          <button type="button" className="btn btnSmall" onClick={() => void closeModal()}>Close</button>
        </div>
        <div className="tournamentTeamScoreActions tournamentTeamScoreActions--top">
          <button type="button" className="btn inboxLeaderboardButton" disabled={refreshing} onClick={() => void openLeaderboard()}>{refreshing ? 'Loading…' : 'Leaderboard'}</button>
          {!scoringLocked ? <button type="button" className="btn btnPrimary" disabled={saving} onClick={() => void saveTeamScore()}>{saving ? 'Saving…' : 'Save Team Score'}</button> : null}
        </div>
        {scoringLocked ? <div className="small tournamentTeamScoreNotice">Tournament scoring is closed. The leaderboard remains available.</div> : null}
        {error ? <div className="small tournamentTeamScoreError">{error}</div> : null}
        {saveMessage ? <div className="small tournamentTeamScoreSaveMessage">{saveMessage}</div> : null}
        <HoleByHoleScorecard
          enabled={!scoringLocked}
          stateCode={stateCode}
          course={course}
          holes={holes}
          onChange={setHoles}
          onHoleSaved={(nextHoles, _savedHole, action) => persistScore(nextHoles, action === 'reset' ? 'hole_reset' : 'hole_save')}
          scoreOwnerLabel={`${currentTeam.teamName} score`}
          loadScorecardOnMount={!providedHoles(currentTeam.holes || []).length}
          compactMobileInput
          teeColor={teeColor}
          persistedHoles={currentTeam.holes || []}
          registerPendingHoleSave={(handler) => { pendingHoleSaveRef.current = handler }}
          showTeeData={false}
        />
      </div>
    </div>
  )
}
