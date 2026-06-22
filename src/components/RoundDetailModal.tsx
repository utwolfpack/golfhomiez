import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { HoleScoreDetail, ScoreEntry } from '../types'
import { compareRoundToHistory } from '../lib/roundInsights'
import { formatFriendlyDateTime } from '../lib/time-format'
import { formatHoleScoreOutcome, holeScoreTotal as calculateClientHoleScoreTotal, missingHoleScoreNumbers, normalizeHoleScorecard, scoreOutcomeClassName } from '../lib/hole-scorecard'
import { normalizeTeeColor, teeColorLabel } from '../lib/tee-colors'
import { getIncompleteRoundStatus } from '../lib/round-status'
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

function normalizeDisplayHoles(input: unknown): DisplayHoleScore[] {
  const parsedInput = parseHoleInput(input)
  return Array.isArray(parsedInput)
    ? parsedInput
        .map((value: unknown, index: number) => {
          if (typeof value === 'number') return { hole: index + 1, score: value, par: null, yards: null, strokeIndex: null }
          const record = value as Record<string, unknown>
          const explicitProvided = Object.prototype.hasOwnProperty.call(record, 'scoreProvided') || Object.prototype.hasOwnProperty.call(record, 'score_provided')
          const providedValue = record.scoreProvided ?? record.score_provided
          const provided = explicitProvided ? (providedValue === true || providedValue === 1 || providedValue === '1' || providedValue === 'true') : Number.isFinite(Number(record.score))
          const score = Number(record.score)
          return {
            hole: Number(record.hole) || index + 1,
            score: provided && Number.isFinite(score) ? score : null,
            par: Number.isFinite(Number(record.par)) ? Number(record.par) : null,
            yards: Number.isFinite(Number(record.yards)) ? Number(record.yards) : null,
            strokeIndex: Number.isFinite(Number(record.strokeIndex ?? record.stroke_index)) ? Number(record.strokeIndex ?? record.stroke_index) : null,
            teeColor: normalizeTeeColor(record.teeColor ?? record.tee_color),
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

function providedHoleScoreTotal(holes: HoleScoreDetail[]) {
  return holes
    .filter((hole) => hole.scoreProvided)
    .reduce((sum, hole) => sum + (Number.isFinite(hole.score) ? hole.score : 0), 0)
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

function renderHoleDetails(holes: DisplayHoleScore[], ownerLabel?: string) {
  return (
    <div className="roundHoleDetailGrid" style={{ marginTop: 8 }}>
      {holes.map((hole) => {
        const outcome = holeOutcome(hole)
        return (
          <div key={hole.hole} className={`roundHoleDetailPill ${outcome.outcomeClass}`}>
            {ownerLabel ? <span className="roundHoleDetailOwner">{ownerLabel}</span> : null}
            <strong>Hole {hole.hole}</strong>
            <span>Par {hole.par || '—'} • {hole.yards || '—'} yds</span>
            <span className="roundHoleDetailScore">{outcome.outcome}</span>
          </div>
        )
      })}
    </div>
  )
}

function renderComparisonScoreCell(hole: DisplayHoleScore | undefined, label: string) {
  const outcome = holeOutcome(hole)
  return (
    <div className={`roundHoleCompareCell ${outcome.outcomeClass}`}>
      <span className="roundHoleCompareLabel" title={label}>{label}</span>
      <span className="roundHoleCompareOutcome">{outcome.outcome}</span>
      <span className="roundHoleCompareStrokes">{outcome.strokes}</span>
    </div>
  )
}

function renderTeamHoleComparison(teamHoles: DisplayHoleScore[], opponentHoles: DisplayHoleScore[], teamLabel: string, opponentLabel: string) {
  const teamByHole = new Map(teamHoles.map((hole) => [hole.hole, hole]))
  const opponentByHole = new Map(opponentHoles.map((hole) => [hole.hole, hole]))
  const holeNumbers = Array.from(new Set([...teamByHole.keys(), ...opponentByHole.keys()])).sort((left, right) => left - right)

  if (!holeNumbers.length) return null

  return (
    <div className="roundHoleCompareGrid" style={{ marginTop: 10 }}>
      {holeNumbers.map((holeNumber) => {
        const teamHole = teamByHole.get(holeNumber)
        const opponentHole = opponentByHole.get(holeNumber)
        const detailHole = teamHole || opponentHole
        return (
          <div key={holeNumber} className="roundHoleCompareRow">
            <div className="roundHoleCompareMeta">
              <strong>Hole {holeNumber}</strong>
              <span>Par {detailHole?.par || '—'} • {detailHole?.yards || '—'} yds</span>
            </div>
            <div className="roundHoleCompareScores">
              {renderComparisonScoreCell(teamHole, teamLabel)}
              <span className="roundHoleCompareVs">vs</span>
              {renderComparisonScoreCell(opponentHole, opponentLabel)}
            </div>
          </div>
        )
      })}
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
  const teamEditUsesHoles = displayMode === 'team' && (holes.length > 0 || opponentHoles.length > 0)
  const editTeamMissingHoles = missingHoleScoreNumbers(editTeamHoles)
  const editOpponentMissingHoles = missingHoleScoreNumbers(editOpponentHoles)
  const editTeamScoreTotal = editTeamMissingHoles.length ? providedHoleScoreTotal(editTeamHoles) : calculateClientHoleScoreTotal(editTeamHoles)
  const editOpponentScoreTotal = editOpponentMissingHoles.length ? providedHoleScoreTotal(editOpponentHoles) : calculateClientHoleScoreTotal(editOpponentHoles)
  const editTeamResult = teamEditResult(editTeamScoreTotal, editOpponentScoreTotal)
  const canOpenTeamScoreView = displayMode === 'team'
  const canOpenOpponentScoreView = displayMode === 'team'
  const showingTeamHoles = displayMode === 'team' && detailView === 'team'
  const showingOpponentHoles = displayMode === 'team' && detailView === 'opponent'
  const detailTeamScore = `${(round as any).teamTotal == null ? 'Pending' : (round as any).teamTotal} - ${(round as any).opponentTotal == null ? 'Pending' : (round as any).opponentTotal}`
  const detailTeamResult = (round as any).teamTotal == null || (round as any).opponentTotal == null ? 'Pending' : ((round as any).won === true ? 'Win' : (round as any).won === false ? 'Loss' : 'Tie')
  const insight = isTeamChallengeRound ? 'This Team Challenge score record is maintained from the Challenges page Team Challenges section.' : compareRoundToHistory({ ...(round as any), mode: displayMode }, allScores as any)
  const showInsightPanel = !(isEditing && displayMode === 'solo')
  const incompleteStatus = getIncompleteRoundStatus(round)

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
    const nextSoloScoreTotal = nextSoloMissingHoles.length ? providedHoleScoreTotal(nextSoloHoles) : calculateClientHoleScoreTotal(nextSoloHoles)
    const nextTeamScoreTotal = nextTeamMissingHoles.length ? providedHoleScoreTotal(nextTeamHoles) : calculateClientHoleScoreTotal(nextTeamHoles)
    const nextOpponentScoreTotal = nextOpponentMissingHoles.length ? providedHoleScoreTotal(nextOpponentHoles) : calculateClientHoleScoreTotal(nextOpponentHoles)

    return displayMode === 'solo'
      ? {
          mode: 'solo',
          date: editForm.date,
          state: editForm.state,
          course: editForm.course,
          roundScore: soloEditUsesHoles ? nextSoloScoreTotal : Number(editForm.roundScore),
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
          teamTotal: teamEditUsesHoles ? nextTeamScoreTotal : Number(editForm.teamTotal),
          opponentTotal: teamEditUsesHoles ? nextOpponentScoreTotal : Number(editForm.opponentTotal),
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

  const closeActiveEditScorecard = async (source = 'round_detail_scorecard_close_button') => {
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
      logFrontendEvent({ category: 'round.detail.edit_scorecard.close', message: 'succeeded', data: { correlationId, scoreId: String((round as any).id || ''), side, source, pendingHoleSaved: pendingSaveResult.saved, pendingHole: pendingSaveResult.hole, providedHoleNumbers: pendingSaveResult.providedHoleNumbers } })
    } catch (error: any) {
      const message = error?.message || 'Could not save the current hole score before closing.'
      setActionError(message)
      logFrontendEvent({ category: 'round.detail.edit_scorecard.close', level: 'error', message: 'failed', data: { correlationId, scoreId: String((round as any).id || ''), side, source, error: message } })
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

      {activeEditScorecardSide ? (
        <div className="modalOverlay teamScorecardModalOverlay" role="presentation" onClick={() => { void closeActiveEditScorecard('round_detail_scorecard_overlay_close') }}>
          <div
            className="modalCard teamScorecardModalCard"
            role="dialog"
            aria-modal="true"
            aria-label={activeEditScorecardSide === 'solo' ? 'Solo round edit hole-by-hole scorecard' : activeEditScorecardSide === 'team' ? `${teamLabel} edit hole-by-hole scorecard` : `${opponentLabel} edit hole-by-hole scorecard`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="teamScorecardModalHeader">
              <div>
                <div className="small">Edit hole-by-hole score input</div>
                <h2>{activeEditScorecardSide === 'solo' ? 'Solo Round Score' : activeEditScorecardSide === 'team' ? `${teamLabel} Score` : `${opponentLabel} Score`}</h2>
              </div>
              <button type="button" className="btn btnSmall" disabled={isClosingEditScorecard} onClick={() => { void closeActiveEditScorecard('round_detail_scorecard_close_button') }}>{isClosingEditScorecard ? 'Saving…' : 'Save & Close'}</button>
            </div>
            <HoleByHoleScorecard
              enabled={true}
              loadScorecardOnMount={false}
              stateCode={editForm.state}
              course={editForm.course}
              holes={activeEditScorecardSide === 'solo' ? editSoloHoles : activeEditScorecardSide === 'team' ? editTeamHoles : editOpponentHoles}
              onChange={activeEditScorecardSide === 'solo' ? setEditSoloHoles : activeEditScorecardSide === 'team' ? setEditTeamHoles : setEditOpponentHoles}
              onHoleSaved={handleEditHoleSaved}
              teeColor={roundTeeColor}
              scoreOwnerLabel={activeEditScorecardSide === 'solo' ? 'Solo round score' : activeEditScorecardSide === 'team' ? `${teamLabel} score` : `${opponentLabel} score`}
              registerPendingHoleSave={(handler) => { pendingEditHoleSaveRef.current = handler }}
            />
          </div>
        </div>
      ) : null}
    </>
  )

  return (
    <div className="modalOverlay" role="presentation" onClick={() => { void handleParentClose() }}>
      <div className="modalCard" role="dialog" aria-modal="true" aria-labelledby="round-detail-title" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h3 id="round-detail-title" style={{ margin: '4px 0 0' }}>{round.course}</h3>
            <div className="small" style={{ marginTop: 4 }}>
              {formatFriendlyDateTime(round.date)} • {String((round as any).state || '').toUpperCase()} • {roundTypeLabel} • {roundTeeLabel} tees
            </div>
            {incompleteStatus.incomplete ? <div className="roundIncompleteBadge roundDetailIncompleteBadge">Incomplete round • {incompleteStatus.label}</div> : null}
          </div>
          <div className="roundDetailHeaderActions">
            {!isTeamChallengeRound ? (
              <>
                <button type="button" className="btn btnSmall" onClick={() => { if (isEditing) resetEditState(); else { setIsEditing(true); setActionError(null); setActiveEditScorecardSide(null); setEditForm(buildRoundEditForm(round)); setEditSoloHoles(buildEditableHoleScores(round, ['holes', 'holes_json', 'holeScores', 'hole_scores_json'])); setEditTeamHoles(buildEditableHoleScores(round, ['holes', 'holes_json', 'holeScores', 'hole_scores_json'])); setEditOpponentHoles(buildEditableHoleScores(round, ['opponentHoles', 'opponent_holes_json', 'opponent_holes', 'opponentHoleScores', 'opponent_hole_scores_json'])); } }}>{isEditing ? 'Cancel Edit' : 'Edit'}</button>
                <button type="button" className="btn btnSmall btnDanger" onClick={handleDeleteRound} disabled={isDeleting}>{isDeleting ? 'Deleting…' : 'Delete'}</button>
              </>
            ) : null}
            <button type="button" className="btn btnSmall" onClick={() => { void handleParentClose() }} disabled={isSavingEdit || isClosingEditScorecard}>{isEditing && isSavingEdit ? 'Saving…' : 'Close'}</button>
          </div>
        </div>

        {actionError ? <div className="roundDetailActionError" role="alert">{actionError}</div> : null}

        <div className="detailGrid" style={{ marginTop: 14 }}>
          <div className="card detailPanel">
            {isEditing ? editPanel : displayMode === 'team' ? (
              <div className="detailList" style={{ marginTop: 10 }}>
                <div><strong>Team:</strong> {renderTeamSummaryValue(teamLabel, canOpenTeamScoreView, showingTeamHoles, () => setDetailView('team'))}</div>
                <div><strong>Opponent:</strong> {renderTeamSummaryValue(opponentLabel, canOpenOpponentScoreView, showingOpponentHoles, () => setDetailView('opponent'))}</div>
                <div><strong>Score:</strong> {detailTeamScore}</div>
                <div><strong>Tees:</strong> {roundTeeLabel}</div>
                <div><strong>Result:</strong> {detailTeamResult}</div>
                <div><strong>Logged at:</strong> {formatFriendlyDateTime((round as any).createdAt)}</div>
                <div>
                  {showingOpponentHoles ? (
                    <>
                      <strong>{opponentLabel} hole detail:</strong> {opponentHoles.length ? `Cumulative score ${opponentHoleScoreTotal}` : 'No hole-by-hole detail saved'}
                      {opponentHoles.length ? renderHoleDetails(opponentHoles, opponentLabel) : null}
                    </>
                  ) : showingTeamHoles ? (
                    <>
                      <strong>{teamLabel} hole detail:</strong> {holes.length ? `Cumulative score ${holeScoreTotal}` : 'No hole-by-hole detail saved'}
                      {holes.length ? renderHoleDetails(holes, teamLabel) : null}
                    </>
                  ) : canShowTeamComparison ? (
                    <>
                      <strong>Hole-by-hole comparison:</strong> {teamLabel} {holeScoreTotal} • {opponentLabel} {opponentHoleScoreTotal}
                      {renderTeamHoleComparison(holes, opponentHoles, teamLabel, opponentLabel)}
                    </>
                  ) : (
                    <>
                      <strong>{teamLabel} hole detail:</strong> {holes.length ? `Cumulative score ${holeScoreTotal}` : 'No hole-by-hole detail saved'}
                      {holes.length ? renderHoleDetails(holes, teamLabel) : null}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="detailList" style={{ marginTop: 10 }}>
                <div><strong>Score:</strong> {(round as any).roundScore}</div>
                <div><strong>Tees:</strong> {roundTeeLabel}</div>
                <div><strong>Logged by:</strong> {(round as any).createdByEmail || 'Unknown user'}</div>
                <div><strong>Logged at:</strong> {formatFriendlyDateTime((round as any).createdAt)}</div>
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
