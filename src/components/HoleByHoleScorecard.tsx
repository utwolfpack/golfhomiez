import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import {
  buildClientDefaultHoleScorecard,
  formatHoleScoreOutcome,
  holeParTotal,
  providedHoleScoreTotal,
  mergeProvidedHoleScores,
  missingHoleScoreNumbers,
  normalizeHoleScorecard,
  updateHoleScore,
} from '../lib/hole-scorecard'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'
import { loadSavedLocation } from '../lib/location-store'
import type { HoleScoreDetail } from '../types'
import { normalizeTeeColor, teeColorLabel, type TeeColor } from '../lib/tee-colors'

type ScorecardResponse = {
  source: string
  state: string
  course: string
  courseId?: string | null
  teeColor?: TeeColor | string | null
  availableTeeColors?: string[]
  holes: HoleScoreDetail[]
  parTotal: number
  scoreTotal: number
}

type ScorecardDraftResponse = {
  holes: HoleScoreDetail[]
  holeCount: number
}

type DraftContext = {
  mode: 'solo' | 'team'
  date: string
  team?: string
  opponentTeam?: string
  scoringSide?: 'team' | 'opponent'
}

export type PendingHoleScoreSaveResult = {
  saved: boolean
  hole: number | null
  providedHoleNumbers: number[]
  holes?: HoleScoreDetail[]
  error?: string
}

export type PendingHoleScoreSaveHandler = (source?: string) => Promise<PendingHoleScoreSaveResult>

type Props = {
  enabled: boolean
  stateCode: string
  course: string
  courseId?: string | null
  holes: HoleScoreDetail[]
  onChange: (holes: HoleScoreDetail[]) => void
  onHoleSaved?: (holes: HoleScoreDetail[], savedHole: HoleScoreDetail) => void | Promise<unknown>
  draftContext?: DraftContext
  scoreOwnerLabel?: string
  loadScorecardOnMount?: boolean
  compactMobileInput?: boolean
  teeColor?: TeeColor | string
  persistedHoles?: HoleScoreDetail[] | null
  registerPendingHoleSave?: (handler: PendingHoleScoreSaveHandler | null) => void
}

type ScorePreset = {
  key: string
  label: string
  className: string
  getScore: (par: number | null) => number
}

function getPlayablePar(par: number | null) {
  const value = Number(par)
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 4
}

const SCORE_PRESETS: ScorePreset[] = [
  { key: 'birdie', label: 'Birdie', className: 'holeInputPreset--birdie', getScore: (par) => Math.max(1, getPlayablePar(par) - 1) },
  { key: 'par', label: 'Par', className: 'holeInputPreset--par', getScore: (par) => getPlayablePar(par) },
  { key: 'bogey', label: 'Bogey', className: 'holeInputPreset--bogey', getScore: (par) => getPlayablePar(par) + 1 },
  { key: 'double-bogey', label: 'Double-Bogey', className: 'holeInputPreset--doubleBogey', getScore: (par) => getPlayablePar(par) + 2 },
]

function getSafeHole(holes: HoleScoreDetail[], index: number, stateCode: string, course: string, teeColor: TeeColor | string = 'white') {
  return holes[index] || buildClientDefaultHoleScorecard(stateCode, course, teeColor)[Math.max(0, Math.min(17, index))]
}

function getHoleByNumber(holes: HoleScoreDetail[], holeNumber: number) {
  return holes.find((hole) => hole.hole === holeNumber) || null
}

function getScorecardHoleCount(holes: HoleScoreDetail[]) {
  if (!Array.isArray(holes) || holes.length === 0) return 18
  const highestHoleNumber = holes.reduce((max, hole) => {
    const holeNumber = Number(hole?.hole)
    return Number.isFinite(holeNumber) && holeNumber > max ? Math.trunc(holeNumber) : max
  }, 0)
  const count = Math.max(holes.length, highestHoleNumber || 0)
  return Math.max(1, Math.min(18, count || 18))
}

function withSelectedTeeColor(holes: HoleScoreDetail[], selectedTeeColor: TeeColor): HoleScoreDetail[] {
  return holes.map((hole) => ({
    ...hole,
    teeColor: selectedTeeColor,
    teeBoxType: selectedTeeColor,
  }))
}

