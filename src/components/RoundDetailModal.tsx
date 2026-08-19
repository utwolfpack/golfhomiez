import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormEvent } from 'react'
import type { HoleScoreDetail, ScoreEntry } from '../types'
import { compareRoundToHistory } from '../lib/roundInsights'
import { formatFriendlyDate, formatFriendlyDateTime } from '../lib/time-format'
import { formatHoleScoreOutcome, hasSavedHoleScoreValue, holeScoreTotal as calculateClientHoleScoreTotal, missingHoleScoreNumbers, normalizeHoleScorecard, scoreOutcomeClassName } from '../lib/hole-scorecard'
import { normalizeTeeColor, teeColorLabel } from '../lib/tee-colors'
import { getIncompleteRoundStatus } from '../lib/round-status'
import { calculateTeamChallengePoints, isSkinsTeamChallenge, normalizeTeamChallengePointsPerHole, normalizeTeamChallengeScoringType } from '../lib/team-challenge-scoring'
import { api } from '../lib/api'
import HoleByHoleScorecard from './HoleByHoleScorecard'
import type { PendingHoleScoreSaveHandler } from './HoleByHoleScorecard'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'

type DisplayHoleScore = {
  hole: number
  score: number | null
  par: number | null
  yards: number | null
  strokeIndex: number | null
  teeColor?: string | null
  distanceToFrontYards?: number | null
  distanceToCenterYards?: number | null
  distanceToBackYards?: number | null
  distanceToFlagYards?: number | null
}

type RoundEditForm = {
  date: string
  state: string
  course: string
  roundScore: string
  team: string
  opponentTeam: string
  teamTotal: string
  opponentTotal: string
}

type RoundDetailModalProps = {
  round: ScoreEntry | null
  allScores: ScoreEntry[]
  onClose: () => void
  onRoundUpdated?: (round: ScoreEntry) => void
  onRoundDeleted?: (roundId: string) => void
}

function displayName(value: unknown, fallback: string) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

function getDisplayRoundMode(round: ScoreEntry): 'solo' | 'team' {
  const record = round as Record<string, unknown>
  const hasSoloScore = record.roundScore != null
  const hasTeamFields = Boolean(record.team || record.opponentTeam || record.teamTotal != null || record.opponentTotal != null)

  if (hasSoloScore && !hasTeamFields) return 'solo'
  return record.mode === 'solo' ? 'solo' : 'team'
}

function parseHoleInput(input: unknown): unknown {
  if (typeof input !== 'string') return input
  const trimmed = input.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function readHoleScores(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = parseHoleInput(record[key])
    if (Array.isArray(value) && value.length > 0) return value
  }

  return null
}

function optionalDisplayNumber(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key])
    if (Number.isFinite(value) && value >= 0) return Math.trunc(value)
  }
  return null
}

function normalizeDisplayHoles(input: unknown): DisplayHoleScore[] {
  const parsedInput = parseHoleInput(input)
  return Array.isArray(parsedInput)
    ? parsedInput
        .map((value: unknown, index: number) => {
          if (typeof value === 'number') return { hole: index + 1, score: value, par: null, yards: null, strokeIndex: null, distanceToFrontYards: null, distanceToCenterYards: null, distanceToBackYards: null, distanceToFlagYards: null }
          const record = value as Record<string, unknown>
          const explicitProvided = Object.prototype.hasOwnProperty.call(record, 'scoreProvided') || Object.prototype.hasOwnProperty.call(record, 'score_provided')
          const providedValue = record.scoreProvided ?? record.score_provided
          const provided = explicitProvided ? (providedValue === true || providedValue === 1 || providedValue === '1' || providedValue === 'true') : record.score !== undefined && record.score !== null && record.score !== '' && Number.isFinite(Number(record.score))
          const score = Number(record.score)
          return {
            hole: Number(record.hole) || index + 1,
            score: provided && Number.isFinite(score) ? score : null,
            par: Number.isFinite(Number(record.par)) ? Number(record.par) : null,
            yards: Number.isFinite(Number(record.yards)) ? Number(record.yards) : null,
            strokeIndex: Number.isFinite(Number(record.strokeIndex ?? record.stroke_index)) ? Number(record.strokeIndex ?? record.stroke_index) : null,
            teeColor: normalizeTeeColor(record.teeColor ?? record.tee_color),
            distanceToFrontYards: optionalDisplayNumber(record, 'distanceToFrontYards', 'distance_to_front_yards'),
            distanceToCenterYards: optionalDisplayNumber(record, 'distanceToCenterYards', 'distance_to_center_yards'),
            distanceToBackYards: optionalDisplayNumber(record, 'distanceToBackYards', 'distance_to_back_yards'),
            distanceToFlagYards: optionalDisplayNumber(record, 'distanceToFlagYards', 'distance_to_flag_yards'),
          }
        })
        .filter((value: DisplayHoleScore) => value.score != null)
    : []
}

function roundDateInputValue(value: unknown) {
  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  return ''
}

function buildRoundEditForm(round: ScoreEntry | null): RoundEditForm {
  if (!round) {
    return { date: '', state: '', course: '', roundScore: '', team: '', opponentTeam: '', teamTotal: '', opponentTotal: '' }
  }

  const record = round as any
  return {
    date: roundDateInputValue(record.date),
    state: String(record.state || '').toUpperCase(),
    course: String(record.course || ''),
    roundScore: record.roundScore == null ? '' : String(record.roundScore),
    team: String(record.team || ''),
    opponentTeam: String(record.opponentTeam || ''),
    teamTotal: record.teamTotal == null ? '' : String(record.teamTotal),
    opponentTotal: record.opponentTotal == null ? '' : String(record.opponentTotal),
  }
}


function getRoundTeeColor(round: ScoreEntry | null) {
  return normalizeTeeColor((round as any)?.teeColor ?? (round as any)?.tee_color)
}

function buildEditableHoleScores(round: ScoreEntry | null, keys: string[]): HoleScoreDetail[] {
  if (!round) return []
  const record = round as unknown as Record<string, unknown>
  const state = String((round as any).state || '')
  const course = String((round as any).course || '')
  const raw = readHoleScores(record, keys)
  const holes = normalizeHoleScorecard(raw, state, course, getRoundTeeColor(round))
  if (Array.isArray(raw) && raw.length > 0) return holes
  return holes
}

function formatHoleDetailMetadata(hole: { par?: number | null; yards?: number | null }) {
  const items = [`Par ${hole.par || '—'}`]
  const yards = Number(hole.yards)
  if (hole.yards != null && Number.isFinite(yards) && yards > 0) items.push(`${Math.trunc(yards)} yds`)
  return items.join(' • ')
}

