import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { US_STATES } from '../data/usStates'
import { useNavigate } from 'react-router-dom'
import UseMyLocationButton from '../components/UseMyLocationButton'
import { getUserTodayISO } from '../lib/date'
import HoleByHoleScorecard from '../components/HoleByHoleScorecard'
import { buildClientDefaultHoleScorecard, holeScoreTotal, missingHoleScoreNumbers } from '../lib/hole-scorecard'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'
import type { HoleScoreDetail } from '../types'

export default function SoloLogger() {
  const { user } = useAuth()
  const nav = useNavigate()
  const today = getUserTodayISO()

  const [date, setDate] = useState(() => getUserTodayISO())
  const [state, setState] = useState('UT')
  const [course, setCourse] = useState('')
  const [roundScore, setRoundScore] = useState<string>('')
  const [useHoles, setUseHoles] = useState(true)
  const [holes, setHoles] = useState<HoleScoreDetail[]>(() => buildClientDefaultHoleScorecard('UT', ''))

  const [saving, setSaving] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locationMessage, setLocationMessage] = useState<string | null>(null)
  const [showValidation, setShowValidation] = useState(false)

  const [courses, setCourses] = useState<string[]>([])
  const holesTotal = useMemo(() => holeScoreTotal(holes), [holes])
  const missingHoleNumbers = useMemo(() => missingHoleScoreNumbers(holes), [holes])
  const roundContextLocked = useMemo(() => useHoles && holes.some((hole) => hole.scoreProvided), [useHoles, holes])

  useEffect(() => {
    if (!useHoles) return
    setRoundScore(String(holesTotal))
  }, [useHoles, holesTotal])
  useEffect(() => {
    let cancelled = false

    async function loadCourses() {
      try {
        const names = await api<string[]>(`/api/golf-courses?state=${encodeURIComponent(state)}`)
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

  const missingFields = useMemo(() => {
    const missing: string[] = []
    const scoreNum = Number(roundScore)
    if (!date) missing.push('Date')
    if (date && date > today) missing.push('Date cannot be in the future')
    if (!state) missing.push('State')
    if (!course) missing.push('Course')
    if (roundScore === '' || Number.isNaN(scoreNum)) missing.push('Round Score')
    if (roundScore !== '' && !Number.isNaN(scoreNum) && scoreNum < 0) missing.push('Round Score must be zero or greater')
    return missing
  }, [date, today, state, course, roundScore])

  function resetSoloLoggerPage() {
    setDate(getUserTodayISO())
    setState('UT')
    setCourse('')
    setRoundScore('')
    setUseHoles(true)
    setHoles(buildClientDefaultHoleScorecard('UT', ''))
    setError(null)
    setLocationMessage(null)
    setShowValidation(false)
  }

  async function handleCancelRound() {
    const correlationId = getCorrelationId()
    setCanceling(true)
    setError(null)
    logFrontendEvent({ category: 'solo.round.cancel', message: 'started', data: { correlationId, date, state, course, useHoles, savedHoleCount: holes.filter((hole) => hole.scoreProvided).length } })
    try {
      if (useHoles && date && state && course) {
        const params = new URLSearchParams({ mode: 'solo', date, state, course })
        await api(`/api/scorecard-drafts?${params.toString()}`, { method: 'DELETE' })
      }
      resetSoloLoggerPage()
      logFrontendEvent({ category: 'solo.round.cancel', message: 'succeeded', data: { correlationId } })
    } catch (e: any) {
      const message = e?.message || 'Could not cancel this round.'
      logFrontendEvent({ category: 'solo.round.cancel', level: 'error', message: 'failed', data: { correlationId, error: message } })
      setError(message)
    } finally {
      setCanceling(false)
    }
  }


  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setShowValidation(true)
    const correlationId = getCorrelationId()
    if (missingFields.length) {
      setError(`Please complete: ${missingFields.join(', ')}`)
      logFrontendEvent({ category: 'solo.round.save', level: 'warn', message: 'validation_failed', data: { correlationId, missingFields, useHoles } })
      return
    }
    if (useHoles && missingHoleNumbers.length) {
      const message = `Finish entering scores for holes: ${missingHoleNumbers.join(', ')}.`
      setError(message)
      logFrontendEvent({ category: 'solo.round.save', level: 'warn', message: 'hole_scores_incomplete', data: { correlationId, missingHoleNumbers } })
      return
    }
    if (!user) {
      setError('Please login to log a round.')
      return
    }
    const scoreNum = Number(roundScore)
    if (!date) return setError('Date is required.')
    if (date > today) return setError('Date cannot be in the future.')
    if (!state) return setError('State is required.')
    if (!course) return setError('Course is required.')
    if (!roundScore || Number.isNaN(scoreNum)) return setError('Round Score is required.')
    if (scoreNum < 0) return setError('Round Score must be zero or greater.')

    setSaving(true)
    logFrontendEvent({ category: 'solo.round.save', message: 'started', data: { correlationId, date, state, course, roundScore: scoreNum, useHoles, cumulativeScore: useHoles ? holesTotal : null } })
    try {
      await api('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'solo',
          date,
          state,
          course,
          roundScore: useHoles ? holesTotal : scoreNum,
          holes: useHoles ? holes : null
        })
      })
      logFrontendEvent({ category: 'solo.round.save', message: 'succeeded', data: { correlationId, course, roundScore: useHoles ? holesTotal : scoreNum, useHoles } })
      nav('/')
    } catch (e: any) {
      const message = e?.message || 'Failed to save.'
      logFrontendEvent({ category: 'solo.round.save', level: 'error', message: 'failed', data: { correlationId, course, error: message, useHoles } })
      setError(message)
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

        <form onSubmit={onSubmit} style={{ marginTop: 14 }}>
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
                <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <UseMyLocationButton
                    onResolved={(location) => {
                      setState(location.stateCode)
                      setCourse('')
                      setLocationMessage(`Location set to ${location.label}.`)
                    }}
                    onStatus={setLocationMessage}
                  />
                  {locationMessage ? <span className="small">{locationMessage}</span> : null}
                </div>
              </div>

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
            draftContext={{ mode: 'solo', date }}
            compactMobileInput
          />

          {roundContextLocked ? (
            <div className="soloLockedRoundSummary" aria-label="Locked round details">
              <div>
                <span>Date</span>
                <strong>{date}</strong>
              </div>
              <div>
                <span>State</span>
                <strong>{state}</strong>
              </div>
              <div>
                <span>Course</span>
                <strong>{course || 'Selected course'}</strong>
              </div>
            </div>
          ) : null}

          {showValidation && missingFields.length ? <div className="small" style={{ color: 'crimson', marginTop: 10 }}>Missing or invalid: {missingFields.join(', ')}</div> : null}
          {error ? <div className="small" style={{ color: 'crimson', marginTop: 10 }}>{error}</div> : null}

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btnPrimary" type="submit" disabled={saving || canceling || !user}>
              {saving ? 'Saving…' : 'Save Round'}
            </button>
            {useHoles ? (
              <button className="btn" type="button" disabled={saving || canceling} onClick={handleCancelRound}>
                {canceling ? 'Canceling…' : 'Cancel Round'}
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  )
}
