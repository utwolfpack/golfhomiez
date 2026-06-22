import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { golfCourseNames, searchGolfCourses } from '../lib/golf-courses'
import { US_STATES } from '../data/usStates'
import { useNavigate } from 'react-router-dom'
import { getUserTodayISO } from '../lib/date'
import HoleByHoleScorecard from '../components/HoleByHoleScorecard'
import type { PendingHoleScoreSaveHandler } from '../components/HoleByHoleScorecard'
import TeeColorSelector from '../components/TeeColorSelector'
import { buildClientDefaultHoleScorecard, holeScoreTotal, mergeProvidedHoleScores, normalizeHoleScorecard } from '../lib/hole-scorecard'
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
  return holes
    .filter((hole) => hole.scoreProvided)
    .reduce((sum, hole) => sum + (Number.isFinite(hole.score) ? hole.score : 0), 0)
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

  const [courses, setCourses] = useState<string[]>([])
  const holesTotal = useMemo(() => holeScoreTotal(holes), [holes])
  const providedHoleCount = useMemo(() => getProvidedHoleCount(holes), [holes])
  const providedHoleScoreTotal = useMemo(() => getProvidedHoleScoreTotal(holes), [holes])
  const roundContextLocked = useMemo(() => useHoles && holes.some((hole) => hole.scoreProvided), [useHoles, holes])
  const incompleteRoundLabel = providedHoleCount > 0 && providedHoleCount < 18 ? `${providedHoleCount} of 18 holes saved` : ''

  useEffect(() => {
    if (!useHoles) return
    setRoundScore(String(providedHoleCount > 0 ? providedHoleScoreTotal : holesTotal))
  }, [useHoles, holesTotal, providedHoleCount, providedHoleScoreTotal])

  useEffect(() => {
    let cancelled = false

    async function loadCourses() {
      try {
        const options = await searchGolfCourses({ state, limit: 100 })
        const names = golfCourseNames(options)
        if (cancelled) return
        setCourses(names)
        setCourse(prev => (prev && names.includes(prev) ? prev : (names[0] || '')))
      } catch {
        if (cancelled) return
        setCourses([])
        setCourse('')
      }
    }

    loadCourses()
    return () => { cancelled = true }
  }, [state])

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
        logFrontendEvent({ category: 'solo.round.progress', message: 'existing_round_lookup_started', data: { correlationId, date, state, course } })
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

        logFrontendEvent({ category: 'solo.round.progress', message: 'existing_round_lookup_succeeded', data: { correlationId, date, state, course, scoreId: score?.id || null, restoredHoleCount: storedHoles?.filter((hole: any) => Boolean(hole?.scoreProvided ?? hole?.score_provided)).length || 0 } })
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Could not check for saved round progress.'
        setPersistedSoloScoreId(null)
        setPersistedSoloHoles(null)
        logFrontendEvent({ category: 'solo.round.progress', level: 'warn', message: 'existing_round_lookup_failed', data: { correlationId, date, state, course, error: message } })
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

  function resetSoloLoggerPage() {
    setDate(getUserTodayISO())
    setState('UT')
    setCourse('')
    setRoundScore('')
    setTeeColor('')
    setUseHoles(true)
    setHoles(buildClientDefaultHoleScorecard('UT', '', DEFAULT_TEE_COLOR))
    setPersistedSoloScoreId(null)
    setPersistedSoloHoles(null)
    setError(null)
    setShowValidation(false)
  }

  async function clearSoloDraft() {
    if (!useHoles || !date || !state || !course) return
    const params = new URLSearchParams({ mode: 'solo', date, state, course })
    await api(`/api/scorecard-drafts?${params.toString()}`, { method: 'DELETE' })
  }

  async function handleCancelRound() {
    const correlationId = getCorrelationId()
    setCanceling(true)
    setError(null)
    logFrontendEvent({ category: 'solo.round.cancel', message: 'started', data: { correlationId, date, state, course, teeColor, useHoles, savedHoleCount: providedHoleCount, scoreId: persistedSoloScoreId, roundActionSummaryVisible: true, savedHolesSummaryVisible: false } })
    try {
      await clearSoloDraft()
      if (persistedSoloScoreId) {
        await api(`/api/scores/${encodeURIComponent(persistedSoloScoreId)}`, { method: 'DELETE' })
      }
      resetSoloLoggerPage()
      logFrontendEvent({ category: 'solo.round.cancel', message: 'succeeded', data: { correlationId, scoreId: persistedSoloScoreId } })
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
    logFrontendEvent({ category: 'solo.round.close', message: 'started', data: { correlationId, date, state, course, teeColor, scoreId: persistedSoloScoreId, savedHoleCount: providedHoleCount, incomplete: Boolean(incompleteRoundLabel), pendingHoleFlushRegistered: Boolean(pendingHoleSaveRef.current), roundActionSummaryVisible: true, savedHolesSummaryVisible: false } })
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
    logFrontendEvent({ category: 'solo.round.progress', message: 'hole_progress_save_started', data: { correlationId, date, state, course, teeColor: effectiveTeeColor, teeColorSelected: Boolean(teeColor), scoreId: persistedSoloScoreId, hole: savedHole.hole, savedHoleCount: nextProvidedHoleCount, roundScore: scoreNum, derivedRoundScoreFromHoles: true } })
    try {
      const payload = {
        mode: 'solo',
        date,
        state,
        course,
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
      logFrontendEvent({ category: 'solo.round.progress', message: 'hole_progress_save_succeeded', data: { correlationId, scoreId: savedScore.id, hole: savedHole.hole, savedHoleCount: nextProvidedHoleCount, roundScore: scoreNum, derivedRoundScoreFromHoles: true, incomplete: nextProvidedHoleCount > 0 && nextProvidedHoleCount < 18 } })
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
        <h1 className="pageSimpleTitle">Solo Round</h1>
        {!user ? (
          <div className="small" style={{ marginTop: 10 }}>
            You’re not logged in. Please login to log rounds.
          </div>
        ) : null}

        <form onSubmit={(event) => event.preventDefault()} style={{ marginTop: 14 }}>
          {roundContextLocked ? null : (
            <div className="grid grid3" style={{ gap: 12 }}>
              <div>
                <label className="label">Date</label>
                <input className="input" type="date" max={today} value={date} onChange={e => setDate(e.target.value)} />
              </div>

              <div>
                <label className="label">State</label>
                <select className="input" value={state} onChange={e => { setState(e.target.value); setCourse('') }}>
                  {US_STATES.map(s => (
                    <option key={s.abbr} value={s.abbr}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Course</label>
                <select className="input" value={course} onChange={e => setCourse(e.target.value)} disabled={!courses.length}>
                  {!courses.length ? <option value="">No courses available</option> : null}
                  {courses.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
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
            enabled={useHoles}
            stateCode={state}
            course={course}
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

          <div className="soloLockedRoundSummary soloRoundActionSummary" aria-label="Selected round details">
            <div className="roundSummaryDate">
              <span>Date</span>
              <strong>{date}</strong>
            </div>
            <div className="roundSummaryCourse">
              <span>Course</span>
              <strong>{course || 'Selected course'}</strong>
            </div>
          </div>

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