function providedHoleScoreTotal(holes: HoleScoreDetail[]) {
  return holes
    .filter((hole) => hole.scoreProvided)
    .reduce((sum, hole) => sum + (Number.isFinite(Number(hole.score)) ? Number(hole.score) : 0), 0)
}

function teamEditResult(teamTotal: number, opponentTotal: number) {
  if (!Number.isFinite(teamTotal) || !Number.isFinite(opponentTotal)) return 'Enter scores'
  if (teamTotal < opponentTotal) return 'Win'
  if (teamTotal > opponentTotal) return 'Loss'
  return 'Tie'
}

function holeOutcome(hole: DisplayHoleScore | undefined) {
  if (!hole || hole.score == null) {
    return {
      outcome: 'No score',
      outcomeClass: 'roundHoleDetailPill--unknown',
      strokes: '—',
    }
  }

  const hasParAndScore = hole.par != null && hole.score != null
  return {
    outcome: hasParAndScore ? formatHoleScoreOutcome({ par: hole.par || 0, score: hole.score || 0 }) : `Score ${hole.score}`,
    outcomeClass: hasParAndScore ? scoreOutcomeClassName({ par: hole.par || 0, score: hole.score || 0 }) : 'roundHoleDetailPill--unknown',
    strokes: `${hole.score} ${hole.score === 1 ? 'stroke' : 'strokes'}`,
  }
}

function formatHoleDistance(hole: { yards?: number | null; distanceToCenterYards?: number | null; distanceToFlagYards?: number | null; distanceToBackYards?: number | null; distanceToFrontYards?: number | null }) {
  const distance = Number(hole.yards ?? hole.distanceToCenterYards ?? hole.distanceToFlagYards ?? hole.distanceToBackYards ?? hole.distanceToFrontYards)
  return Number.isFinite(distance) && distance > 0 ? `${Math.trunc(distance)} yds` : '—'
}

function renderHoleDetails(holes: DisplayHoleScore[]) {
  return (
    <div className="roundHoleLineItemTable" role="table" aria-label="Round hole review line-item summary" style={{ marginTop: 8 }}>
      <div className="roundHoleLineItemHeader" role="row">
        <span>Hole</span>
        <span>Par</span>
        <span>Score</span>
        <span>Distance</span>
      </div>
      {holes.map((hole) => {
        const outcome = holeOutcome(hole)
        return (
          <div key={hole.hole} className="roundHoleLineItemRow" role="row">
            <strong>{hole.hole}</strong>
            <span>{hole.par == null ? '—' : hole.par}</span>
            <span className={`roundHoleLineItemScore ${outcome.outcomeClass}`}>
              <strong>{hole.score == null ? '—' : hole.score}</strong>
              <small>{outcome.outcome}</small>
            </span>
            <span>{formatHoleDistance(hole)}</span>
          </div>
        )
      })}
    </div>
  )
}

function formatPointNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function getTeamChallengeRoundSideInitial(label: string, fallback: string) {
  return String(label || '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || fallback
}

function getTeamChallengeRoundWinnerLabel(winner: 'proposer' | 'challenged' | 'tie' | 'pending', teamLabel: string, opponentLabel: string) {
  if (winner === 'pending' || winner === 'tie') return '—'
  return winner === 'proposer'
    ? getTeamChallengeRoundSideInitial(teamLabel, 'T')
    : getTeamChallengeRoundSideInitial(opponentLabel, 'O')
}

function getTeamChallengeRoundSummaryScoreClass(winner: 'proposer' | 'challenged' | 'tie' | 'pending', side: 'proposer' | 'challenged') {
  if (winner === side) return 'inboxTeamChallengeSummaryScore--winner'
  if (winner === 'tie' || winner === 'pending') return 'inboxTeamChallengeSummaryScore--push'
  return 'inboxTeamChallengeSummaryScore--loss'
}

function getTeamChallengeRoundPushPoints(result: { winner: 'proposer' | 'challenged' | 'tie' | 'pending'; pointsAwarded: number; carryoverAfterHole: number; strokeDifferentialBonus: number }, pointSummary: ReturnType<typeof calculateTeamChallengePoints>) {
  if (pointSummary.scoringType !== 'skins_push') return 0
  if (result.winner === 'tie' || result.winner === 'pending') return Math.max(0, result.carryoverAfterHole)
  if (result.winner === 'proposer' || result.winner === 'challenged') return Math.max(0, result.pointsAwarded - pointSummary.pointsPerHole - result.strokeDifferentialBonus)
  return 0
}

function formatTeamChallengeRoundPointLeadLabel(teamLabel: string, opponentLabel: string, teamPoints: number, opponentPoints: number) {
  if (teamPoints === opponentPoints) return '—'
  const leaderLabel = teamPoints > opponentPoints
    ? getTeamChallengeRoundSideInitial(teamLabel, 'T')
    : getTeamChallengeRoundSideInitial(opponentLabel, 'O')
  return `${leaderLabel} +${formatPointNumber(Math.abs(teamPoints - opponentPoints))}`
}

function renderTeamHoleComparison(teamHoles: DisplayHoleScore[], opponentHoles: DisplayHoleScore[], teamLabel: string, opponentLabel: string, round: ScoreEntry) {
  const teamByHole = new Map(teamHoles.map((hole) => [hole.hole, hole]))
  const opponentByHole = new Map(opponentHoles.map((hole) => [hole.hole, hole]))
  const scoringType = normalizeTeamChallengeScoringType((round as any).challengeScoringType)
  const pointsPerHole = normalizeTeamChallengePointsPerHole((round as any).challengePointsPerHole)
  const pointSummary = calculateTeamChallengePoints(teamHoles as unknown as HoleScoreDetail[], opponentHoles as unknown as HoleScoreDetail[], scoringType, pointsPerHole)
  const resultsByHole = new Map(pointSummary.holeResults.map((result) => [result.hole, result]))
  const holeNumbers = Array.from(new Set([
    ...pointSummary.holeResults.map((result) => result.hole),
    ...teamByHole.keys(),
    ...opponentByHole.keys(),
  ])).sort((left, right) => left - right)

  if (!holeNumbers.length) return null

  let runningTeamPoints = 0
  let runningOpponentPoints = 0
  let pushedPointsTotal = 0
  const rows = holeNumbers.map((holeNumber) => {
    const teamHole = teamByHole.get(holeNumber)
    const opponentHole = opponentByHole.get(holeNumber)
    const result = resultsByHole.get(holeNumber) || { hole: holeNumber, winner: 'pending' as const, proposerScore: null, challengedScore: null, pointsAwarded: 0, carryoverAfterHole: 0, strokeDifferential: 0, strokeDifferentialBonus: 0 }
    if (result.winner === 'proposer') runningTeamPoints += result.pointsAwarded
    if (result.winner === 'challenged') runningOpponentPoints += result.pointsAwarded
    const pushedPoints = getTeamChallengeRoundPushPoints(result, pointSummary)
    pushedPointsTotal += pushedPoints
    return {
      holeNumber,
      par: teamHole?.par ?? opponentHole?.par ?? null,
      teamHole,
      opponentHole,
      result,
      pushedPoints,
      pointLeadLabel: isSkinsTeamChallenge(scoringType) ? formatTeamChallengeRoundPointLeadLabel(teamLabel, opponentLabel, runningTeamPoints, runningOpponentPoints) : '—',
    }
  })
  const finalLeadLabel = isSkinsTeamChallenge(scoringType) ? formatTeamChallengeRoundPointLeadLabel(teamLabel, opponentLabel, pointSummary.proposerPoints, pointSummary.challengedPoints) : '—'

  return (
    <div className="roundTeamChallengeSummaryView" aria-label="Round Team Challenge line-item comparison" style={{ marginTop: 10 }}>
      <div className="inboxTeamChallengeSummaryTable roundTeamChallengeSummaryTable" role="table" aria-label="Hole-by-hole Team Challenge round review summary">
        <div className="inboxTeamChallengeSummaryHeader" role="row">
          <span>Hole</span>
          <span>Par</span>
          <span title={teamLabel}>{teamLabel}</span>
          <span title={opponentLabel}>{opponentLabel}</span>
          <span>Winner</span>
          <span>Push</span>
          <span>Points</span>
        </div>
        {rows.map((row) => (
          <div key={row.holeNumber} className="inboxTeamChallengeSummaryRow" role="row">
            <strong>{row.holeNumber}</strong>
            <span>{row.par == null ? '—' : row.par}</span>
            <span className={`inboxTeamChallengeSummaryScore ${getTeamChallengeRoundSummaryScoreClass(row.result.winner, 'proposer')}`}>{row.teamHole?.score == null ? '—' : row.teamHole.score}</span>
            <span className={`inboxTeamChallengeSummaryScore ${getTeamChallengeRoundSummaryScoreClass(row.result.winner, 'challenged')}`}>{row.opponentHole?.score == null ? '—' : row.opponentHole.score}</span>
            <span className={`inboxTeamChallengeSummaryWinner inboxTeamChallengeSummaryWinner--${row.result.winner}`}>{getTeamChallengeRoundWinnerLabel(row.result.winner, teamLabel, opponentLabel)}</span>
            <span>{isSkinsTeamChallenge(scoringType) && row.pushedPoints > 0 ? formatPointNumber(row.pushedPoints) : '—'}</span>
            <strong className="inboxTeamChallengeSummaryPoints">{row.pointLeadLabel}</strong>
          </div>
        ))}
        <div className="inboxTeamChallengeSummaryRow inboxTeamChallengeSummaryRow--total" role="row">
          <strong>Total</strong>
          <span>{rows.reduce((sum, row) => sum + (row.par || 0), 0)}</span>
          <span>{teamHoles.reduce((sum, hole) => sum + (hole.score || 0), 0)}</span>
          <span>{opponentHoles.reduce((sum, hole) => sum + (hole.score || 0), 0)}</span>
          <span>—</span>
          <span>{isSkinsTeamChallenge(scoringType) && pushedPointsTotal > 0 ? formatPointNumber(pushedPointsTotal) : '—'}</span>
          <strong className="inboxTeamChallengeSummaryPoints">{finalLeadLabel}</strong>
        </div>
      </div>
    </div>
  )
}

function renderTeamSummaryValue(label: string, canOpenScoreView: boolean, isActive: boolean, onSelect: () => void) {
  return canOpenScoreView ? (
    <button
      type="button"
      className={isActive ? 'roundDetailInlineTeamLink roundDetailInlineTeamLinkActive' : 'roundDetailInlineTeamLink'}
      onClick={onSelect}
      aria-label={`Show ${label} hole-by-hole scores`}
    >
      {label}
    </button>
  ) : (
    <span>{label}</span>
  )
}

export default function RoundDetailModal({ round, allScores, onClose, onRoundUpdated, onRoundDeleted }: RoundDetailModalProps) {
  const [detailView, setDetailView] = useState<'round' | 'team' | 'opponent'>('round')
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<RoundEditForm>(() => buildRoundEditForm(round))
  const [editSoloHoles, setEditSoloHoles] = useState<HoleScoreDetail[]>(() => buildEditableHoleScores(round, ['holes', 'holes_json', 'holeScores', 'hole_scores_json']))
  const [editTeamHoles, setEditTeamHoles] = useState<HoleScoreDetail[]>(() => buildEditableHoleScores(round, ['holes', 'holes_json', 'holeScores', 'hole_scores_json']))
  const [editOpponentHoles, setEditOpponentHoles] = useState<HoleScoreDetail[]>(() => buildEditableHoleScores(round, ['opponentHoles', 'opponent_holes_json', 'opponent_holes', 'opponentHoleScores', 'opponent_hole_scores_json']))
  const pendingEditHoleSaveRef = useRef<PendingHoleScoreSaveHandler | null>(null)
  const [activeEditScorecardSide, setActiveEditScorecardSide] = useState<'solo' | 'team' | 'opponent' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isClosingEditScorecard, setIsClosingEditScorecard] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const roundId = (round as any)?.id

  useEffect(() => {
    setDetailView('round')
    setIsEditing(false)
    setActionError(null)
    setActiveEditScorecardSide(null)
    pendingEditHoleSaveRef.current = null
    setEditForm(buildRoundEditForm(round))
    setEditSoloHoles(buildEditableHoleScores(round, ['holes', 'holes_json', 'holeScores', 'hole_scores_json']))
    setEditTeamHoles(buildEditableHoleScores(round, ['holes', 'holes_json', 'holeScores', 'hole_scores_json']))
    setEditOpponentHoles(buildEditableHoleScores(round, ['opponentHoles', 'opponent_holes_json', 'opponent_holes', 'opponentHoleScores', 'opponent_hole_scores_json']))
  }, [roundId])

  useEffect(() => {
    if (!round || !activeEditScorecardSide || typeof document === 'undefined') return

    const previousOverflow = document.body.style.overflow
    const previousOverscrollBehavior = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'

    const viewportHeight = typeof window === 'undefined' ? null : window.innerHeight
    const visualViewportHeight = typeof window === 'undefined' ? null : Math.round(window.visualViewport?.height || window.innerHeight)
    logFrontendEvent({
      category: 'round.detail.edit_scorecard.viewport',
      message: 'full_viewport_scorecard_mounted',
      data: {
        correlationId: getCorrelationId(),
        scoreId: String((round as any).id || ''),
        side: activeEditScorecardSide,
        mode: getDisplayRoundMode(round),
        portalTarget: 'document.body',
        viewportHeight,
        visualViewportHeight,
      },
    })

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscrollBehavior
    }
  }, [roundId, activeEditScorecardSide])

  useEffect(() => {
    if (!round || !isEditing || getDisplayRoundMode(round) !== 'solo') return
    logFrontendEvent({
      category: 'roundDetail.soloEdit',
      message: 'comparison_panel_hidden',
      data: {
        correlationId: getCorrelationId(),
        roundId: (round as any).id || null,
        course: (round as any).course || '',
        date: (round as any).date || '',
        comparisonPanelVisible: false,
      },
    })
  }, [roundId, isEditing])

  useEffect(() => {
    if (!round || isEditing) return
    const record = round as unknown as Record<string, unknown>
    const primaryHoles = normalizeDisplayHoles(readHoleScores(record, ['holes', 'holes_json', 'holeScores', 'hole_scores_json']) ?? (round as any).holes)
    const secondaryHoles = getDisplayRoundMode(round) === 'team'
      ? normalizeDisplayHoles(readHoleScores(record, ['opponentHoles', 'opponent_holes_json', 'opponent_holes', 'opponentHoleScores', 'opponent_hole_scores_json']) ?? (round as any).opponentHoles)
      : []
    logFrontendEvent({
      category: 'round.detail.review',
      message: 'round_hole_line_item_review_viewed',
      data: {
        correlationId: getCorrelationId(),
        roundId: (round as any).id || null,
        mode: getDisplayRoundMode(round),
        detailView,
        lineItemReviewView: true,
        reviewColumns: ['Hole', 'Par', 'Score', 'Distance'],
        teamComparisonColumns: getDisplayRoundMode(round) === 'team' ? ['Hole', 'Par', displayName((round as any).team, 'Team'), displayName((round as any).opponentTeam, 'Opponent Team'), 'Winner', 'Push', 'Points'] : null,
        primaryHoleCount: primaryHoles.length,
        opponentHoleCount: secondaryHoles.length,
        primaryHoleReviewVisible: primaryHoles.length > 0,
        restoredRoundReviewHoleTable: true,
      },
    })
  }, [roundId, isEditing, detailView])

  if (!round) return null

  const displayMode = getDisplayRoundMode(round)
  const isTeamChallengeRound = (round as any).source === 'team_challenge'
  const roundTypeLabel = displayMode === 'solo' ? 'Solo round' : isTeamChallengeRound ? 'Team Challenge' : 'Team round'
  const teamLabel = displayName((round as any).team, 'Team')
  const opponentLabel = displayName((round as any).opponentTeam, 'Opponent Team')
  const roundRecord = round as unknown as Record<string, unknown>
  const roundTeeColor = getRoundTeeColor(round)
  const roundTeeLabel = teeColorLabel(roundTeeColor)
  const holes: DisplayHoleScore[] = normalizeDisplayHoles(readHoleScores(roundRecord, ['holes', 'holes_json', 'holeScores', 'hole_scores_json']) ?? (round as any).holes)
  const opponentHoles: DisplayHoleScore[] = displayMode === 'team'
    ? normalizeDisplayHoles(readHoleScores(roundRecord, ['opponentHoles', 'opponent_holes_json', 'opponent_holes', 'opponentHoleScores', 'opponent_hole_scores_json']) ?? (round as any).opponentHoles)
    : []
  const holeScoreTotal = holes.reduce((sum, hole) => sum + (hole.score || 0), 0)
  const opponentHoleScoreTotal = opponentHoles.reduce((sum, hole) => sum + (hole.score || 0), 0)
  const canShowTeamComparison = displayMode === 'team' && holes.length > 0 && opponentHoles.length > 0
  const soloEditUsesHoles = displayMode === 'solo'
  const editSoloMissingHoles = missingHoleScoreNumbers(editSoloHoles)
  const editSoloScoreTotal = editSoloMissingHoles.length ? providedHoleScoreTotal(editSoloHoles) : calculateClientHoleScoreTotal(editSoloHoles)
  const editSoloParTotal = editSoloHoles.reduce((sum, hole) => sum + (Number.isFinite(hole.par) ? (hole.par ?? 0) : 0), 0)
  const teamEditUsesHoles = displayMode === 'team'
  const editTeamMissingHoles = missingHoleScoreNumbers(editTeamHoles)
  const editOpponentMissingHoles = missingHoleScoreNumbers(editOpponentHoles)
  const editTeamScoreTotal = editTeamMissingHoles.length ? providedHoleScoreTotal(editTeamHoles) : calculateClientHoleScoreTotal(editTeamHoles)
  const editOpponentScoreTotal = editOpponentMissingHoles.length ? providedHoleScoreTotal(editOpponentHoles) : calculateClientHoleScoreTotal(editOpponentHoles)
  const editTeamResult = teamEditResult(editTeamScoreTotal, editOpponentScoreTotal)
  const canOpenTeamScoreView = isTeamChallengeRound && holes.length > 0
  const canOpenOpponentScoreView = isTeamChallengeRound && opponentHoles.length > 0
  const showingTeamHoles = displayMode === 'team' && detailView === 'team'
  const showingOpponentHoles = displayMode === 'team' && detailView === 'opponent'
  const detailTeamScore = `${(round as any).teamTotal == null ? 'Pending' : (round as any).teamTotal} - ${(round as any).opponentTotal == null ? 'Pending' : (round as any).opponentTotal}`
  const detailTeamResult = (round as any).teamTotal == null || (round as any).opponentTotal == null ? 'Pending' : ((round as any).won === true ? 'Win' : (round as any).won === false ? 'Loss' : 'Tie')
  const insight = compareRoundToHistory({ ...(round as any), mode: displayMode }, allScores as any)
  const showInsightPanel = !isTeamChallengeRound && !(isEditing && displayMode === 'solo')
  const incompleteStatus = getIncompleteRoundStatus(round)

  const selectTeamDetailView = (nextView: 'round' | 'team' | 'opponent', source: string) => {
    setDetailView(nextView)
    logFrontendEvent({
      category: 'round.detail.team_view',
      message: nextView === 'round' ? 'team_comparison_selected' : 'individual_team_selected',
      data: {
        correlationId: getCorrelationId(),
        scoreId: String((round as any).id || ''),
        source,
        previousView: detailView,
        selectedView: nextView,
        team: teamLabel,
        opponent: opponentLabel,
      },
    })
  }

  const beginHoleByHoleEdit = () => {
    const defaultSide: 'solo' | 'team' = displayMode === 'solo' ? 'solo' : 'team'
    setIsEditing(true)
    setActionError(null)
    setDetailView('round')
    setEditForm(buildRoundEditForm(round))
    setEditSoloHoles(buildEditableHoleScores(round, ['holes', 'holes_json', 'holeScores', 'hole_scores_json']))
    setEditTeamHoles(buildEditableHoleScores(round, ['holes', 'holes_json', 'holeScores', 'hole_scores_json']))
    setEditOpponentHoles(buildEditableHoleScores(round, ['opponentHoles', 'opponent_holes_json', 'opponent_holes', 'opponentHoleScores', 'opponent_hole_scores_json']))
    setActiveEditScorecardSide(defaultSide)
    logFrontendEvent({
      category: 'round.detail.edit',
      message: 'hole_by_hole_edit_opened',
      data: {
        correlationId: getCorrelationId(),
        scoreId: String((round as any).id || ''),
        mode: displayMode,
        defaultSide,
        defaultHoleSelection: 'first_unscored_hole',
        fullViewportScorecard: true,
        sharedHoleInputFlow: true,
      },
    })
  }

  const updateEditField = (field: keyof RoundEditForm, value: string) => {
    setEditForm((current) => ({ ...current, [field]: value }))
  }

  const buildRoundEditPayload = (overrides: { soloHoles?: HoleScoreDetail[]; teamHoles?: HoleScoreDetail[]; opponentHoles?: HoleScoreDetail[] } = {}) => {
    const nextSoloHoles = overrides.soloHoles || editSoloHoles
    const nextTeamHoles = overrides.teamHoles || editTeamHoles
    const nextOpponentHoles = overrides.opponentHoles || editOpponentHoles
    const nextSoloMissingHoles = missingHoleScoreNumbers(nextSoloHoles)
    const nextTeamMissingHoles = missingHoleScoreNumbers(nextTeamHoles)
    const nextOpponentMissingHoles = missingHoleScoreNumbers(nextOpponentHoles)
    const nextSoloProvidedCount = nextSoloHoles.length - nextSoloMissingHoles.length
    const nextTeamProvidedCount = nextTeamHoles.length - nextTeamMissingHoles.length
    const nextOpponentProvidedCount = nextOpponentHoles.length - nextOpponentMissingHoles.length
    const nextSoloScoreTotal = nextSoloMissingHoles.length ? providedHoleScoreTotal(nextSoloHoles) : calculateClientHoleScoreTotal(nextSoloHoles)
    const nextTeamScoreTotal = nextTeamMissingHoles.length ? providedHoleScoreTotal(nextTeamHoles) : calculateClientHoleScoreTotal(nextTeamHoles)
    const nextOpponentScoreTotal = nextOpponentMissingHoles.length ? providedHoleScoreTotal(nextOpponentHoles) : calculateClientHoleScoreTotal(nextOpponentHoles)

    return displayMode === 'solo'
      ? {
          mode: 'solo',
          date: editForm.date,
          state: editForm.state,
          course: editForm.course,
          roundScore: soloEditUsesHoles && nextSoloProvidedCount > 0 ? nextSoloScoreTotal : Number(editForm.roundScore),
          teeColor: roundTeeColor,
          holes: soloEditUsesHoles ? nextSoloHoles : undefined,
        }
      : {
          mode: 'team',
          date: editForm.date,
          state: editForm.state,
          course: editForm.course,
          team: editForm.team,
          opponentTeam: editForm.opponentTeam,
          teamTotal: teamEditUsesHoles && nextTeamProvidedCount > 0 ? nextTeamScoreTotal : Number(editForm.teamTotal),
          opponentTotal: teamEditUsesHoles && nextOpponentProvidedCount > 0 ? nextOpponentScoreTotal : Number(editForm.opponentTotal),
          teeColor: roundTeeColor,
          holes: teamEditUsesHoles ? nextTeamHoles : undefined,
          opponentHoles: teamEditUsesHoles ? nextOpponentHoles : undefined,
        }
  }

  const saveRoundEditChanges = async (source: string, overrides: { soloHoles?: HoleScoreDetail[]; teamHoles?: HoleScoreDetail[]; opponentHoles?: HoleScoreDetail[] } = {}) => {
    const correlationId = getCorrelationId()
    const payload = buildRoundEditPayload(overrides)
    const scoreId = String((round as any).id)
    const payloadRecord = payload as Record<string, any>
    logFrontendEvent({
      category: 'round.detail.edit.save',
      message: 'started',
      data: {
        correlationId,
        scoreId,
        source,
        mode: displayMode,
        activeEditScorecardSide,
        roundScore: payloadRecord.roundScore,
        teamTotal: payloadRecord.teamTotal,
        opponentTotal: payloadRecord.opponentTotal,
        providedHoleCount: Array.isArray(payloadRecord.holes) ? payloadRecord.holes.filter((hole: HoleScoreDetail) => hole.scoreProvided).length : null,
        opponentProvidedHoleCount: Array.isArray(payloadRecord.opponentHoles) ? payloadRecord.opponentHoles.filter((hole: HoleScoreDetail) => hole.scoreProvided).length : null,
      },
    })
    const updated = await api<ScoreEntry>(`/api/scores/${encodeURIComponent(scoreId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    onRoundUpdated?.(updated)
    logFrontendEvent({
      category: 'round.detail.edit.save',
      message: 'succeeded',
      data: { correlationId, scoreId, source, mode: displayMode },
    })
    return updated
  }

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setActionError(null)
    setIsSavingEdit(true)
    try {
      await saveRoundEditChanges('save_changes_button')
      setIsEditing(false)
      setDetailView('round')
    } catch (error: any) {
      const message = error?.message || 'Could not update this round'
      setActionError(message)
      logFrontendEvent({ category: 'round.detail.edit.save', level: 'error', message: 'failed', data: { correlationId: getCorrelationId(), scoreId: String((round as any).id || ''), source: 'save_changes_button', error: message } })
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleDeleteRound = async () => {
    setActionError(null)
    const confirmed = window.confirm('Delete this logged round? This cannot be undone.')
    if (!confirmed) return
    setIsDeleting(true)
    try {
      await api<{ ok: boolean }>(`/api/scores/${encodeURIComponent(String((round as any).id))}`, { method: 'DELETE' })
      onRoundDeleted?.(String((round as any).id))
      onClose()
    } catch (error: any) {
      setActionError(error?.message || 'Could not delete this round')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleEditHoleSaved = async (nextHoles: HoleScoreDetail[], savedHole: HoleScoreDetail) => {
    const side = activeEditScorecardSide
    if (!side) return
    const overrides = side === 'solo'
      ? { soloHoles: nextHoles }
      : side === 'team'
        ? { teamHoles: nextHoles }
        : { opponentHoles: nextHoles }
    const nextScoreTotal = missingHoleScoreNumbers(nextHoles).length ? providedHoleScoreTotal(nextHoles) : calculateClientHoleScoreTotal(nextHoles)
    if (side === 'solo') {
      setEditSoloHoles(nextHoles)
      setEditForm((current) => ({ ...current, roundScore: String(nextScoreTotal) }))
    } else if (side === 'team') {
      setEditTeamHoles(nextHoles)
      setEditForm((current) => ({ ...current, teamTotal: String(nextScoreTotal) }))
    } else {
      setEditOpponentHoles(nextHoles)
      setEditForm((current) => ({ ...current, opponentTotal: String(nextScoreTotal) }))
    }

    try {
      await saveRoundEditChanges(`edit_scorecard_${side}_hole_save`, overrides)
    } catch (error: any) {
      const message = error?.message || 'Could not save this hole score to the round.'
      setActionError(message)
      logFrontendEvent({ category: 'round.detail.edit.save', level: 'error', message: 'failed', data: { correlationId: getCorrelationId(), scoreId: String((round as any).id || ''), source: `edit_scorecard_${side}_hole_save`, side, hole: savedHole.hole, error: message } })
      throw error
    }
  }

  const handleParentClose = async () => {
    if (!isEditing) {
      onClose()
      return
    }

    const correlationId = getCorrelationId()
    const scoreId = String((round as any).id || '')
    setActionError(null)
    setIsSavingEdit(true)
    logFrontendEvent({ category: 'round.detail.parent_close', message: 'started', data: { correlationId, scoreId, mode: displayMode, activeEditScorecardSide, pendingHoleFlushRegistered: Boolean(pendingEditHoleSaveRef.current) } })
    try {
      const pendingSaveResult = activeEditScorecardSide && pendingEditHoleSaveRef.current
        ? await pendingEditHoleSaveRef.current('round_detail_parent_close_button')
        : null
      const overrides = activeEditScorecardSide === 'solo' && pendingSaveResult?.holes
        ? { soloHoles: pendingSaveResult.holes }
        : activeEditScorecardSide === 'team' && pendingSaveResult?.holes
          ? { teamHoles: pendingSaveResult.holes }
          : activeEditScorecardSide === 'opponent' && pendingSaveResult?.holes
            ? { opponentHoles: pendingSaveResult.holes }
            : {}
      await saveRoundEditChanges('round_detail_parent_close_button', overrides)
      logFrontendEvent({ category: 'round.detail.parent_close', message: 'succeeded', data: { correlationId, scoreId, mode: displayMode, pendingHoleSaved: pendingSaveResult?.saved || false, pendingHole: pendingSaveResult?.hole || null } })
      onClose()
    } catch (error: any) {
      const message = error?.message || 'Could not save this round before closing.'
      setActionError(message)
      logFrontendEvent({ category: 'round.detail.parent_close', level: 'error', message: 'failed', data: { correlationId, scoreId, mode: displayMode, error: message } })
    } finally {
      setIsSavingEdit(false)
    }
  }

  const closeActiveEditScorecard = async (source = 'round_detail_scorecard_close_button', finishEditing = true) => {
    if (!activeEditScorecardSide || isClosingEditScorecard) return
    const correlationId = getCorrelationId()
    const side = activeEditScorecardSide
    setActionError(null)
    setIsClosingEditScorecard(true)
    logFrontendEvent({ category: 'round.detail.edit_scorecard.close', message: 'started', data: { correlationId, scoreId: String((round as any).id || ''), side, source, pendingHoleFlushRegistered: Boolean(pendingEditHoleSaveRef.current) } })
    try {
      const pendingSaveResult = pendingEditHoleSaveRef.current
        ? await pendingEditHoleSaveRef.current(source)
        : { saved: false, hole: null, providedHoleNumbers: [] }
      setActiveEditScorecardSide(null)
      pendingEditHoleSaveRef.current = null
      if (finishEditing) {
        setIsEditing(false)
        setDetailView('round')
      }
      logFrontendEvent({ category: 'round.detail.edit_scorecard.close', message: 'succeeded', data: { correlationId, scoreId: String((round as any).id || ''), side, source, pendingHoleSaved: pendingSaveResult.saved, pendingHole: pendingSaveResult.hole, providedHoleNumbers: pendingSaveResult.providedHoleNumbers, finishEditing, returnedToRoundReview: finishEditing } })
    } catch (error: any) {
      const message = error?.message || 'Could not save the current hole score before closing.'
      setActionError(message)
      logFrontendEvent({ category: 'round.detail.edit_scorecard.close', level: 'error', message: 'failed', data: { correlationId, scoreId: String((round as any).id || ''), side, source, error: message } })
    } finally {
      setIsClosingEditScorecard(false)
    }
  }

  const switchActiveEditScorecardSide = async (nextSide: 'team' | 'opponent') => {
    if (!activeEditScorecardSide || activeEditScorecardSide === nextSide || isClosingEditScorecard) return
    const previousSide = activeEditScorecardSide
    const correlationId = getCorrelationId()
    setActionError(null)
    setIsClosingEditScorecard(true)
    logFrontendEvent({ category: 'round.detail.edit_scorecard.side', message: 'switch_started', data: { correlationId, scoreId: String((round as any).id || ''), previousSide, nextSide } })
    try {
      const pendingSaveResult = pendingEditHoleSaveRef.current
        ? await pendingEditHoleSaveRef.current('round_detail_scorecard_side_switch')
        : { saved: false, hole: null, providedHoleNumbers: [] }
      pendingEditHoleSaveRef.current = null
      setActiveEditScorecardSide(nextSide)
      logFrontendEvent({ category: 'round.detail.edit_scorecard.side', message: 'switch_succeeded', data: { correlationId, scoreId: String((round as any).id || ''), previousSide, nextSide, pendingHoleSaved: pendingSaveResult.saved, pendingHole: pendingSaveResult.hole } })
    } catch (error: any) {
      const message = error?.message || 'Could not save the current hole before switching scorecards.'
      setActionError(message)
      logFrontendEvent({ category: 'round.detail.edit_scorecard.side', level: 'error', message: 'switch_failed', data: { correlationId, scoreId: String((round as any).id || ''), previousSide, nextSide, error: message } })
    } finally {
      setIsClosingEditScorecard(false)
    }
  }

  const resetEditState = () => {
    setIsEditing(false)
    setActionError(null)
    setActiveEditScorecardSide(null)
    pendingEditHoleSaveRef.current = null
    setEditForm(buildRoundEditForm(round))
    setEditSoloHoles(buildEditableHoleScores(round, ['holes', 'holes_json', 'holeScores', 'hole_scores_json']))
    setEditTeamHoles(buildEditableHoleScores(round, ['holes', 'holes_json', 'holeScores', 'hole_scores_json']))
    setEditOpponentHoles(buildEditableHoleScores(round, ['opponentHoles', 'opponent_holes_json', 'opponent_holes', 'opponentHoleScores', 'opponent_hole_scores_json']))
  }

  const editPanel = (
    <>
      <form className="roundDetailEditForm" onSubmit={handleEditSubmit}>
        <div className="roundDetailEditGrid">
          <label className="label">Date
            <input className="input inputReadOnly" type="date" value={editForm.date} readOnly required />
          </label>
          <label className="label">State
            <input className="input inputReadOnly" value={editForm.state} readOnly required />
          </label>
          <label className="label">Course
            <input className="input inputReadOnly" value={editForm.course} readOnly required />
          </label>
          {displayMode === 'solo' ? (
            soloEditUsesHoles ? (
              <>
                <div className="roundDetailEditScorecardField">
                  <label className="label">Round Score</label>
                  <button type="button" className="teamScorecardOpenButton teamScorecardInputButton" onClick={() => setActiveEditScorecardSide('solo')}>
                    <span className="teamScorecardInputBadge">Tap to edit score</span>
                    <strong>Score input for solo round</strong>
                    <span>{editSoloScoreTotal || editForm.roundScore || 'No score'} strokes</span>
                    <span>Open hole-by-hole scoring</span>
                  </button>
                </div>
                <div className="soloLockedRoundSummary teamLockedRoundSummary roundDetailEditReadonlySummary">
                  <div>
                    <span>Course par</span>
                    <strong>{editSoloParTotal}</strong>
                  </div>
                  <div>
                    <span>Round score</span>
                    <strong>{editSoloScoreTotal}</strong>
                  </div>
                  <div>
                    <span>Holes remaining</span>
                    <strong>{editSoloMissingHoles.length}</strong>
                  </div>
                </div>
              </>
            ) : (
              <label className="label">Round Score
                <input className="input" type="number" min="0" value={editForm.roundScore} onChange={(event) => updateEditField('roundScore', event.target.value)} required />
              </label>
            )
          ) : (
            <>
              <label className="label">Team
                <input className="input inputReadOnly" value={editForm.team} readOnly required />
              </label>
              <label className="label">Opponent Team
                <input className="input inputReadOnly" value={editForm.opponentTeam} readOnly required />
              </label>
              {teamEditUsesHoles ? (
                <>
                  <div>
                    <label className="label">{teamLabel} Score</label>
                    <button type="button" className="teamScorecardOpenButton teamScorecardInputButton" onClick={() => setActiveEditScorecardSide('team')}>
                      <span className="teamScorecardInputBadge">Tap to edit score</span>
                      <strong>Score input for {teamLabel}</strong>
                      <span>{editTeamScoreTotal || editForm.teamTotal || 'No score'} strokes</span>
                      <span>Open hole-by-hole scoring</span>
                    </button>
                  </div>
                  <div>
                    <label className="label">{opponentLabel} Score</label>
                    <button type="button" className="teamScorecardOpenButton teamScorecardInputButton" onClick={() => setActiveEditScorecardSide('opponent')}>
                      <span className="teamScorecardInputBadge">Tap to edit score</span>
                      <strong>Score input for {opponentLabel}</strong>
                      <span>{editOpponentScoreTotal || editForm.opponentTotal || 'No score'} strokes</span>
                      <span>Open hole-by-hole scoring</span>
                    </button>
                  </div>
                  <div className="soloLockedRoundSummary teamLockedRoundSummary roundDetailEditReadonlySummary">
                    <div>
                      <span>Team score</span>
                      <strong>{editTeamScoreTotal}</strong>
                    </div>
                    <div>
                      <span>Opponent score</span>
                      <strong>{editOpponentScoreTotal}</strong>
                    </div>
                    <div>
                      <span>Result</span>
                      <strong>{editTeamResult}</strong>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <label className="label">Team Score
                    <input className="input" type="number" min="0" value={editForm.teamTotal} onChange={(event) => updateEditField('teamTotal', event.target.value)} required />
                  </label>
                  <label className="label">Opponent Score
                    <input className="input" type="number" min="0" value={editForm.opponentTotal} onChange={(event) => updateEditField('opponentTotal', event.target.value)} required />
                  </label>
                </>
              )}
            </>
          )}
        </div>
        <div className="roundDetailEditActions">
          <button type="submit" className="btnPrimary btnSmall" disabled={isSavingEdit}>{isSavingEdit ? 'Saving…' : 'Save Changes'}</button>
          <button type="button" className="btn btnSmall" onClick={resetEditState} disabled={isSavingEdit}>Cancel Edit</button>
        </div>
      </form>

    </>
  )

  const fullViewportEditScorecard = activeEditScorecardSide ? (
    <div
      className="modalOverlay teamScorecardModalOverlay roundDetailEditScorecardOverlay"
      data-round-edit-viewport="full"
      role="presentation"
      onClick={() => { void closeActiveEditScorecard('round_detail_scorecard_overlay_close') }}
    >
      <div
        className="modalCard teamScorecardModalCard roundDetailEditScorecardCard"
        role="dialog"
        aria-modal="true"
        aria-label={activeEditScorecardSide === 'solo' ? 'Solo round edit hole-by-hole scorecard' : activeEditScorecardSide === 'team' ? `${teamLabel} edit hole-by-hole scorecard` : `${opponentLabel} edit hole-by-hole scorecard`}
        onClick={(event) => event.stopPropagation()}
      >
        <HoleByHoleScorecard
          enabled={true}
          loadScorecardOnMount={!(activeEditScorecardSide === 'solo' ? editSoloHoles : activeEditScorecardSide === 'team' ? editTeamHoles : editOpponentHoles).some((hole) => hasSavedHoleScoreValue(hole))}
          stateCode={editForm.state}
          course={editForm.course}
          courseId={String((round as any).courseId || (round as any).course_id || '') || null}
          holes={activeEditScorecardSide === 'solo' ? editSoloHoles : activeEditScorecardSide === 'team' ? editTeamHoles : editOpponentHoles}
          onChange={activeEditScorecardSide === 'solo' ? setEditSoloHoles : activeEditScorecardSide === 'team' ? setEditTeamHoles : setEditOpponentHoles}
          onHoleSaved={handleEditHoleSaved}
          teeColor={roundTeeColor}
          scoreOwnerLabel={activeEditScorecardSide === 'solo' ? 'Solo round score' : activeEditScorecardSide === 'team' ? `${teamLabel} score` : `${opponentLabel} score`}
          draftContext={activeEditScorecardSide === 'solo'
            ? { mode: 'solo', date: editForm.date }
            : { mode: 'team', date: editForm.date, team: editForm.team, opponentTeam: editForm.opponentTeam, scoringSide: activeEditScorecardSide }}
          compactMobileInput
          registerPendingHoleSave={(handler) => { pendingEditHoleSaveRef.current = handler }}
        />
        {actionError ? <div className="roundDetailActionError roundDetailEditScorecardError" role="alert">{actionError}</div> : null}
        <div className="holeInputModalFooter roundDetailEditScorecardFooter">
          {displayMode === 'team' ? (
            <div className="roundDetailEditScorecardSwitches" aria-label="Team scorecard selection">
              <button type="button" className={activeEditScorecardSide === 'team' ? 'btnPrimary btnSmall' : 'btn btnSmall'} disabled={isClosingEditScorecard || activeEditScorecardSide === 'team'} onClick={() => { void switchActiveEditScorecardSide('team') }}>{teamLabel}</button>
              <button type="button" className={activeEditScorecardSide === 'opponent' ? 'btnPrimary btnSmall' : 'btn btnSmall'} disabled={isClosingEditScorecard || activeEditScorecardSide === 'opponent'} onClick={() => { void switchActiveEditScorecardSide('opponent') }}>{opponentLabel}</button>
            </div>
          ) : <span className="small">Round changes save as each hole is completed.</span>}
          <button type="button" className="btn btnSmall" disabled={isClosingEditScorecard} onClick={() => { void closeActiveEditScorecard('round_detail_scorecard_close_button') }}>{isClosingEditScorecard ? 'Closing…' : 'Close'}</button>
        </div>
      </div>
    </div>
  ) : null

  if (fullViewportEditScorecard && typeof document !== 'undefined') {
    return createPortal(fullViewportEditScorecard, document.body)
  }

  return (
    <div className="modalOverlay" role="presentation" onClick={() => { void handleParentClose() }}>
      <div className="modalCard" role="dialog" aria-modal="true" aria-labelledby="round-detail-title" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h3 id="round-detail-title" style={{ margin: '4px 0 0' }}>{round.course}</h3>
            <div className="small" style={{ marginTop: 4 }}>
              {formatFriendlyDate(round.date)} • {String((round as any).state || '').toUpperCase()} • {roundTypeLabel}
            </div>
          </div>
          <div className="roundDetailHeaderActions">
            {!isTeamChallengeRound ? (
              <>
                <button type="button" className="btn btnSmall" onClick={() => { if (isEditing) resetEditState(); else beginHoleByHoleEdit() }}>{isEditing ? 'Cancel Edit' : 'Edit'}</button>
                <button type="button" className="btn btnSmall btnDanger" onClick={handleDeleteRound} disabled={isDeleting}>{isDeleting ? 'Deleting…' : 'Delete'}</button>
              </>
            ) : null}
            <button type="button" className="btn btnSmall" onClick={() => { void handleParentClose() }} disabled={isSavingEdit || isClosingEditScorecard}>{isEditing && isSavingEdit ? 'Saving…' : 'Close'}</button>
          </div>
        </div>

        {actionError ? <div className="roundDetailActionError" role="alert">{actionError}</div> : null}

        <div className={showInsightPanel ? 'detailGrid' : 'detailGrid detailGrid--single'} style={{ marginTop: 14 }}>
          <div className="card detailPanel">
            {isEditing ? editPanel : displayMode === 'team' ? (
              <div className="detailList" style={{ marginTop: 10 }}>
                {isTeamChallengeRound && detailView !== 'round' ? (
                  <div>
                    <button type="button" className="roundDetailCompareTeamsLink" onClick={() => selectTeamDetailView('round', 'compare_teams_link')}>Compare Teams</button>
                  </div>
                ) : null}
                <div><strong>Team:</strong> {renderTeamSummaryValue(teamLabel, canOpenTeamScoreView, showingTeamHoles, () => selectTeamDetailView('team', 'team_name_link'))}</div>
                <div><strong>Opponent:</strong> {renderTeamSummaryValue(opponentLabel, canOpenOpponentScoreView, showingOpponentHoles, () => selectTeamDetailView('opponent', 'opponent_name_link'))}</div>
                <div><strong>Score:</strong> {detailTeamScore}</div>
                <div><strong>Result:</strong> {detailTeamResult}</div>
                <div><strong>Logged at:</strong> {formatFriendlyDateTime((round as any).createdAt)}</div>
                {incompleteStatus.incomplete ? <div><strong>Status:</strong> Incomplete round</div> : null}
                {isTeamChallengeRound ? (
                  <div>
                    {showingOpponentHoles ? (
                      <>
                        <strong>{opponentLabel} hole detail:</strong> {opponentHoles.length ? `Cumulative score ${opponentHoleScoreTotal}` : 'No hole-by-hole detail saved'}
                        {opponentHoles.length ? renderHoleDetails(opponentHoles) : null}
                      </>
                    ) : showingTeamHoles ? (
                      <>
                        <strong>{teamLabel} hole detail:</strong> {holes.length ? `Cumulative score ${holeScoreTotal}` : 'No hole-by-hole detail saved'}
                        {holes.length ? renderHoleDetails(holes) : null}
                      </>
                    ) : canShowTeamComparison ? (
                      <>
                        <strong>Hole-by-hole comparison:</strong> {teamLabel} {holeScoreTotal} • {opponentLabel} {opponentHoleScoreTotal}
                        {renderTeamHoleComparison(holes, opponentHoles, teamLabel, opponentLabel, round)}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="detailList" style={{ marginTop: 10 }}>
                <div><strong>Score:</strong> {(round as any).roundScore}</div>
                <div><strong>Logged at:</strong> {formatFriendlyDateTime((round as any).createdAt)}</div>
                {incompleteStatus.incomplete ? <div><strong>Status:</strong> Incomplete round</div> : null}
                <div>
                  <strong>Hole detail:</strong> {holes.length ? `Cumulative score ${holeScoreTotal}` : 'No hole-by-hole detail saved'}
                  {holes.length ? renderHoleDetails(holes) : null}
                </div>
              </div>
            )}
          </div>

          {showInsightPanel ? (
            <div className="card detailPanel">
              <div className="small">How this round compares</div>
              <div style={{ marginTop: 10, lineHeight: 1.55 }}>{insight}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