function buildDraftSearchParams(stateCode: string, course: string, draftContext?: DraftContext) {
  if (!draftContext?.mode || !draftContext.date || !stateCode || !course) return null
  const params = new URLSearchParams({
    mode: draftContext.mode,
    date: draftContext.date,
    state: stateCode,
    course,
    scoringSide: draftContext.scoringSide || 'team',
  })
  if (draftContext.team) params.set('team', draftContext.team)
  if (draftContext.opponentTeam) params.set('opponentTeam', draftContext.opponentTeam)
  return params
}

function getScoreOrPar(hole: HoleScoreDetail) {
  return Number.isFinite(hole.score) ? hole.score : getPlayablePar(hole.par)
}


function hasDisplayablePositiveNumber(value: unknown) {
  if (value == null || value === '') return false
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0
}

function formatYardage(value: number | null | undefined) {
  if (!hasDisplayablePositiveNumber(value)) return ''
  return String(Math.round(Number(value)))
}

function getRoundTypeLabel(draftContext?: DraftContext, scoreOwnerLabel?: string) {
  if (draftContext?.mode === 'solo') return 'Solo Round'
  if (draftContext?.mode === 'team') {
    const teamName = draftContext.scoringSide === 'opponent'
      ? draftContext.opponentTeam
      : draftContext.team
    const fallbackName = scoreOwnerLabel ? scoreOwnerLabel.replace(/\s+score$/i, '') : ''
    const displayName = String(teamName || fallbackName || '').trim()
    return displayName ? `Team Round • ${displayName}` : 'Team Round'
  }
  return ''
}

function findNextUnscoredHoleIndex(holes: HoleScoreDetail[], savedHoleNumber: number) {
  if (!Array.isArray(holes) || holes.length === 0) return null

  const activeHoleCount = getScorecardHoleCount(holes)
  const parsedSavedHoleNumber = Number(savedHoleNumber)
  const normalizedSavedHoleNumber = Number.isFinite(parsedSavedHoleNumber)
    ? Math.max(1, Math.min(activeHoleCount, Math.trunc(parsedSavedHoleNumber)))
    : 1

  const getMissingHoleIndex = (holeNumber: number) => {
    const holeIndex = holes.findIndex((candidate) => Number(candidate?.hole) === holeNumber)
    if (holeIndex < 0) return null
    return holes[holeIndex]?.scoreProvided ? null : holeIndex
  }

  for (let holeNumber = normalizedSavedHoleNumber + 1; holeNumber <= activeHoleCount; holeNumber += 1) {
    const missingHoleIndex = getMissingHoleIndex(holeNumber)
    if (missingHoleIndex != null) return missingHoleIndex
  }

  for (let holeNumber = 1; holeNumber < normalizedSavedHoleNumber; holeNumber += 1) {
    const missingHoleIndex = getMissingHoleIndex(holeNumber)
    if (missingHoleIndex != null) return missingHoleIndex
  }

  return null
}


function getProvidedHoleNumbers(holes: HoleScoreDetail[]) {
  return holes
    .filter((hole) => hole.scoreProvided)
    .map((hole) => hole.hole)
    .filter((holeNumber) => Number.isFinite(holeNumber))
}

