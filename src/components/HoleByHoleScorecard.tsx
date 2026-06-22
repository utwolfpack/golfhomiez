import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import {
  buildClientDefaultHoleScorecard,
  calculateDistanceYards,
  formatHoleScoreOutcome,
  holeParTotal,
  holeScoreTotal,
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

type MapLocation = {
  latitude: number
  longitude: number
  accuracy?: number | null
  source: 'saved' | 'browser'
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


function isFiniteCoordinate(value: unknown) {
  return Number.isFinite(Number(value))
}

function savedLocationToMapLocation(): MapLocation | null {
  if (typeof window === 'undefined') return null
  const savedLocation = loadSavedLocation()
  if (!savedLocation || !isFiniteCoordinate(savedLocation.latitude) || !isFiniteCoordinate(savedLocation.longitude)) return null
  return {
    latitude: Number(savedLocation.latitude),
    longitude: Number(savedLocation.longitude),
    accuracy: null,
    source: 'saved',
  }
}

function formatYardage(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? `${Math.max(0, Math.round(Number(value)))} yd` : '—'
}

function getHoleMapDistanceToPin(hole: HoleScoreDetail, location: MapLocation | null) {
  if (location && isFiniteCoordinate(hole.flagLatitude) && isFiniteCoordinate(hole.flagLongitude)) {
    return calculateDistanceYards(location.latitude, location.longitude, Number(hole.flagLatitude), Number(hole.flagLongitude))
  }
  return Number.isFinite(Number(hole.distanceToFlagYards)) ? Math.max(0, Math.round(Number(hole.distanceToFlagYards))) : null
}

function getHoleMapFairwayPath(holeNumber: number) {
  const variants = [
    'M148 520 C132 454 162 405 150 350 C136 284 170 228 228 202 C286 176 318 124 286 88 C342 104 374 150 358 206 C338 278 390 350 356 424 C326 490 246 532 148 520 Z',
    'M244 522 C188 490 154 440 164 382 C174 326 230 302 224 244 C218 180 260 126 326 112 C300 164 324 210 356 262 C402 336 378 434 316 490 C296 508 270 520 244 522 Z',
    'M170 524 C128 472 142 412 188 372 C238 328 214 272 234 218 C254 164 306 132 356 144 C318 188 340 248 382 298 C430 356 412 448 338 496 C292 526 228 542 170 524 Z',
  ]
  return variants[Math.abs(Math.trunc(holeNumber || 1) - 1) % variants.length]
}

function getHoleMapTarget(holeNumber: number) {
  const targets = [
    { x: 300, y: 112, greenX: 288, greenY: 92 },
    { x: 334, y: 136, greenX: 318, greenY: 114 },
    { x: 364, y: 160, greenX: 346, greenY: 134 },
  ]
  return targets[Math.abs(Math.trunc(holeNumber || 1) - 1) % targets.length]
}

function getHoleMapLandingPoint(holeNumber: number) {
  const points = [
    { x: 226, y: 392, labelDx: -54, labelDy: -10 },
    { x: 266, y: 360, labelDx: 28, labelDy: -16 },
    { x: 246, y: 418, labelDx: -56, labelDy: 22 },
  ]
  return points[Math.abs(Math.trunc(holeNumber || 1) - 1) % points.length]
}

function getHoleMapWaterPath(holeNumber: number) {
  const variants = [
    'M50 260 C104 222 146 242 164 292 C186 350 142 400 68 382 C36 352 28 304 50 260 Z',
    'M314 282 C374 256 412 284 410 344 C406 404 344 428 304 390 C270 356 276 304 314 282 Z',
    'M42 184 C104 150 168 178 174 238 C178 284 128 326 70 304 C22 284 4 220 42 184 Z',
  ]
  return variants[Math.abs(Math.trunc(holeNumber || 1) - 1) % variants.length]
}

function getHoleMapTeeStart(teeColor: TeeColor | string | null | undefined) {
  const selected = normalizeTeeColor(teeColor)
  if (selected === 'red') return { x: 200, y: 522 }
  if (selected === 'white') return { x: 210, y: 545 }
  if (selected === 'blue') return { x: 224, y: 568 }
  return { x: 238, y: 590 }
}

function getHoleMapCarryDistance(hole: HoleScoreDetail, teeColor: TeeColor | string | null | undefined) {
  const yards = Number(hole.yards)
  if (!Number.isFinite(yards) || yards <= 0) return null
  const tee = normalizeTeeColor(teeColor)
  const divisor = tee === 'black' ? 2.15 : tee === 'blue' ? 2.0 : tee === 'red' ? 1.65 : 1.85
  return Math.max(80, Math.round(yards / divisor))
}

function getNextRequiredHoleIndex(holes: HoleScoreDetail[], currentHoleNumber: number) {
  const remaining = missingHoleScoreNumbers(holes)
  if (!remaining.length) return null
  const nextAfterCurrent = remaining.find((holeNumber) => holeNumber > currentHoleNumber)
  const targetHoleNumber = nextAfterCurrent ?? remaining[0]
  const targetIndex = holes.findIndex((hole) => hole.hole === targetHoleNumber)
  return targetIndex >= 0 ? targetIndex : Math.max(0, Math.min(holes.length - 1, targetHoleNumber - 1))
}

function getProvidedHoleNumbers(holes: HoleScoreDetail[]) {
  return holes
    .filter((hole) => hole.scoreProvided)
    .map((hole) => hole.hole)
    .filter((holeNumber) => Number.isFinite(holeNumber))
}

export default function HoleByHoleScorecard({ enabled, stateCode, course, holes, onChange, onHoleSaved, draftContext, scoreOwnerLabel, loadScorecardOnMount = true, compactMobileInput = false, teeColor = 'white', persistedHoles = null, registerPendingHoleSave }: Props) {
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeHoleIndex, setActiveHoleIndex] = useState(0)
  const [activeScore, setActiveScore] = useState(4)
  const [savingHole, setSavingHole] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [activeScoreDirty, setActiveScoreDirty] = useState(false)
  const [holeMapOpen, setHoleMapOpen] = useState(false)
  const [mapLocation, setMapLocation] = useState<MapLocation | null>(() => savedLocationToMapLocation())
  const [mapGpsState, setMapGpsState] = useState<'good' | 'searching' | 'unavailable'>(() => (savedLocationToMapLocation() ? 'good' : 'unavailable'))
  const [mapLocationStatus, setMapLocationStatus] = useState<string | null>(null)
  const selectedTeeColor = normalizeTeeColor(teeColor)
  const latestPendingStateRef = useRef({
    enabled,
    holes,
    activeHole: getSafeHole(holes, activeHoleIndex, stateCode, course, selectedTeeColor),
    activeScore,
    activeScoreDirty,
    providedHoleNumbers: [] as number[],
  })

  const parTotal = useMemo(() => holeParTotal(holes), [holes])
  const scoreTotal = useMemo(() => holeScoreTotal(holes), [holes])
  const missingNumbers = useMemo(() => missingHoleScoreNumbers(holes), [holes])
  const activeHole = getSafeHole(holes, activeHoleIndex, stateCode, course, selectedTeeColor)
  const activeHoleCount = Math.max(18, holes.length || 18)
  const trackerHoles = useMemo(() => Array.from({ length: 18 }, (_, index) => {
    const holeNumber = index + 1
    const hole = getHoleByNumber(holes, holeNumber)
    return { holeNumber, scoreProvided: Boolean(hole?.scoreProvided) }
  }), [holes])
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
      logFrontendEvent({ category: 'scorecard.load', message: 'started', data: { correlationId, stateCode, course, teeColor: selectedTeeColor, draftContext } })

      try {
        let nextHoles: HoleScoreDetail[]
        let source = 'generated-defaults'
        let responseParTotal = 0

        if (!stateCode || !course) {
          nextHoles = buildClientDefaultHoleScorecard(stateCode, course, selectedTeeColor)
          responseParTotal = holeParTotal(nextHoles)
        } else {
          const params = new URLSearchParams({ state: stateCode, course, teeColor: selectedTeeColor })
          const savedLocation = loadSavedLocation()
          if (savedLocation?.latitude && savedLocation?.longitude) {
            params.set('lat', String(savedLocation.latitude))
            params.set('lng', String(savedLocation.longitude))
            setMapLocation({ latitude: Number(savedLocation.latitude), longitude: Number(savedLocation.longitude), accuracy: null, source: 'saved' })
            setMapGpsState('good')
          }
          const response = await api<ScorecardResponse>(`/api/golf-courses/scorecard?${params.toString()}`)
          if (cancelled) return
          nextHoles = normalizeHoleScorecard(response.holes, stateCode, course, response.teeColor || selectedTeeColor)
          source = response.source
          responseParTotal = response.parTotal
        }

        if (Array.isArray(persistedHoles) && persistedHoles.length > 0) {
          nextHoles = mergeProvidedHoleScores(nextHoles, persistedHoles)
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
            logFrontendEvent({ category: 'scorecard.draft.load', level: 'warn', message: 'failed', data: { correlationId, stateCode, course, teeColor: selectedTeeColor, error: message } })
          }
        }

        const loadedProvidedHoleNumbers = getProvidedHoleNumbers(nextHoles)
        onChange(nextHoles)
        setActiveHoleIndex(0)
        logFrontendEvent({
          category: 'scorecard.load',
          message: 'succeeded',
          data: { correlationId, stateCode, course, teeColor: selectedTeeColor, source, parTotal: responseParTotal, holeCount: nextHoles.length, providedCount: loadedProvidedHoleNumbers.length, providedHoleNumbers: loadedProvidedHoleNumbers },
        })
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'Golfbert scorecard data could not be loaded.'
        setLoadError(message)
        logFrontendEvent({ category: 'scorecard.load', level: 'error', message: 'failed', data: { correlationId, stateCode, course, teeColor: selectedTeeColor, error: message } })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadScorecard()
    return () => { cancelled = true }
  }, [enabled, loadScorecardOnMount, stateCode, course, selectedTeeColor, draftParams?.toString(), persistedHoles])

  useEffect(() => {
    if (activeHoleIndex >= holes.length && holes.length > 0) setActiveHoleIndex(holes.length - 1)
  }, [activeHoleIndex, holes.length])

  useEffect(() => {
    setActiveScore(getScoreOrPar(activeHole))
    setActiveScoreDirty(false)
  }, [activeHole.hole])

  useEffect(() => {
    if (!activeScoreDirty) {
      setActiveScore(getScoreOrPar(activeHole))
    }
  }, [activeScoreDirty, activeHole.par, activeHole.score, activeHole.scoreProvided])

  async function saveHoleScore(hole: HoleScoreDetail, score: number, source: string, options: { advanceAfterSave?: boolean; throwOnError?: boolean } = {}, baseHoles: HoleScoreDetail[] = holes): Promise<PendingHoleScoreSaveResult> {
    const shouldAdvanceAfterSave = options.advanceAfterSave !== false
    const normalizedScore = Math.max(0, Math.trunc(score))
    const next = updateHoleScore(baseHoles, hole.hole, normalizedScore)
    const correlationId = getCorrelationId()
    const savedHoleNumbers = getProvidedHoleNumbers(next)

    const savedHole = {
      ...hole,
      teeColor: hole.teeColor || selectedTeeColor,
      teeBoxType: hole.teeBoxType || selectedTeeColor,
      score: normalizedScore,
      scoreProvided: true,
    }

    onChange(next)
    setSavingHole(true)
    setSaveStatus('Saving hole score…')
    logFrontendEvent({
      category: 'scorecard.hole.save',
      message: 'started',
      data: { correlationId, hole: hole.hole, score: normalizedScore, source, teeColor: savedHole.teeColor || selectedTeeColor, cumulativeScore: holeScoreTotal(next), providedCount: savedHoleNumbers.length, providedHoleNumbers: savedHoleNumbers, draftContext },
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
      const nextRequiredHoleIndex = getNextRequiredHoleIndex(next, hole.hole)
      const nextRequiredHole = nextRequiredHoleIndex == null ? null : next[nextRequiredHoleIndex]?.hole
      setActiveScoreDirty(false)
      if (!shouldAdvanceAfterSave) {
        setSaveStatus(`Hole ${hole.hole} saved.`)
      } else if (nextRequiredHoleIndex == null) {
        setSaveStatus(`Hole ${hole.hole} saved. Complete round ready to log.`)
      } else {
        setActiveHoleIndex(nextRequiredHoleIndex)
        setSaveStatus(`Hole ${hole.hole} saved. Next required hole: ${nextRequiredHole}.`)
      }
      logFrontendEvent({
        category: 'scorecard.hole.save',
        message: 'succeeded',
        data: { correlationId, hole: hole.hole, score: normalizedScore, source, teeColor: savedHole.teeColor || selectedTeeColor, providedCount: savedHoleNumbers.length, providedHoleNumbers: savedHoleNumbers, remainingHoleCount: missingHoleScoreNumbers(next).length, nextRequiredHole, advancedAfterSave: shouldAdvanceAfterSave },
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
    return saveHoleScore(pendingHole, normalizedActiveScore, source, { advanceAfterSave: false, throwOnError: true }, pendingState.holes)
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

  function closeHoleMap() {
    setHoleMapOpen(false)
    logFrontendEvent({ category: 'scorecard.hole_map', message: 'closed', data: { correlationId: getCorrelationId(), hole: activeHole.hole } })
  }

  function openHoleMap() {
    const correlationId = getCorrelationId()
    const savedMapLocation = savedLocationToMapLocation()
    if (savedMapLocation) {
      setMapLocation(savedMapLocation)
      setMapGpsState('good')
      setMapLocationStatus('Using saved golfer location. Live GPS refresh is running when available.')
    } else {
      setMapGpsState('searching')
      setMapLocationStatus('Requesting golfer GPS location…')
    }
    setHoleMapOpen(true)
    logFrontendEvent({
      category: 'scorecard.hole_map',
      message: 'opened',
      data: { correlationId, hole: activeHole.hole, course, teeColor: activeHole.teeColor || selectedTeeColor, hasFlagCoordinates, savedLocationAvailable: Boolean(savedMapLocation) },
    })

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setMapGpsState(savedMapLocation ? 'good' : 'unavailable')
      setMapLocationStatus(savedMapLocation ? 'Browser GPS unavailable; using saved location.' : 'Browser GPS unavailable. Use My Location before opening the map for pin distance.')
      logFrontendEvent({ category: 'scorecard.hole_map.location', level: savedMapLocation ? 'warn' : 'error', message: 'browser_geolocation_unavailable', data: { correlationId, hole: activeHole.hole, teeColor: activeHole.teeColor || selectedTeeColor } })
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          source: 'browser' as const,
        }
        setMapLocation(nextLocation)
        setMapGpsState('good')
        setMapLocationStatus(`Live GPS acquired${Number.isFinite(position.coords.accuracy) ? ` within ${Math.round(position.coords.accuracy)} m` : ''}.`)
        logFrontendEvent({
          category: 'scorecard.hole_map.location',
          message: 'succeeded',
          data: { correlationId, hole: activeHole.hole, accuracyMeters: position.coords.accuracy, distanceToPinYards: getHoleMapDistanceToPin(activeHole, nextLocation) },
        })
      },
      (error) => {
        setMapGpsState(savedMapLocation ? 'good' : 'unavailable')
        setMapLocationStatus(savedMapLocation ? 'Live GPS failed; using saved golfer location.' : 'GPS location is unavailable. Use My Location and reopen the map for pin distance.')
        logFrontendEvent({ category: 'scorecard.hole_map.location', level: 'warn', message: 'failed', data: { correlationId, hole: activeHole.hole, error: error.message } })
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 30000 },
    )
  }

  if (!enabled) return null

  const currentOutcome = formatHoleScoreOutcome({ par: activeHole.par, score: activeScore })
  const currentHoleProvided = Boolean(activeHole.scoreProvided)
  const mapDistanceToPin = getHoleMapDistanceToPin(activeHole, mapLocation)
  const mapTarget = getHoleMapTarget(activeHole.hole)
  const mapLandingPoint = getHoleMapLandingPoint(activeHole.hole)
  const mapWaterPath = getHoleMapWaterPath(activeHole.hole)
  const mapTeeColor = normalizeTeeColor(activeHole.teeColor || selectedTeeColor)
  const mapTeeLabel = teeColorLabel(mapTeeColor)
  const mapTeeStart = getHoleMapTeeStart(mapTeeColor)
  const mapCarryDistance = getHoleMapCarryDistance(activeHole, mapTeeColor)
  const mapPinDistanceLabel = formatYardage(mapDistanceToPin)
  const mapHoleLabel = String(activeHole.hole).padStart(2, '0')
  const mapParLabel = activeHole.par ?? '—'
  const mapYardsLabel = formatYardage(activeHole.yards)
  const hasFlagCoordinates = isFiniteCoordinate(activeHole.flagLatitude) && isFiniteCoordinate(activeHole.flagLongitude)
  const gpsLabel = mapGpsState === 'good' ? 'GPS: Good' : mapGpsState === 'searching' ? 'GPS: Searching' : 'GPS: Unavailable'

  return (
    <div className={`card holeInputPanel ${compactMobileInput ? 'holeInputPanel--compact' : ''}`} style={{ marginTop: 16 }}>
      {loadError ? <div className="small holeInputLoadWarning">Golfbert course hole data could not be loaded. Try again or choose another course.</div> : null}

      <section className={`holeInputPhone ${compactMobileInput ? 'holeInputPhone--compact' : ''}`} aria-label={`Score entry for hole ${activeHole.hole}`}>
        <div className={`holeInputScorePageCard ${compactMobileInput ? 'holeInputScorePageCard--compact' : ''}`}>
          {scoreOwnerLabel ? <div className="holeInputTeamLabel">{scoreOwnerLabel}</div> : null}
          <div className="holeInputScoreHeader">
            <span className="holeInputScoreHeaderSpacer" aria-hidden="true" />
            <div className="holeInputScoreLabel">Score for Hole {activeHole.hole}</div>
            <button
              type="button"
              className="holeMapIconButton"
              aria-label={`Open map for hole ${activeHole.hole}`}
              title={`Open map for hole ${activeHole.hole}`}
              onClick={openHoleMap}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                <path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M9 3v15M15 6v15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="15" cy="9" r="2.2" fill="currentColor" />
              </svg>
            </button>
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
            onClick={() => saveHoleScore(activeHole, activeScore, 'dedicated_hole_page')}
          >
            {savingHole ? 'Saving…' : currentHoleProvided ? 'Update Hole Score' : 'Save Hole Score'}
          </button>
          {saveStatus ? <div className="small holeInputSaveStatus">{saveStatus}</div> : null}
        </div>

        <footer className="holeInputFooter">
          <div className="holeInputMetadata" aria-label="Hole details">
            <span className="holeInputPin" aria-hidden="true">⚲</span>
            <span>Par {mapParLabel}</span>
            <span aria-hidden="true">|</span>
            <span>{activeHole.yards || '—'} Yards</span>
            <span aria-hidden="true">|</span>
            <span>{teeColorLabel(activeHole.teeColor || selectedTeeColor)} tees</span>
            <span aria-hidden="true">|</span>
            <span>Stroke Index {activeHole.strokeIndex || activeHole.hole}</span>
            {activeHole.distanceToFlagYards != null ? <><span aria-hidden="true">|</span><span>{activeHole.distanceToFlagYards} yds to flag</span></> : null}
          </div>
          <div className="holeInputNavigation">
            <button
              type="button"
              className="btn holeInputNavButton"
              onClick={() => { void goToHole(activeHoleIndex - 1, 'previous_hole_button') }}
              disabled={activeHoleIndex <= 0}
            >
              <span aria-hidden="true">←</span> Previous Hole
            </button>
            <button
              type="button"
              className="btnPrimary holeInputNavButton"
              onClick={() => { void goToHole(activeHoleIndex + 1, 'next_hole_button') }}
              disabled={activeHoleIndex >= activeHoleCount - 1}
            >
              Next Hole <span aria-hidden="true">→</span>
            </button>
          </div>
        </footer>
      </section>

      {holeMapOpen ? (
        <div className="holeMapModalBackdrop" role="presentation" onClick={closeHoleMap}>
          <section
            className="holeMapModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hole-map-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="holeMapTopBar">
              <button type="button" className="holeMapCloseButton" aria-label="Close hole map" onClick={closeHoleMap}>×</button>
              <div className="holeMapDistanceHeader" id="hole-map-title">
                <span>Pin Distance</span>
                <strong>{formatYardage(mapDistanceToPin)}</strong>
              </div>
              <div className={`holeMapGpsStatus holeMapGpsStatus--${mapGpsState}`} aria-live="polite">
                <span className="holeMapGpsBars" aria-hidden="true"><i /><i /><i /></span>
                <span>{gpsLabel}</span>
              </div>
            </header>

            <div className="holeMapCanvas" aria-label={`Hole ${activeHole.hole} map overview`}>
              <div className="holeMapMetricsBar" aria-label="Hole map metrics">
                <div><span>Pin distance</span><strong>{mapPinDistanceLabel}</strong></div>
                <div><span>Hole</span><strong>{mapHoleLabel}</strong></div>
                <div><span>Par</span><strong>{mapParLabel}</strong></div>
                <div><span>Tee</span><strong>{mapTeeLabel}</strong></div>
              </div>

              <div className="holeMapTeeStrip" aria-label="Selected tee yardage">
                <span className={`holeMapTeeChip holeMapTeeChip--${mapTeeColor}`}>{mapTeeLabel}</span>
                <strong>{mapYardsLabel}</strong>
                <span>Hole {mapHoleLabel} • Par {mapParLabel}</span>
              </div>

              <div className="holeMapDistanceCard" aria-label="Distance details">
                <div className="holeMapDistanceRow holeMapDistanceRow--pin">
                  <span>To pin</span>
                  <strong>{mapPinDistanceLabel}</strong>
                </div>
                <div className="holeMapDistanceRow holeMapDistanceRow--target">
                  <span>{mapTeeLabel} tee</span>
                  <strong>{mapYardsLabel}</strong>
                </div>
                <div className="holeMapDistanceRow holeMapDistanceRow--carry">
                  <span>Carry view</span>
                  <strong>{formatYardage(mapCarryDistance)}</strong>
                </div>
              </div>

              <svg className="holeMapSvg" viewBox="0 0 420 620" role="img" aria-label={`Satellite-style overview for hole ${activeHole.hole}`}>
                <rect className="holeMapSatelliteBase" x="0" y="0" width="420" height="620" rx="0" />
                <path className="holeMapMowStripe" d="M-20 34 C92 106 122 230 88 344 C50 472 86 568 222 648" />
                <path className="holeMapMowStripe holeMapMowStripe--alt" d="M470 14 C338 112 326 238 374 340 C430 462 394 556 266 658" />
                <path className="holeMapCartPath" d="M74 34 C122 148 80 262 116 370 C142 448 124 526 164 600" />
                <path className="holeMapWater" d={mapWaterPath} />
                <path className="holeMapRough" d={getHoleMapFairwayPath(activeHole.hole)} />
                <path className="holeMapFairway" d={getHoleMapFairwayPath(activeHole.hole)} />
                <path className="holeMapYardageArc" d={`M${mapTeeStart.x - 74} ${mapTeeStart.y - 120} C${mapTeeStart.x + 18} ${mapTeeStart.y - 184} ${mapLandingPoint.x + 58} ${mapLandingPoint.y - 36} ${mapLandingPoint.x + 92} ${mapLandingPoint.y + 52}`} />
                <path className="holeMapYardageArc holeMapYardageArc--secondary" d={`M${mapTeeStart.x - 48} ${mapTeeStart.y - 66} C${mapTeeStart.x + 54} ${mapTeeStart.y - 132} ${mapTarget.x + 62} ${mapTarget.y + 88} ${mapTarget.x + 86} ${mapTarget.y + 168}`} />
                <ellipse className="holeMapBunker" cx="112" cy="210" rx="20" ry="12" transform="rotate(-24 112 210)" />
                <ellipse className="holeMapBunker" cx="316" cy="170" rx="24" ry="13" transform="rotate(18 316 170)" />
                <ellipse className="holeMapGreen" cx={mapTarget.greenX} cy={mapTarget.greenY} rx="44" ry="34" transform={`rotate(${activeHole.hole % 2 ? -18 : 15} ${mapTarget.greenX} ${mapTarget.greenY})`} />
                <path className="holeMapPinLine" d={`M${mapLandingPoint.x} ${mapLandingPoint.y} L${mapTarget.x} ${mapTarget.y}`} />
                <path className="holeMapTargetLine" d={`M${mapTeeStart.x} ${mapTeeStart.y} C${mapTeeStart.x + 10} 430 250 305 ${mapLandingPoint.x} ${mapLandingPoint.y}`} />
                <circle className="holeMapLandingRing" cx={mapLandingPoint.x} cy={mapLandingPoint.y} r="21" />
                <circle className={`holeMapTeeMarker holeMapTeeMarker--${mapTeeColor}`} cx={mapTeeStart.x} cy={mapTeeStart.y} r="22" />
                <circle className="holeMapGolferRing" cx={mapTeeStart.x} cy={mapTeeStart.y} r="20" />
                <circle className="holeMapGolfer" cx={mapTeeStart.x} cy={mapTeeStart.y} r="7" />
                <path className="holeMapFlagPole" d={`M${mapTarget.x} ${mapTarget.y} v-42`} />
                <path className="holeMapFlag" d={`M${mapTarget.x} ${mapTarget.y - 42} l32 10 -32 10Z`} />
                <circle className="holeMapCup" cx={mapTarget.x} cy={mapTarget.y} r="4" />
                <text className="holeMapShotLabel" x={mapLandingPoint.x + mapLandingPoint.labelDx} y={mapLandingPoint.y + mapLandingPoint.labelDy}>{formatYardage(mapCarryDistance)}</text>
                <text className="holeMapPinLabel" x={mapTarget.x - 72} y={Math.max(34, mapTarget.y + 28)}>{mapPinDistanceLabel}</text>
                <rect className="holeMapTree" x="92" y="472" width="18" height="42" rx="3" transform="rotate(-14 101 493)" />
                <rect className="holeMapTree" x="314" y="424" width="18" height="42" rx="3" transform="rotate(18 323 445)" />
                <rect className="holeMapTree" x="260" y="62" width="18" height="42" rx="3" transform="rotate(20 269 83)" />
              </svg>
            </div>

            <footer className="holeMapFooter">
              <div>
                <span>Hole</span>
                <strong>{mapHoleLabel}</strong>
              </div>
              <div>
                <span>Par {mapParLabel}</span>
                <span>{mapTeeLabel} tees</span>
                <span>HCP {activeHole.strokeIndex || '—'}</span>
              </div>
              <div>
                <span>{hasFlagCoordinates ? 'Golfbert flag coordinates loaded' : 'Golfbert flag coordinates unavailable'}</span>
                <span>{mapLocationStatus || 'Open map uses golfer GPS when available.'}</span>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      <div className="holeInputCompletionIndicator" aria-live="polite">
        <span className="holeInputCompletionSummary">{providedCount} of 18 holes provided</span>
        <div className="holeInputTrackerList" aria-label="All 18 hole score tracker">
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
          <span>Cumulative score</span>
          <strong>{loading ? '…' : scoreTotal}</strong>
        </div>
      </div>
    </div>
  )
}
