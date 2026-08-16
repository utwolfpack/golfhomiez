import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import {
  buildClientDefaultHoleScorecard,
  getHoleScoreSavePresentation,
  hasSavedHoleScoreValue,
  holeParTotal,
  providedHoleScoreTotal,
  mergeProvidedHoleScores,
  missingHoleScoreNumbers,
  normalizeHoleScorecard,
  resetHoleScore,
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
  onHoleSaved?: (holes: HoleScoreDetail[], savedHole: HoleScoreDetail, action?: 'save' | 'reset') => void | Promise<unknown>
  draftContext?: DraftContext
  scoreOwnerLabel?: string
  loadScorecardOnMount?: boolean
  compactMobileInput?: boolean
  teeColor?: TeeColor | string
  persistedHoles?: HoleScoreDetail[] | null
  registerPendingHoleSave?: (handler: PendingHoleScoreSaveHandler | null) => void
  showTeeData?: boolean
  initialHoleNumber?: number | null
  onActiveHoleChange?: (holeNumber: number) => void
}

function getPlayablePar(par: number | null) {
  const value = Number(par)
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 4
}

function getHoleByNumber(holes: HoleScoreDetail[], holeNumber: number) {
  return holes.find((hole) => hole.hole === holeNumber) || null
}

function getSafeHoleByNumber(holes: HoleScoreDetail[], holeNumber: number, stateCode: string, course: string, teeColor: TeeColor | string = 'white') {
  const normalizedHoleNumber = Math.max(1, Math.min(18, Math.trunc(Number(holeNumber) || 1)))
  return getHoleByNumber(holes, normalizedHoleNumber)
    || buildClientDefaultHoleScorecard(stateCode, course, teeColor)[normalizedHoleNumber - 1]
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
  if (!hasSavedHoleScoreValue(hole)) return getPlayablePar(hole.par)
  const score = Number(hole.score)
  return Number.isFinite(score) ? score : getPlayablePar(hole.par)
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
    return hasSavedHoleScoreValue(holes[holeIndex]) ? null : holeIndex
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


function findFirstUnscoredHoleIndex(holes: HoleScoreDetail[]) {
  if (!Array.isArray(holes) || holes.length === 0) return null
  const activeHoleCount = getScorecardHoleCount(holes)
  for (let holeNumber = 1; holeNumber <= activeHoleCount; holeNumber += 1) {
    const holeIndex = holes.findIndex((candidate) => Number(candidate?.hole) === holeNumber)
    if (holeIndex >= 0 && !hasSavedHoleScoreValue(holes[holeIndex])) return holeIndex
  }
  return null
}

function defaultHoleNumberForInputFlow(holes: HoleScoreDetail[], preferredHoleNumber?: number | null) {
  const firstUnscoredHoleIndex = findFirstUnscoredHoleIndex(holes)
  // A completed scorecard should always reopen at hole 1. This takes precedence
  // over a previously remembered/resume hole so every hole-by-hole entry flow
  // has the same predictable page-load behavior after all scores are saved.
  if (firstUnscoredHoleIndex == null) return 1

  const normalizedPreferredHole = Number(preferredHoleNumber)
  if (Number.isFinite(normalizedPreferredHole) && normalizedPreferredHole > 0) {
    const preferredHole = Math.max(1, Math.min(18, Math.trunc(normalizedPreferredHole)))
    if (getHoleByNumber(holes, preferredHole)) return preferredHole
  }
  return Math.max(1, Math.min(18, Number(holes[firstUnscoredHoleIndex]?.hole) || firstUnscoredHoleIndex + 1))
}

function HoleNumberGolfBall({ holeNumber }: { holeNumber: number }) {
  return (
    <div
      className="holeInputHoleIndicator"
      data-hole-number={holeNumber}
      aria-live="polite"
    >
      <svg
        className="holeInputGolfBall"
        viewBox="0 0 96 96"
        role="img"
        aria-label={`Current hole ${holeNumber}`}
      >
        <title>{`Current hole ${holeNumber}`}</title>
        <circle className="holeInputGolfBallShadow" cx="49" cy="50" r="40" />
        <circle className="holeInputGolfBallBody" cx="48" cy="46" r="39" />
        <circle className="holeInputGolfBallAccent" cx="48" cy="46" r="25" />
        <g className="holeInputGolfBallDimples" aria-hidden="true">
          <circle cx="30" cy="24" r="3.6" />
          <circle cx="47" cy="18" r="3.2" />
          <circle cx="65" cy="25" r="3.6" />
          <circle cx="24" cy="43" r="3.2" />
          <circle cx="72" cy="44" r="3.2" />
          <circle cx="29" cy="64" r="3.5" />
          <circle cx="48" cy="73" r="3.2" />
          <circle cx="67" cy="64" r="3.5" />
        </g>
        <text className="holeInputGolfBallNumber" x="48" y="48" textAnchor="middle" dominantBaseline="central">{holeNumber}</text>
      </svg>
    </div>
  )
}


function getProvidedHoleNumbers(holes: HoleScoreDetail[]) {
  return holes
    .filter((hole) => hasSavedHoleScoreValue(hole))
    .map((hole) => hole.hole)
    .filter((holeNumber) => Number.isFinite(holeNumber))
}

export default function HoleByHoleScorecard({ enabled, stateCode, course, courseId = null, holes, onChange, onHoleSaved, draftContext, scoreOwnerLabel, loadScorecardOnMount = true, compactMobileInput = false, teeColor = 'white', persistedHoles = null, registerPendingHoleSave, showTeeData = true, initialHoleNumber = null, onActiveHoleChange }: Props) {
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeHoleNumber, setActiveHoleNumber] = useState(() => defaultHoleNumberForInputFlow(holes, initialHoleNumber))
  const [activeScore, setActiveScore] = useState(4)
  const [savingHole, setSavingHole] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [activeScoreDirty, setActiveScoreDirty] = useState(false)
  const defaultHoleSelectionKeyRef = useRef('')
  const selectedTeeColor = normalizeTeeColor(teeColor)
  const persistedHolesRef = useRef<HoleScoreDetail[] | null>(persistedHoles)
  const initialHoleNumberRef = useRef<number | null>(initialHoleNumber)
  persistedHolesRef.current = persistedHoles
  initialHoleNumberRef.current = initialHoleNumber
  const latestPendingStateRef = useRef({
    enabled,
    holes,
    activeHole: getSafeHoleByNumber(holes, activeHoleNumber, stateCode, course, selectedTeeColor),
    activeScore,
    activeScoreDirty,
    providedHoleNumbers: [] as number[],
  })

  const parTotal = useMemo(() => holeParTotal(holes), [holes])
  const currentScoreTotal = useMemo(() => providedHoleScoreTotal(holes), [holes])
  const activeHole = getSafeHoleByNumber(holes, activeHoleNumber, stateCode, course, selectedTeeColor)
  const activeHoleCount = useMemo(() => getScorecardHoleCount(holes), [holes])
  const trackerHoles = useMemo(() => Array.from({ length: activeHoleCount }, (_, index) => {
    const holeNumber = index + 1
    const hole = getHoleByNumber(holes, holeNumber)
    return { holeNumber, scoreProvided: hasSavedHoleScoreValue(hole) }
  }), [holes, activeHoleCount])
  const providedCount = trackerHoles.filter((hole) => hole.scoreProvided).length
  const providedHoleNumbers = useMemo(() => trackerHoles.filter((hole) => hole.scoreProvided).map((hole) => hole.holeNumber), [trackerHoles])
  const roundComplete = activeHoleCount > 0 && providedCount === activeHoleCount

  useEffect(() => {
    if (!enabled) return
    logFrontendEvent({
      category: 'scorecard.hole_indicator',
      message: 'golf_ball_displayed',
      data: {
        correlationId: getCorrelationId(),
        hole: activeHole.hole,
        indicatorStyle: 'golf_ball',
        course,
        mode: draftContext?.mode || 'round',
      },
    })
  }, [enabled, activeHole.hole, course, draftContext?.mode])

  useEffect(() => {
    if (!enabled || !onActiveHoleChange) return
    onActiveHoleChange(activeHole.hole)
  }, [enabled, activeHole.hole, onActiveHoleChange])

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

  // initialHoleNumber is intentionally not part of this key. Parents update
  // that value from onActiveHoleChange so using it as an initialization
  // dependency creates a feedback loop that alternates between holes.
  const defaultHoleSelectionKey = useMemo(() => [
    enabled ? 'enabled' : 'disabled',
    stateCode,
    course,
    courseId || '',
    selectedTeeColor,
    draftParams?.toString() || '',
    String(loadScorecardOnMount),
  ].join('|'), [enabled, stateCode, course, courseId, selectedTeeColor, draftParams, loadScorecardOnMount])

  useLayoutEffect(() => {
    if (!enabled) return
    if (defaultHoleSelectionKeyRef.current === defaultHoleSelectionKey) return
    defaultHoleSelectionKeyRef.current = defaultHoleSelectionKey
    const preferredHoleNumber = initialHoleNumberRef.current
    const nextDefaultHole = defaultHoleNumberForInputFlow(holes, preferredHoleNumber)
    const allHolesSaved = holes.length > 0 && findFirstUnscoredHoleIndex(holes) == null
    setActiveHoleNumber(nextDefaultHole)
    logFrontendEvent({
      category: 'scorecard.hole.default_selection',
      message: allHolesSaved ? 'completed_scorecard_defaulted_to_hole_one' : (preferredHoleNumber ? 'resume_hole_selected' : 'first_unscored_hole_selected'),
      data: {
        correlationId: getCorrelationId(),
        stateCode,
        course,
        courseId,
        teeColor: selectedTeeColor,
        activeHole: nextDefaultHole,
        preferredHole: preferredHoleNumber,
        providedHoleNumbers: getProvidedHoleNumbers(holes),
        allHolesSaved,
        selectionMode: 'initialize_once_per_scorecard_context',
      },
    })
  }, [enabled, defaultHoleSelectionKey])

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
        const loadedUnsavedHoleNumbers = nextHoles
          .filter((hole) => !hasSavedHoleScoreValue(hole))
          .map((hole) => hole.hole)
        const unsavedScoreValueCount = nextHoles
          .filter((hole) => !hasSavedHoleScoreValue(hole) && hole.score != null)
          .length
        onChange(nextHoles)
        const defaultHoleNumber = defaultHoleNumberForInputFlow(nextHoles, initialHoleNumberRef.current)
        setActiveHoleNumber(defaultHoleNumber)
        logFrontendEvent({
          category: 'scorecard.load',
          message: 'succeeded',
          data: { correlationId, stateCode, course, courseId, teeColor: selectedTeeColor, source, parTotal: responseParTotal, holeCount: nextHoles.length, providedCount: loadedProvidedHoleNumbers.length, providedHoleNumbers: loadedProvidedHoleNumbers, unsavedHoleNumbers: loadedUnsavedHoleNumbers, unsavedScoreValueCount, scoreValuePolicy: 'saved_holes_only', defaultHole: defaultHoleNumber },
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
    // Server refreshes may update score values, but they must not move the
    // golfer away from the hole currently being viewed or edited.
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
        navigationPreserved: true,
      },
    })
  }, [persistedHoles, selectedTeeColor])

  useEffect(() => {
    if (activeHoleCount <= 0) return
    if (activeHoleNumber < 1 || activeHoleNumber > activeHoleCount) {
      setActiveHoleNumber(Math.max(1, Math.min(activeHoleCount, activeHoleNumber || 1)))
    }
  }, [activeHoleNumber, activeHoleCount])

  useLayoutEffect(() => {
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
    const savePresentation = getHoleScoreSavePresentation(hole.par, normalizedScore)
    const baseHoleCount = getScorecardHoleCount(baseHoles)
    const wasRoundCompleteBeforeSave = baseHoleCount > 0 && getProvidedHoleNumbers(baseHoles).length === baseHoleCount
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
      data: { correlationId, hole: hole.hole, score: normalizedScore, source, teeColor: savedHole.teeColor || selectedTeeColor, currentScore: providedHoleScoreTotal(next), outcome: savePresentation.outcome, relativeToPar: savePresentation.relative, providedCount: savedHoleNumbers.length, providedHoleNumbers: savedHoleNumbers, draftContext },
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
        await onHoleSaved(next, savedHole, 'save')
      }
      const remainingHoleCount = missingHoleScoreNumbers(next).length
      const nextUnscoredHoleIndex = options.autoAdvanceAfterSave ? findNextUnscoredHoleIndex(next, hole.hole) : null
      const nextSequentialHole = options.autoAdvanceAfterSave && wasRoundCompleteBeforeSave && hole.hole < getScorecardHoleCount(next)
        ? hole.hole + 1
        : null
      if (latestPendingStateRef.current.activeHole.hole === hole.hole) {
        setActiveScoreDirty(false)
      }
      const nextAutoAdvanceHole = nextUnscoredHoleIndex != null ? next[nextUnscoredHoleIndex]?.hole || nextUnscoredHoleIndex + 1 : null
      if (remainingHoleCount === 0 && nextSequentialHole != null) {
        setActiveHoleNumber(nextSequentialHole)
        setSaveStatus(`Hole ${hole.hole} saved. Moved to Hole ${nextSequentialHole}. Complete round ready to log.`)
        logFrontendEvent({ category: 'scorecard.hole.auto_advance', message: 'completed_round_next_hole_selected', data: { correlationId, savedHole: hole.hole, nextHole: nextSequentialHole, remainingHoleCount, providedHoleNumbers: savedHoleNumbers, progressionMode: 'sequential_completed_round' } })
      } else if (remainingHoleCount === 0) {
        setSaveStatus(`Hole ${hole.hole} saved. Complete round ready to log.`)
        logFrontendEvent({ category: 'scorecard.hole.auto_advance', message: 'round_complete', data: { correlationId, savedHole: hole.hole, remainingHoleCount, providedHoleNumbers: savedHoleNumbers, progressionMode: 'round_completion' } })
      } else if (nextUnscoredHoleIndex != null) {
        setActiveHoleNumber(nextAutoAdvanceHole || 1)
        setSaveStatus(`Hole ${hole.hole} saved. Moved to Hole ${nextAutoAdvanceHole}.`)
        logFrontendEvent({ category: 'scorecard.hole.auto_advance', message: 'next_unscored_hole_selected', data: { correlationId, savedHole: hole.hole, nextHole: nextAutoAdvanceHole, nextHoleIndex: nextUnscoredHoleIndex, remainingHoleCount, providedHoleNumbers: savedHoleNumbers, progressionMode: 'next_unscored_round_order', transitionStyle: 'scorecard_hole_change' } })
      } else {
        setSaveStatus(`Hole ${hole.hole} saved. Tap another hole circle to continue.`)
        logFrontendEvent({ category: 'scorecard.hole.auto_advance', message: 'no_unscored_hole_available', data: { correlationId, savedHole: hole.hole, remainingHoleCount, providedHoleNumbers: savedHoleNumbers } })
      }
      logFrontendEvent({
        category: 'scorecard.hole.save',
        message: 'succeeded',
        data: { correlationId, hole: hole.hole, score: normalizedScore, source, teeColor: savedHole.teeColor || selectedTeeColor, outcome: savePresentation.outcome, relativeToPar: savePresentation.relative, providedCount: savedHoleNumbers.length, providedHoleNumbers: savedHoleNumbers, remainingHoleCount, advancedAfterSave: nextUnscoredHoleIndex != null || nextSequentialHole != null, nextHole: nextSequentialHole ?? nextAutoAdvanceHole, trackerSavedColor: 'light_green', trackerMissingColor: 'light_red' },
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

  async function clearActiveHoleScore(source = 'dedicated_hole_page_reset') {
    if (savingHole) return
    const next = withSelectedTeeColor(resetHoleScore(holes, activeHole.hole), selectedTeeColor)
    const resetHole = {
      ...activeHole,
      teeColor: selectedTeeColor,
      teeBoxType: selectedTeeColor,
      score: null,
      scoreProvided: false,
    }
    const correlationId = getCorrelationId()
    const remainingProvidedHoleNumbers = getProvidedHoleNumbers(next)
    onChange(next)
    setSavingHole(true)
    setActiveScoreDirty(false)
    setSaveStatus('Clearing hole score…')
    logFrontendEvent({
      category: 'scorecard.hole.reset',
      message: 'started',
      data: { correlationId, hole: activeHole.hole, source, teeColor: selectedTeeColor, remainingProvidedHoleNumbers, draftContext },
    })

    try {
      if (draftParams) {
        const params = new URLSearchParams(draftParams)
        params.set('hole', String(activeHole.hole))
        await api(`/api/scorecard-drafts/hole?${params.toString()}`, { method: 'DELETE' })
      }
      if (onHoleSaved) {
        await onHoleSaved(next, resetHole, 'reset')
      }
      const nextDefaultHole = activeHole.hole
      setActiveHoleNumber(nextDefaultHole)
      setSaveStatus(`Hole ${activeHole.hole} cleared.`)
      logFrontendEvent({
        category: 'scorecard.hole.reset',
        message: 'succeeded',
        data: { correlationId, hole: activeHole.hole, source, nextHole: nextDefaultHole, remainingProvidedHoleNumbers, trackerState: 'not_saved', trackerColor: 'light_red', navigationPreserved: true },
      })
      return { saved: true, hole: activeHole.hole, providedHoleNumbers: remainingProvidedHoleNumbers, holes: next }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not clear this hole score.'
      setSaveStatus('Cleared on this page, but database persistence failed. Try clearing again before leaving.')
      logFrontendEvent({ category: 'scorecard.hole.reset', level: 'error', message: 'failed', data: { correlationId, hole: activeHole.hole, source, error: message } })
      throw error
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
    const hasSavedScore = hasSavedHoleScoreValue(currentHoleRecord)
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

  async function goToHole(holeNumber: number, source = 'hole_navigation') {
    const targetHoleNumber = Math.max(1, Math.min(activeHoleCount, Math.trunc(Number(holeNumber) || 1)))
    const fromHoleNumber = activeHole.hole
    if (targetHoleNumber === fromHoleNumber) return

    // Start persistence for a changed score, but switch the visible hole immediately.
    // A slow or failed request must never trap the golfer on the current hole.
    const pendingSave = savePendingActiveHoleScore(source)
    setSaveStatus(null)
    setActiveHoleNumber(targetHoleNumber)
    logFrontendEvent({
      category: 'scorecard.hole.navigate',
      message: 'selected_immediately',
      data: {
        correlationId: getCorrelationId(),
        fromHole: fromHoleNumber,
        toHole: targetHoleNumber,
        source,
        navigationMode: 'hole_number_immediate',
        persistenceDoesNotBlockNavigation: true,
      },
    })

    try {
      await pendingSave
    } catch (error) {
      const message = error instanceof Error ? error.message : `Could not save Hole ${fromHoleNumber}.`
      setSaveStatus(`Hole ${fromHoleNumber} could not be saved, but you can continue reviewing other holes. Return to Hole ${fromHoleNumber} and try again.`)
      logFrontendEvent({
        category: 'scorecard.hole.navigate',
        level: 'error',
        message: 'previous_hole_save_failed_navigation_preserved',
        data: {
          correlationId: getCorrelationId(),
          fromHole: fromHoleNumber,
          toHole: targetHoleNumber,
          source,
          error: message,
          navigationPreserved: true,
        },
      })
    }
  }


  if (!enabled) return null

  const savePresentation = getHoleScoreSavePresentation(activeHole.par, activeScore)
  const currentHoleProvided = hasSavedHoleScoreValue(activeHole)
  const savedActiveScore = Number(activeHole.score)
  const currentScoreSaved = currentHoleProvided
    && !activeScoreDirty
    && Number.isFinite(savedActiveScore)
    && Math.trunc(savedActiveScore) === Math.trunc(activeScore)
  const saveButtonLabel = `${savePresentation.label}${currentScoreSaved ? '' : ' – not saved'}`
  const activeHoleParLabel = activeHole.par ?? '—'
  const activeHoleTeeLabel = showTeeData ? teeColorLabel(selectedTeeColor) : ''
  const roundTypeLabel = getRoundTypeLabel(draftContext, scoreOwnerLabel)
  const holeContextItems = [
    { key: 'par', value: `Par ${activeHoleParLabel}`, emphasis: true },
    { key: 'course', value: course || 'Selected course', emphasis: true },
    showTeeData ? { key: 'tees', value: `${activeHoleTeeLabel} tees`, subtle: false } : null,
    hasDisplayablePositiveNumber(activeHole.yards) ? { key: 'yards', value: `${formatYardage(activeHole.yards)} Yards`, subtle: true } : null,
    hasDisplayablePositiveNumber(activeHole.strokeIndex) ? { key: 'strokeIndex', value: `Stroke Index ${Math.trunc(Number(activeHole.strokeIndex))}`, subtle: true } : null,
    draftContext?.date ? { key: 'date', value: draftContext.date, subtle: true } : null,
    roundTypeLabel ? { key: 'roundType', value: roundTypeLabel, subtle: false } : null,
  ].filter(Boolean) as Array<{ key: string; value: string; emphasis?: boolean; subtle?: boolean }>


  return (
    <div className={`card holeInputPanel ${compactMobileInput ? 'holeInputPanel--compact' : ''}`} style={{ marginTop: 16 }}>
      <section className={`holeInputPhone ${compactMobileInput ? 'holeInputPhone--compact' : ''}`} aria-label={`Score entry for hole ${activeHole.hole}`}>
        <div key={activeHole.hole} className={`holeInputScorePageCard holeInputScorePageCard--holeChanged ${compactMobileInput ? 'holeInputScorePageCard--compact' : ''}`}>
          <div className="holeInputScoreHeader">
            <span className="holeInputScoreHeaderLabel">Hole</span>
            <HoleNumberGolfBall holeNumber={activeHole.hole} />
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
            </div>
            <button type="button" className="btn holeInputStepperButton" aria-label="Increase score" onClick={() => { setActiveScoreDirty(true); setActiveScore((score) => score + 1) }}>+</button>
          </div>

          <button
            type="button"
            className={`btn holeInputSaveButton ${savePresentation.className} ${currentScoreSaved ? 'holeInputSaveButton--saved' : 'holeInputSaveButton--unsaved'}`}
            disabled={savingHole}
            aria-label={`Save Hole ${activeHole.hole} score: ${saveButtonLabel}`}
            onClick={() => saveHoleScore(activeHole, activeScore, 'dedicated_hole_page', { autoAdvanceAfterSave: true })}
          >
            {savingHole ? 'Saving…' : saveButtonLabel}
          </button>
          {currentHoleProvided ? (
            <button
              type="button"
              className="btn btnSmall holeInputResetButton"
              disabled={savingHole}
              onClick={() => { void clearActiveHoleScore() }}
            >
              Reset Hole Score
            </button>
          ) : null}
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
              aria-label={`Hole ${holeNumber}${scoreProvided ? ' score saved' : ' score not saved'}`}
              aria-current={activeHole.hole === holeNumber ? 'step' : undefined}
              onClick={() => {
                logFrontendEvent({ category: 'scorecard.hole_tracker', message: 'hole_tracker_selected', data: { correlationId: getCorrelationId(), hole: holeNumber, scoreProvided, providedHoleNumbers } })
                void goToHole(holeNumber, 'tracker_chip')
              }}
            >
              {holeNumber}
            </button>
          ))}
        </div>
        {roundComplete ? <strong className="holeInputCompleteBadge">Complete round ready to log</strong> : <span className="small">Tap any circle to jump to that hole.</span>}
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