export default function HoleByHoleScorecard({ enabled, stateCode, course, courseId = null, holes, onChange, onHoleSaved, draftContext, scoreOwnerLabel, loadScorecardOnMount = true, compactMobileInput = false, teeColor = 'white', persistedHoles = null, registerPendingHoleSave }: Props) {
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeHoleIndex, setActiveHoleIndex] = useState(0)
  const [activeScore, setActiveScore] = useState(4)
  const [savingHole, setSavingHole] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [activeScoreDirty, setActiveScoreDirty] = useState(false)
  const selectedTeeColor = normalizeTeeColor(teeColor)
  const persistedHolesRef = useRef<HoleScoreDetail[] | null>(persistedHoles)
  persistedHolesRef.current = persistedHoles
  const latestPendingStateRef = useRef({
    enabled,
    holes,
    activeHole: getSafeHole(holes, activeHoleIndex, stateCode, course, selectedTeeColor),
    activeScore,
    activeScoreDirty,
    providedHoleNumbers: [] as number[],
  })

  const parTotal = useMemo(() => holeParTotal(holes), [holes])
  const currentScoreTotal = useMemo(() => providedHoleScoreTotal(holes), [holes])
  const missingNumbers = useMemo(() => missingHoleScoreNumbers(holes), [holes])
  const activeHole = getSafeHole(holes, activeHoleIndex, stateCode, course, selectedTeeColor)
  const activeHoleCount = useMemo(() => getScorecardHoleCount(holes), [holes])
  const trackerHoles = useMemo(() => Array.from({ length: activeHoleCount }, (_, index) => {
    const holeNumber = index + 1
    const hole = getHoleByNumber(holes, holeNumber)
    return { holeNumber, scoreProvided: Boolean(hole?.scoreProvided) }
  }), [holes, activeHoleCount])
  const providedCount = trackerHoles.filter((hole) => hole.scoreProvided).length
  const providedHoleNumbers = useMemo(() => trackerHoles.filter((hole) => hole.scoreProvided).map((hole) => hole.holeNumber), [trackerHoles])

  latestPendingStateRef.current = {
    enabled,
    holes,
    activeHole,
    activeScore,
    activeScoreDirty,
    providedHoleNumbers,
  }

  const draftParams = useMemo(
    () => buildDraftSearchParams(stateCode, course, draftContext),
    [stateCode, course, draftContext?.mode, draftContext?.date, draftContext?.team, draftContext?.opponentTeam, draftContext?.scoringSide],
  )

  useEffect(() => {
    if (!enabled || !loadScorecardOnMount) return

    let cancelled = false
    const correlationId = getCorrelationId()

    async function loadScorecard() {
      setLoading(true)
      setLoadError(null)
      setSaveStatus(null)
      logFrontendEvent({ category: 'scorecard.load', message: 'started', data: { correlationId, stateCode, course, courseId, teeColor: selectedTeeColor, draftContext } })

      try {
        let nextHoles: HoleScoreDetail[]
        let source = 'generated-defaults'
        let responseParTotal = 0

        if (!stateCode || !course) {
          nextHoles = buildClientDefaultHoleScorecard(stateCode, course, selectedTeeColor)
          responseParTotal = holeParTotal(nextHoles)
        } else {
          const params = new URLSearchParams({ state: stateCode, course, teeColor: selectedTeeColor })
          if (courseId) params.set('courseId', courseId)
          const savedLocation = loadSavedLocation()
          if (savedLocation?.latitude && savedLocation?.longitude) {
            params.set('lat', String(savedLocation.latitude))
            params.set('lng', String(savedLocation.longitude))
          }
          const response = await api<ScorecardResponse>(`/api/golf-courses/scorecard?${params.toString()}`)
          if (cancelled) return
          nextHoles = withSelectedTeeColor(normalizeHoleScorecard(response.holes, stateCode, course, response.teeColor || selectedTeeColor), selectedTeeColor)
          source = response.source
          responseParTotal = response.parTotal
        }

        const latestPersistedHoles = persistedHolesRef.current
        if (Array.isArray(latestPersistedHoles) && latestPersistedHoles.length > 0) {
          nextHoles = mergeProvidedHoleScores(nextHoles, latestPersistedHoles)
        }

        if (draftParams) {
          try {
            const draft = await api<ScorecardDraftResponse>(`/api/scorecard-drafts?${draftParams.toString()}`)
            if (cancelled) return
            nextHoles = mergeProvidedHoleScores(nextHoles, draft.holes)
            if (draft.holeCount > 0) {
              setSaveStatus(`Restored ${draft.holeCount} saved hole ${draft.holeCount === 1 ? 'score' : 'scores'}.`)
            }
          } catch (draftError) {
            const message = draftError instanceof Error ? draftError.message : 'Could not restore saved hole scores.'
            logFrontendEvent({ category: 'scorecard.draft.load', level: 'warn', message: 'failed', data: { correlationId, stateCode, course, courseId, teeColor: selectedTeeColor, error: message } })
          }
        }

        nextHoles = withSelectedTeeColor(nextHoles, selectedTeeColor)
        const loadedProvidedHoleNumbers = getProvidedHoleNumbers(nextHoles)
        onChange(nextHoles)
        setActiveHoleIndex(0)
        logFrontendEvent({
          category: 'scorecard.load',
          message: 'succeeded',
          data: { correlationId, stateCode, course, courseId, teeColor: selectedTeeColor, source, parTotal: responseParTotal, holeCount: nextHoles.length, providedCount: loadedProvidedHoleNumbers.length, providedHoleNumbers: loadedProvidedHoleNumbers },
        })
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'Golf course scorecard data could not be loaded.'
        setLoadError(message)
        logFrontendEvent({ category: 'scorecard.load', level: 'error', message: 'failed', data: { correlationId, stateCode, course, teeColor: selectedTeeColor, error: message } })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadScorecard()
    return () => { cancelled = true }
  }, [enabled, loadScorecardOnMount, stateCode, course, courseId, selectedTeeColor, draftParams?.toString()])



  useEffect(() => {
    if (!Array.isArray(persistedHoles) || persistedHoles.length === 0) return
    const mergedHoles = withSelectedTeeColor(mergeProvidedHoleScores(holes, persistedHoles), selectedTeeColor)
    const mergedProvidedHoleNumbers = getProvidedHoleNumbers(mergedHoles)
    onChange(mergedHoles)
    logFrontendEvent({
      category: 'scorecard.persisted_holes.merge',
      message: 'merged_without_navigation_reset',
      data: {
        correlationId: getCorrelationId(),
        stateCode,
        course,
        courseId,
        teeColor: selectedTeeColor,
        providedCount: mergedProvidedHoleNumbers.length,
        providedHoleNumbers: mergedProvidedHoleNumbers,
        activeHole: activeHole.hole,
      },
    })
  }, [persistedHoles, selectedTeeColor])

  useEffect(() => {
    if (activeHoleIndex >= activeHoleCount && activeHoleCount > 0) setActiveHoleIndex(activeHoleCount - 1)
  }, [activeHoleIndex, activeHoleCount])

  useEffect(() => {
    setActiveScore(getScoreOrPar(activeHole))
    setActiveScoreDirty(false)
  }, [activeHole.hole])

  useEffect(() => {
    if (!activeScoreDirty) {
      setActiveScore(getScoreOrPar(activeHole))
    }
  }, [activeScoreDirty, activeHole.par, activeHole.score, activeHole.scoreProvided])

  async function saveHoleScore(hole: HoleScoreDetail, score: number, source: string, options: { throwOnError?: boolean; autoAdvanceAfterSave?: boolean } = {}, baseHoles: HoleScoreDetail[] = holes): Promise<PendingHoleScoreSaveResult> {
    const normalizedScore = Math.max(0, Math.trunc(score))
    const next = withSelectedTeeColor(updateHoleScore(baseHoles, hole.hole, normalizedScore), selectedTeeColor)
    const correlationId = getCorrelationId()
    const savedHoleNumbers = getProvidedHoleNumbers(next)

    const savedHole = {
      ...hole,
      teeColor: selectedTeeColor,
      teeBoxType: selectedTeeColor,
      score: normalizedScore,
      scoreProvided: true,
    }

    onChange(next)
    setSavingHole(true)
    setSaveStatus('Saving hole score…')
    logFrontendEvent({
      category: 'scorecard.hole.save',
      message: 'started',
      data: { correlationId, hole: hole.hole, score: normalizedScore, source, teeColor: savedHole.teeColor || selectedTeeColor, currentScore: providedHoleScoreTotal(next), providedCount: savedHoleNumbers.length, providedHoleNumbers: savedHoleNumbers, draftContext },
    })

    try {
      if (draftParams) {
        await api('/api/scorecard-drafts/hole', {
          method: 'PUT',
          body: JSON.stringify({
            mode: draftContext?.mode,
            date: draftContext?.date,
            state: stateCode,
            course,
            team: draftContext?.team || '',
            opponentTeam: draftContext?.opponentTeam || '',
            scoringSide: draftContext?.scoringSide || 'team',
            hole: savedHole,
          }),
        })
      }
      if (onHoleSaved) {
        await onHoleSaved(next, savedHole)
      }
      const remainingHoleCount = missingHoleScoreNumbers(next).length
      const nextUnscoredHoleIndex = options.autoAdvanceAfterSave ? findNextUnscoredHoleIndex(next, hole.hole) : null
      setActiveScoreDirty(false)
      const nextAutoAdvanceHole = nextUnscoredHoleIndex != null ? next[nextUnscoredHoleIndex]?.hole || nextUnscoredHoleIndex + 1 : null
      if (remainingHoleCount === 0) {
        setSaveStatus(`Hole ${hole.hole} saved. Complete round ready to log.`)
        logFrontendEvent({ category: 'scorecard.hole.auto_advance', message: 'round_complete', data: { correlationId, savedHole: hole.hole, remainingHoleCount, providedHoleNumbers: savedHoleNumbers } })
      } else if (nextUnscoredHoleIndex != null) {
        setActiveHoleIndex(nextUnscoredHoleIndex)
        setSaveStatus(`Hole ${hole.hole} saved. Moved to Hole ${nextAutoAdvanceHole}.`)
        logFrontendEvent({ category: 'scorecard.hole.auto_advance', message: 'next_unscored_hole_selected', data: { correlationId, savedHole: hole.hole, nextHole: nextAutoAdvanceHole, nextHoleIndex: nextUnscoredHoleIndex, remainingHoleCount, providedHoleNumbers: savedHoleNumbers } })
      } else {
        setSaveStatus(`Hole ${hole.hole} saved. Tap another hole circle to continue.`)
        logFrontendEvent({ category: 'scorecard.hole.auto_advance', message: 'no_unscored_hole_available', data: { correlationId, savedHole: hole.hole, remainingHoleCount, providedHoleNumbers: savedHoleNumbers } })
      }
      logFrontendEvent({
        category: 'scorecard.hole.save',
        message: 'succeeded',
        data: { correlationId, hole: hole.hole, score: normalizedScore, source, teeColor: savedHole.teeColor || selectedTeeColor, providedCount: savedHoleNumbers.length, providedHoleNumbers: savedHoleNumbers, remainingHoleCount, advancedAfterSave: nextUnscoredHoleIndex != null, nextHole: nextAutoAdvanceHole },
      })
      return { saved: true, hole: hole.hole, providedHoleNumbers: savedHoleNumbers, holes: next }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save this hole score.'
      setSaveStatus('Saved on this page, but database persistence failed. Try saving again before leaving.')
      logFrontendEvent({ category: 'scorecard.hole.save', level: 'error', message: 'failed', data: { correlationId, hole: hole.hole, score: normalizedScore, source, error: message } })
      if (options.throwOnError) throw error
      return { saved: false, hole: hole.hole, providedHoleNumbers: savedHoleNumbers, holes: next, error: message }
    } finally {
      setSavingHole(false)
    }
  }

  async function savePendingActiveHoleScore(source = 'pending_hole_score_flush'): Promise<PendingHoleScoreSaveResult> {
    const pendingState = latestPendingStateRef.current
    if (!pendingState.enabled) {
      return { saved: false, hole: null, providedHoleNumbers: pendingState.providedHoleNumbers, holes: pendingState.holes }
    }

    const pendingHole = pendingState.activeHole
    const currentHoleRecord = getHoleByNumber(pendingState.holes, pendingHole.hole)
    const hasSavedScore = Boolean(currentHoleRecord?.scoreProvided)
    const savedScore = Number(currentHoleRecord?.score)
    const normalizedActiveScore = Math.max(0, Math.trunc(pendingState.activeScore))
    const changedSavedScore = hasSavedScore && Number.isFinite(savedScore) && savedScore !== normalizedActiveScore

    if (!pendingState.activeScoreDirty && !changedSavedScore) {
      logFrontendEvent({
        category: 'scorecard.hole.pending_save',
        message: 'skipped',
        data: { correlationId: getCorrelationId(), hole: pendingHole.hole, source, reason: 'no_dirty_score_change', providedHoleNumbers: pendingState.providedHoleNumbers },
      })
      return { saved: false, hole: pendingHole.hole, providedHoleNumbers: pendingState.providedHoleNumbers, holes: pendingState.holes }
    }

    logFrontendEvent({
      category: 'scorecard.hole.pending_save',
      message: 'started',
      data: { correlationId: getCorrelationId(), hole: pendingHole.hole, score: normalizedActiveScore, source, activeScoreDirty: pendingState.activeScoreDirty, hasSavedScore, changedSavedScore, providedHoleNumbers: pendingState.providedHoleNumbers },
    })
    return saveHoleScore(pendingHole, normalizedActiveScore, source, { throwOnError: true }, pendingState.holes)
  }

  useLayoutEffect(() => {
    if (!registerPendingHoleSave) return
    if (!enabled) {
      registerPendingHoleSave(null)
      return
    }
    registerPendingHoleSave(savePendingActiveHoleScore)
    return () => registerPendingHoleSave(null)
  }, [registerPendingHoleSave, enabled, savePendingActiveHoleScore])

  async function goToHole(index: number, source = 'hole_navigation') {
    const targetIndex = Math.max(0, Math.min(activeHoleCount - 1, index))
    if (targetIndex === activeHoleIndex) return
    if (savingHole) return

    try {
      await savePendingActiveHoleScore(source)
      setSaveStatus(null)
      setActiveHoleIndex(targetIndex)
      logFrontendEvent({ category: 'scorecard.hole.navigate', message: 'selected', data: { correlationId: getCorrelationId(), fromHole: activeHole.hole, toHole: targetIndex + 1, source } })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save this hole score before changing holes.'
      setSaveStatus(message)
      logFrontendEvent({ category: 'scorecard.hole.navigate', level: 'error', message: 'failed', data: { correlationId: getCorrelationId(), fromHole: activeHole.hole, toHole: targetIndex + 1, source, error: message } })
    }
  }


  if (!enabled) return null

  const currentOutcome = formatHoleScoreOutcome({ par: activeHole.par, score: activeScore })
  const currentHoleProvided = Boolean(activeHole.scoreProvided)
  const activeHoleParLabel = activeHole.par ?? '—'
  const activeHoleTeeLabel = teeColorLabel(selectedTeeColor)
  const roundTypeLabel = getRoundTypeLabel(draftContext, scoreOwnerLabel)
  const holeContextItems = [
    { key: 'par', value: `Par ${activeHoleParLabel}`, emphasis: true },
    { key: 'course', value: course || 'Selected course', emphasis: true },
    { key: 'tees', value: `${activeHoleTeeLabel} tees`, subtle: false },
    hasDisplayablePositiveNumber(activeHole.yards) ? { key: 'yards', value: `${formatYardage(activeHole.yards)} Yards`, subtle: true } : null,
    hasDisplayablePositiveNumber(activeHole.strokeIndex) ? { key: 'strokeIndex', value: `Stroke Index ${Math.trunc(Number(activeHole.strokeIndex))}`, subtle: true } : null,
    draftContext?.date ? { key: 'date', value: draftContext.date, subtle: true } : null,
    roundTypeLabel ? { key: 'roundType', value: roundTypeLabel, subtle: false } : null,
  ].filter(Boolean) as Array<{ key: string; value: string; emphasis?: boolean; subtle?: boolean }>


  return (
    <div className={`card holeInputPanel ${compactMobileInput ? 'holeInputPanel--compact' : ''}`} style={{ marginTop: 16 }}>
      <section className={`holeInputPhone ${compactMobileInput ? 'holeInputPhone--compact' : ''}`} aria-label={`Score entry for hole ${activeHole.hole}`}>
        <div className={`holeInputScorePageCard ${compactMobileInput ? 'holeInputScorePageCard--compact' : ''}`}>
          <div className="holeInputScoreHeader">
            <span className="holeInputScoreHeaderSpacer" aria-hidden="true" />
            <div className="holeInputScoreLabel">Hole {activeHole.hole}</div>
            <span className="holeInputScoreHeaderSpacer" aria-hidden="true" />
          </div>
          {loadError ? <div className="small holeInputLoadWarning">golf course hole data could not be loaded. Try again or choose another course.</div> : null}
          <div className="holeInputContextText" aria-label="Hole and round details">
            {holeContextItems.map((item) => (
              <span
                key={item.key}
                className={`holeInputContextValue${item.emphasis ? ' holeInputContextValue--emphasis' : ''}${item.subtle ? ' holeInputContextValue--subtle' : ''}`}
              >
                {item.value}
              </span>
            ))}
          </div>
          <div className="scoreStepper holeInputPageStepper">
            <button type="button" className="btn holeInputStepperButton" aria-label="Decrease score" onClick={() => { setActiveScoreDirty(true); setActiveScore((score) => Math.max(0, score - 1)) }}>−</button>
            <div className="holeInputScoreValueBlock">
              <div className="scoreStepperValue" aria-live="polite">{activeScore}</div>
              <div className="holeInputOutcome" aria-live="polite">{currentOutcome}</div>
            </div>
            <button type="button" className="btn holeInputStepperButton" aria-label="Increase score" onClick={() => { setActiveScoreDirty(true); setActiveScore((score) => score + 1) }}>+</button>
          </div>

          <div className="holeInputPresetGrid" aria-label="Quick score presets">
            {SCORE_PRESETS.map((preset) => {
              const presetScore = preset.getScore(activeHole.par)
              return (
                <button
                  key={preset.key}
                  type="button"
                  className={`holeInputPreset ${preset.className}${activeScore === presetScore ? ' holeInputPreset--selected' : ''}`}
                  onClick={() => { setActiveScoreDirty(true); setActiveScore(presetScore) }}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            className="btnPrimary holeInputSaveButton"
            disabled={savingHole}
            onClick={() => saveHoleScore(activeHole, activeScore, 'dedicated_hole_page', { autoAdvanceAfterSave: true })}
          >
            {savingHole ? 'Saving…' : currentHoleProvided ? 'Update Hole Score' : 'Save Hole Score'}
          </button>
          {saveStatus ? <div className="small holeInputSaveStatus">{saveStatus}</div> : null}
        </div>

      </section>


      <div className="holeInputCompletionIndicator" aria-live="polite">
        <span className="holeInputCompletionSummary">{providedCount} of {activeHoleCount} holes provided</span>
        <div className="holeInputTrackerList" aria-label={`All ${activeHoleCount} hole score tracker`}>
          {trackerHoles.map(({ holeNumber, scoreProvided }) => (
            <button
              key={holeNumber}
              type="button"
              className={`holeInputTrackerChip${activeHole.hole === holeNumber ? ' holeInputTrackerChip--active' : ''}${scoreProvided ? ' holeInputTrackerChip--saved' : ' holeInputTrackerChip--missing'}`}
              aria-label={`Hole ${holeNumber}${scoreProvided ? ' score entered' : ' score needed'}`}
              aria-current={activeHole.hole === holeNumber ? 'step' : undefined}
              onClick={() => {
                logFrontendEvent({ category: 'scorecard.hole_tracker', message: 'hole_tracker_selected', data: { correlationId: getCorrelationId(), hole: holeNumber, scoreProvided, providedHoleNumbers } })
                void goToHole(holeNumber - 1, 'tracker_chip')
              }}
            >
              {holeNumber}
            </button>
          ))}
        </div>
        {missingNumbers.length ? <span className="small">Tap any circle to jump to that hole.</span> : <strong className="holeInputCompleteBadge">Complete round ready to log</strong>}
      </div>

      <div className="holeInputPageTotals" aria-label="Round totals">
        <div>
          <span>Course par</span>
          <strong>{loading ? '…' : parTotal}</strong>
        </div>
        <div>
          <span>Current score</span>
          <strong>{loading ? '…' : currentScoreTotal}</strong>
        </div>
      </div>
    </div>
  )
}
