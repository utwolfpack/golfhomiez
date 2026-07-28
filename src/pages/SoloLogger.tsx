import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { useGolfCourseStates } from '../hooks/useGolfCourseStates'
import { useNavigate } from 'react-router'
import { getUserTodayISO } from '../lib/date'
import HoleByHoleScorecard from '../components/HoleByHoleScorecard'
import type { PendingHoleScoreSaveHandler } from '../components/HoleByHoleScorecard'
import TeeColorSelector from '../components/TeeColorSelector'
import GolfCourseInput from '../components/GolfCourseInput'
import { buildClientDefaultHoleScorecard, mergeProvidedHoleScores, normalizeHoleScorecard, providedHoleScoreTotal } from '../lib/hole-scorecard'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'
import type { HoleScoreDetail, SoloScoreEntry } from '../types'
import type { TeeColorSelection } from '../lib/tee-colors'
import { DEFAULT_TEE_COLOR, normalizeTeeColor } from '../lib/tee-colors'

type ExistingSoloRoundResponse = {
  score: SoloScoreEntry | null
}

function parseStoredHoles(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function getProvidedHoleCount(holes: HoleScoreDetail[]) {
  return holes.filter((hole) => hole.scoreProvided).length
}

function getProvidedHoleScoreTotal(holes: HoleScoreDetail[]) {
  return providedHoleScoreTotal(holes)
}

function buildSoloRoundMissingFields({ date, today, state, course, scoreValue, requireManualRoundScore }: { date: string; today: string; state: string; course: string; scoreValue: unknown; requireManualRoundScore: boolean }) {
  const missing: string[] = []
  const scoreNum = Number(scoreValue)
  const scoreText = String(scoreValue ?? '')
  if (!date) missing.push('Date')
  if (date && date > today) missing.push('Date cannot be in the future')
  if (!state) missing.push('State')
  if (!course) missing.push('Course')
  if (requireManualRoundScore && (scoreText === '' || Number.isNaN(scoreNum))) missing.push('Round Score')
  if ((requireManualRoundScore || scoreText !== '') && !Number.isNaN(scoreNum) && scoreNum < 0) missing.push('Round Score must be zero or greater')
  return missing
}

export default function SoloLogger() {
  const { user } = useAuth()
  const nav = useNavigate()
  const today = getUserTodayISO()

  const [date, setDate] = useState(() => getUserTodayISO())
  const [state, setState] = useState('UT')
  const [course, setCourse] = useState('')
  const [courseId, setCourseId] = useState('')
  const [courseSearch, setCourseSearch] = useState('')
  const [teeColor, setTeeColor] = useState<TeeColorSelection>('')
  const [roundScore, setRoundScore] = useState<string>('')
  const [useHoles, setUseHoles] = useState(true)
  const [holes, setHoles] = useState<HoleScoreDetail[]>(() => buildClientDefaultHoleScorecard('UT', '', DEFAULT_TEE_COLOR))
  const [persistedSoloScoreId, setPersistedSoloScoreId] = useState<string | null>(null)
  const [persistedSoloHoles, setPersistedSoloHoles] = useState<HoleScoreDetail[] | null>(null)

  const [saving, setSaving] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showValidation, setShowValidation] = useState(false)

  const pendingHoleSaveRef = useRef<PendingHoleScoreSaveHandler | null>(null)

  const { states: stateOptions, loading: statesLoading, error: statesError } = useGolfCourseStates()
  const providedHoleCount = useMemo(() => getProvidedHoleCount(holes), [holes])
  const currentHoleScoreTotal = useMemo(() => getProvidedHoleScoreTotal(holes), [holes])
  const soloScorecardSetupReady = useMemo(() => Boolean(useHoles && state && course.trim() && teeColor), [useHoles, state, course, teeColor])
  const roundContextLocked = useMemo(() => useHoles && holes.some((hole) => hole.scoreProvided), [useHoles, holes])
  const totalHoleCount = useMemo(() => Math.max(1, Math.min(18, holes.length || 18)), [holes])
  const incompleteRoundLabel = providedHoleCount > 0 && providedHoleCount < totalHoleCount ? `${providedHoleCount} of ${totalHoleCount} holes saved` : ''

  useEffect(() => {
    if (!useHoles) return
    setRoundScore(String(currentHoleScoreTotal))
  }, [useHoles, currentHoleScoreTotal])

  useEffect(() => {
    if (stateOptions.length && !stateOptions.some(option => option.abbr === state)) {
      setState(stateOptions[0].abbr)
      setCourse('')
      setCourseId('')
      setCourseSearch('')
    }
  }, [stateOptions, state])

  useEffect(() => {
    if (!user || !date || !state || !course) {
      setPersistedSoloScoreId(null)
      setPersistedSoloHoles(null)
      return
    }

    let cancelled = false
    const correlationId = getCorrelationId()

    async function loadExistingSoloRound() {
      try {
        const params = new URLSearchParams({ date, state, course })
        if (courseId) params.set('courseId', courseId)
        logFrontendEvent({ category: 'solo.round.progress', message: 'existing_round_lookup_started', data: { correlationId, date, state, course, courseId } })
        const result = await api<ExistingSoloRoundResponse>(`/api/solo-round-score?${params.toString()}`)
        if (cancelled) return

        const score = result.score
        setPersistedSoloScoreId(score?.id || null)

        const storedHoles = parseStoredHoles((score as any)?.holes ?? (score as any)?.holes_json)
        if (score && storedHoles?.length) {
          const normalizedStoredHoles = normalizeHoleScorecard(storedHoles, state, course, normalizeTeeColor((score as any).teeColor || teeColor || DEFAULT_TEE_COLOR))
          setPersistedSoloHoles(normalizedStoredHoles)
          setHoles((current) => mergeProvidedHoleScores(current, normalizedStoredHoles))
          setRoundScore(String(Number.isFinite(Number(score.roundScore)) ? Number(score.roundScore) : getProvidedHoleScoreTotal(normalizedStoredHoles)))
        } else {
          setPersistedSoloHoles(null)
        }

        logFrontendEvent({ category: 'solo.round.progress', message: 'existing_round_lookup_succeeded', data: { correlationId, date, state, course, courseId, scoreId: score?.id || null, restoredHoleCount: storedHoles?.filter((hole: any) => Boolean(hole?.scoreProvided ?? hole?.score_provided)).length || 0 } })
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Could not check for saved round progress.'
        setPersistedSoloScoreId(null)
        setPersistedSoloHoles(null)
        logFrontendEvent({ category: 'solo.round.progress', level: 'warn', message: 'existing_round_lookup_failed', data: { correlationId, date, state, course, courseId, error: message } })
      }
    }

    void loadExistingSoloRound()
    return () => { cancelled = true }
  }, [user?.id, user?.email, date, state, course])

  const missingFields = useMemo(() => buildSoloRoundMissingFields({
    date,
    today,
    state,
    course,
    scoreValue: roundScore,
    requireManualRoundScore: !useHoles,
  }), [date, today, state, course, roundScore, useHoles])

  async function cancelSoloRoundRecords() {
    if (!useHoles || !date || !state || !course) return null
    const params = new URLSearchParams({ mode: 'solo', date, state, course })
    if (courseId) params.set('courseId', courseId)
    if (persistedSoloScoreId) params.set('scoreId', persistedSoloScoreId)
    return api(`/api/scores/cancel-round?${params.toString()}`, { method: 'DELETE' })
  }

  async function clearSoloDraft() {
    if (!useHoles || !date || !state || !course) return null
    const params = new URLSearchParams({ mode: 'solo', date, state, course, scoringSide: 'team' })
    const correlationId = getCorrelationId()
    logFrontendEvent({ category: 'solo.round.progress', message: 'draft_clear_started_after_progress_save', data: { correlationId, date, state, course, courseId } })
    const result = await api(`/api/scorecard-drafts?${params.toString()}`, { method: 'DELETE' })
    logFrontendEvent({ category: 'solo.round.progress', message: 'draft_clear_succeeded_after_progress_save', data: { correlationId, date, state, course, courseId, result } })
    return result
  }

  async function handleCancelRound() {
    const correlationId = getCorrelationId()
    setCanceling(true)
    setError(null)
    logFrontendEvent({ category: 'solo.round.cancel', message: 'started', data: { correlationId, date, state, course, courseId, teeColor, useHoles, savedHoleCount: providedHoleCount, scoreId: persistedSoloScoreId, roundActionSummaryVisible: false, savedHolesSummaryVisible: false } })
    try {
      const cancelResult = await cancelSoloRoundRecords()
      logFrontendEvent({ category: 'solo.round.cancel', message: 'succeeded', data: { correlationId, scoreId: persistedSoloScoreId, cancelResult } })
      nav('/my-golf-scores')
    } catch (e: any) {
      const message = e?.message || 'Could not cancel this round.'
      logFrontendEvent({ category: 'solo.round.cancel', level: 'error', message: 'failed', data: { correlationId, scoreId: persistedSoloScoreId, error: message } })
      setError(message)
    } finally {
      setCanceling(false)
    }
  }

  async function handleCloseRound() {
    const correlationId = getCorrelationId()
    setClosing(true)
    setError(null)
    logFrontendEvent({ category: 'solo.round.close', message: 'started', data: { correlationId, date, state, course, courseId, teeColor, scoreId: persistedSoloScoreId, savedHoleCount: providedHoleCount, incomplete: Boolean(incompleteRoundLabel), pendingHoleFlushRegistered: Boolean(pendingHoleSaveRef.current), roundActionSummaryVisible: false, savedHolesSummaryVisible: false } })
    try {
      const pendingSaveResult = useHoles && pendingHoleSaveRef.current
        ? await pendingHoleSaveRef.current('solo_close_button')
        : { saved: false, hole: null, providedHoleNumbers: [] }
      logFrontendEvent({ category: 'solo.round.close', message: 'succeeded', data: { correlationId, scoreId: persistedSoloScoreId, pendingHoleSaved: pendingSaveResult.saved, pendingHole: pendingSaveResult.hole, providedHoleNumbers: pendingSaveResult.providedHoleNumbers } })
      nav('/my-golf-scores')
    } catch (e: any) {
      const message = e?.message || 'Could not save the current hole score before closing.'
      logFrontendEvent({ category: 'solo.round.close', level: 'error', message: 'failed', data: { correlationId, scoreId: persistedSoloScoreId, error: message } })
      setError(message)
    } finally {
      setClosing(false)
    }
  }

  async function handleSoloHoleSaved(nextHoles: HoleScoreDetail[], savedHole: HoleScoreDetail) {
    setError(null)
    setShowValidation(true)
    const correlationId = getCorrelationId()
    const nextProvidedHoleCount = getProvidedHoleCount(nextHoles)
    const nextScoreTotal = getProvidedHoleScoreTotal(nextHoles)
    const effectiveTeeColor = normalizeTeeColor(teeColor)
    const scoreNum = nextProvidedHoleCount > 0 ? nextScoreTotal : Number(roundScore)

    const derivedMissingFields = buildSoloRoundMissingFields({
      date,
      today,
      state,
      course,
      scoreValue: scoreNum,
      requireManualRoundScore: false,
    })

    if (derivedMissingFields.length) {
      const message = `Please complete: ${derivedMissingFields.join(', ')}`
      setError(message)
      logFrontendEvent({ category: 'solo.round.progress', level: 'warn', message: 'hole_progress_validation_failed', data: { correlationId, missingFields: derivedMissingFields, hole: savedHole.hole, derivedRoundScoreFromHoles: true } })
      throw new Error(message)
    }
    if (!user) {
      const message = 'Please login to log a round.'
      setError(message)
      throw new Error(message)
    }
    if (!Number.isFinite(scoreNum) || scoreNum < 0) {
      const message = 'Round Score must be zero or greater.'
      setError(message)
      throw new Error(message)
    }

    setSaving(true)
    logFrontendEvent({ category: 'solo.round.progress', message: 'hole_progress_save_started', data: { correlationId, date, state, course, courseId, teeColor: effectiveTeeColor, teeColorSelected: Boolean(teeColor), scoreId: persistedSoloScoreId, hole: savedHole.hole, savedHoleCount: nextProvidedHoleCount, roundScore: scoreNum, derivedRoundScoreFromHoles: true } })
    try {
      const payload = {
        mode: 'solo',
        date,
        state,
        course,
        courseId,
        teeColor: effectiveTeeColor,
        roundScore: scoreNum,
        holes: nextHoles,
      }
      const savedScore = persistedSoloScoreId
        ? await api<SoloScoreEntry>(`/api/scores/${encodeURIComponent(persistedSoloScoreId)}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<SoloScoreEntry>('/api/scores', { method: 'POST', body: JSON.stringify(payload) })

      setPersistedSoloScoreId(savedScore.id)
      setPersistedSoloHoles(normalizeHoleScorecard((savedScore as any).holes ?? nextHoles, state, course, effectiveTeeColor))
      setRoundScore(String(scoreNum))
      try {
        await clearSoloDraft()
      } catch (draftError) {
        const message = draftError instanceof Error ? draftError.message : 'Could not clear solo draft after progress save.'
        logFrontendEvent({ category: 'solo.round.progress', level: 'warn', message: 'draft_clear_failed_after_progress_save', data: { correlationId, scoreId: savedScore.id, error: message } })
      }
      logFrontendEvent({ category: 'solo.round.progress', message: 'hole_progress_save_succeeded', data: { correlationId, scoreId: savedScore.id, hole: savedHole.hole, savedHoleCount: nextProvidedHoleCount, totalHoleCount: nextHoles.length || totalHoleCount, roundScore: scoreNum, derivedRoundScoreFromHoles: true, incomplete: nextProvidedHoleCount > 0 && nextProvidedHoleCount < (nextHoles.length || totalHoleCount) } })
    } catch (e: any) {
      const message = e?.message || 'Failed to save round progress.'
      logFrontendEvent({ category: 'solo.round.progress', level: 'error', message: 'hole_progress_save_failed', data: { correlationId, scoreId: persistedSoloScoreId, hole: savedHole.hole, error: message } })
      setError(message)
      throw e
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        {!user ? (
          <div className="small" style={{ marginTop: 10 }}>
            You’re not logged in. Please login to log rounds.
          </div>
        ) : null}

        <form onSubmit={(event) => event.preventDefault()} style={{ marginTop: 14 }}>
          {soloScorecardSetupReady ? null : (
            <div className="grid grid3" style={{ gap: 12 }}>
              <div>
                <label className="label">Date</label>
                <input className="input" type="date" max={today} value={date} onChange={e => setDate(e.target.value)} />
              </div>

              <div>
                <label className="label">State</label>
                <select className="input" value={state} onChange={e => { setState(e.target.value); setCourse(''); setCourseId(''); setCourseSearch('') }} disabled={statesLoading && !stateOptions.length}>
                  {!stateOptions.length ? <option value={state}>{statesLoading ? 'Loading golf course states…' : (state || 'No golf course states available')}</option> : null}
                  {stateOptions.map(s => (
                    <option key={s.abbr} value={s.abbr}>{s.name}</option>
                  ))}
                </select>
                {statesError ? <div className="small">{statesError}</div> : null}
              </div>

              <div>
                <GolfCourseInput
                  label="Course"
                  state={state}
                  searchValue={courseSearch}
                  selectedCourseName={course}
                  selectedCourseId={courseId}
                  onSearchChange={(next) => {
                    setCourseSearch(next)
                    setCourse('')
                    setCourseId('')
                  }}
                  onCourseSelected={(selected) => {
                    setCourseId(selected.id || '')
                    setCourse(selected.name || '')
                    setCourseSearch(selected.name || '')
                  }}
                  placeholder="Search courses in the selected state"
                  helperText="Search checks every available course for the selected state."
                  inputId="soloRoundCourseSearch"
                  enableNearestDefault
                  onStateChange={setState}
                  disabled={roundContextLocked}
                  required
                />
              </div>

              <TeeColorSelector value={teeColor} onChange={setTeeColor} label="Tees played" />

              {!useHoles ? (
                <div>
                  <label className="label">Round Score</label>
                  <input
                    className="input"
                    type="number"
                    inputMode="numeric"
                    value={roundScore}
                    onChange={e => setRoundScore(e.target.value)}
                    placeholder="e.g. 82"
                    min={0}
                  />
                </div>
              ) : null}
            </div>
          )}

          <HoleByHoleScorecard
            enabled={soloScorecardSetupReady}
            stateCode={state}
            course={course}
            courseId={courseId}
            holes={holes}
            onChange={setHoles}
            onHoleSaved={handleSoloHoleSaved}
            draftContext={{ mode: 'solo', date }}
            compactMobileInput
            teeColor={teeColor}
            persistedHoles={persistedSoloHoles}
            registerPendingHoleSave={(handler) => { pendingHoleSaveRef.current = handler }}
          />

          {incompleteRoundLabel ? <div className="roundIncompleteBadge soloIncompleteRoundBadge" style={{ marginTop: 10 }}>Incomplete round • {incompleteRoundLabel}</div> : null}
          {showValidation && missingFields.length ? <div className="small" style={{ color: 'crimson', marginTop: 10 }}>Missing or invalid: {missingFields.join(', ')}</div> : null}
          {error ? <div className="small" style={{ color: 'crimson', marginTop: 10 }}>{error}</div> : null}

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btnPrimary" type="button" disabled={saving || canceling || closing} onClick={handleCloseRound}>
              {closing ? 'Closing…' : 'Close'}
            </button>
            {useHoles ? (
              <button className="btn" type="button" disabled={saving || canceling || closing} onClick={handleCancelRound}>
                {canceling ? 'Canceling…' : 'Cancel Round'}
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  )
}
