import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { US_STATES } from '../data/usStates'
import { getCoursesForState } from '../data/coursesByState'
import { useNavigate } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { getUserTodayISO } from '../lib/date'

const NUM_HOLES = 18

export default function SoloLogger() {
  const { user } = useAuth()
  const nav = useNavigate()
  const today = getUserTodayISO()

  const statesWithCourses = useMemo(() => {
    return US_STATES.filter(s => getCoursesForState(s.abbr).length > 0)
  }, [])

  const [date, setDate] = useState(() => getUserTodayISO())
  const [state, setState] = useState('UT')
  const [course, setCourse] = useState('')
  const [roundScore, setRoundScore] = useState<string>('')
  const [useHoles, setUseHoles] = useState(false)
  const [holes, setHoles] = useState<number[]>(Array(NUM_HOLES).fill(0))

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showValidation, setShowValidation] = useState(false)

  const courses = useMemo(() => getCoursesForState(state), [state])
  const holesTotal = useMemo(() => holes.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0), [holes])
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
    if (!course && courses.length) setCourse(courses[0])
    if (course && courses.length && !courses.includes(course)) setCourse(courses[0] || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, courses.join('|')])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setShowValidation(true)
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
          holes: useHoles ? holes : null
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
              <label className="label">Per-hole entry (future-friendly)</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input type="checkbox" checked={useHoles} onChange={e => setUseHoles(e.target.checked)} />
                <span className="small">Enable 18-hole inputs (optional)</span>
              </div>
              {useHoles ? <div className="small" style={{ marginTop: 6 }}>Per-hole total: <strong>{holesTotal}</strong></div> : null}
            </div>
          </div>

          {useHoles ? (
            <div className="card" style={{ marginTop: 16, background: '#fafbff' }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Hole Scores (Course specific)</div>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 10 }}>
                {holes.map((v, idx) => (
                  <div key={idx}>
                    <label className="label">Hole {idx + 1}</label>
                    <input className="input" type="number" value={v} onChange={e => { const next = holes.slice(); next[idx] = Number(e.target.value); setHoles(next) }} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {showValidation && missingFields.length ? <div className="small" style={{ color: 'crimson', marginTop: 10 }}>Missing or invalid: {missingFields.join(', ')}</div> : null}
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
