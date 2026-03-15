import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { US_STATES } from '../data/usStates'
import { getCoursesForState } from '../data/coursesByState'
import { useNavigate } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { getCourseDetails, calculateHandicapDifferential } from '../data/courseDetails'
import { useNearestCourseDefault } from '../hooks/useNearestCourseDefault'

export default function SoloLogger() {
  const { user } = useAuth()
  const nav = useNavigate()
  const today = new Date().toISOString().slice(0, 10)

  const statesWithCourses = useMemo(() => {
    return US_STATES.filter(s => getCoursesForState(s.abbr).length > 0)
  }, [])

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [state, setState] = useState('UT')
  const [course, setCourse] = useState('')
  const [roundScore, setRoundScore] = useState<string>('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const courses = useMemo(() => getCoursesForState(state), [state])
  const locationStatus = useNearestCourseDefault(state, course, setCourse, courses)
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

  useEffect(() => {
    if (course && courses.length && !courses.includes(course)) setCourse(courses[0] || '')
  }, [course, courses])

  const courseDetails = useMemo(() => getCourseDetails(state, course), [state, course])
  const handicapDifferential = useMemo(() => calculateHandicapDifferential(Number(roundScore), courseDetails?.courseRating ?? 72, courseDetails?.slopeRating ?? 113), [roundScore, courseDetails])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (missingFields.length) {
      setError(`Please complete: ${missingFields.join(', ')}`)
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
    try {
      await api('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'solo',
          date,
          state,
          course,
          roundScore: scoreNum,
          holes: null
        })
      })
      nav('/')
    } catch (e: any) {
      setError(e?.message || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow="Single-player rounds"
          title="Log a solo score without the clutter"
          subtitle="Pick the state, pick the course, save your round, and keep your personal scoring history tight."
        />

        {!user ? (
          <div className="small" style={{ marginTop: 10 }}>
            You’re not logged in. Please login to log rounds.
          </div>
        ) : null}

        <form onSubmit={onSubmit} style={{ marginTop: 14 }}>
          <div className="grid grid3" style={{ gap: 12 }}>
            <div>
              <label className="label">Date</label>
              <input className="input" type="date" max={today} value={date} onChange={e => setDate(e.target.value)} />
            </div>

            <div>
              <label className="label">State</label>
              <select className="input" value={state} onChange={e => { setState(e.target.value); setCourse('') }}>
                {statesWithCourses.map(s => (
                  <option key={s.abbr} value={s.abbr}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Course</label>
              <select className="input" value={course} onChange={e => setCourse(e.target.value)}>
                {courses.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <div className="small" style={{ marginTop: 6 }}>
                {locationStatus === 'granted' ? 'Defaulted to the nearest supported course for your location.' : locationStatus === 'requesting' ? 'Checking your location for the nearest course…' : 'Using the first course because location was unavailable.'}
              </div>
            </div>

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

            <div>
              <label className="label">Course handicap data</label>
              <input className="input inputReadOnly" readOnly value={courseDetails ? `Par ${courseDetails.par} • Rating ${courseDetails.courseRating.toFixed(1)} • Slope ${courseDetails.slopeRating}` : 'Waiting for course selection'} />
            </div>

            <div>
              <label className="label">Handicap differential</label>
              <input className="input inputReadOnly" readOnly value={handicapDifferential === null ? '' : handicapDifferential.toFixed(1)} />
              <div className="small" style={{ marginTop: 6 }}>Saved with the round so your handicap index can be tracked over time.</div>
            </div>
          </div>

          {missingFields.length ? <div className="small" style={{ color: 'crimson', marginTop: 10 }}>Missing or invalid: {missingFields.join(', ')}</div> : null}
          {error ? <div className="small" style={{ color: 'crimson', marginTop: 10 }}>{error}</div> : null}

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btnPrimary" type="submit" disabled={saving || !user}>
              {saving ? 'Saving…' : 'Save Round'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
