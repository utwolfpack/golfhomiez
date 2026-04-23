import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { US_STATES } from '../data/usStates'
import { requestHostAccount } from '../lib/host-auth'
import { api } from '../lib/api'

export default function CreateHostAccount() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState('UT')
  const [course, setCourse] = useState('')
  const [courses, setCourses] = useState<string[]>([])
  const [representativeDetails, setRepresentativeDetails] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showThankYou, setShowThankYou] = useState(false)

  const selectedStateName = useMemo(
    () => US_STATES.find((entry) => entry.abbr === state)?.name || state,
    [state],
  )

  useEffect(() => {
    let cancelled = false

    async function loadCourses() {
      try {
        const names = await api<string[]>(`/api/golf-courses?state=${encodeURIComponent(state)}`)
        if (cancelled) return
        setCourses(names)
        setCourse((prev) => (prev && names.includes(prev) ? prev : (names[0] || '')))
      } catch {
        if (cancelled) return
        setCourses([])
        setCourse('')
      }
    }

    loadCourses()
    return () => {
      cancelled = true
    }
  }, [state])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      if (!firstName.trim()) throw new Error('First name is required.')
      if (!lastName.trim()) throw new Error('Last name is required.')
      if (!email.trim()) throw new Error('Email is required.')
      if (!state.trim()) throw new Error('State is required.')
      if (!course.trim()) throw new Error('Golf Course is required.')
      if (!representativeDetails.trim()) throw new Error('Representative details are required.')
      if (password.length < 8) throw new Error('Password must be at least 8 characters.')
      if (password !== confirmPassword) throw new Error('Passwords do not match.')

      await requestHostAccount({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        stateCode: state,
        stateName: selectedStateName,
        golfCourseName: course.trim(),
        representativeDetails: representativeDetails.trim(),
        password,
      })

      setShowThankYou(true)
      setFirstName('')
      setLastName('')
      setEmail('')
      setRepresentativeDetails('')
      setPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setError(err?.message || 'Could not submit golf-course account request.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Golf-course admins" title="Request your golf-course account" />
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 640 }}>
          <div className="grid grid2" style={{ gap: 12 }}>
            <div>
              <label className="label">First name</label>
              <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
            </div>
            <div>
              <label className="label">Last name</label>
              <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
            </div>
          </div>

          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>

          <div className="grid grid2" style={{ gap: 12 }}>
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="label">Confirm password</label>
              <input
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="grid grid2" style={{ gap: 12 }}>
            <div>
              <label className="label">State</label>
              <select className="input" value={state} onChange={(e) => { setState(e.target.value); setCourse('') }}>
                {US_STATES.map((entry) => (
                  <option key={entry.abbr} value={entry.abbr}>{entry.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Golf Course</label>
              <select className="input" value={course} onChange={(e) => setCourse(e.target.value)} disabled={!courses.length}>
                {!courses.length ? <option value="">No courses available</option> : null}
                {courses.map((entry) => (
                  <option key={entry} value={entry}>{entry}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">
              Share your title, relationship to the course, how you intend to use GolfHomiez and how you are authorized to request access.
            </label>
            <textarea
              className="input"
              value={representativeDetails}
              onChange={(e) => setRepresentativeDetails(e.target.value)}
              rows={5}
              placeholder="Example: I am the head golf professional for the course and I will use GolfHomiez to manage course-hosted play and communication."
            />
          </div>

          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button>
            <Link className="btn" to="/host/login">Host login</Link>
          </div>
        </form>
      </div>

      {showThankYou ? (
        <div className="modalOverlay" onMouseDown={() => setShowThankYou(false)}>
          <div className="modalCard" onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <h2 style={{ marginTop: 0 }}>Thank you</h2>
            <p>
              thank you for your Golf Homiez golf-course account request. Your request will be reviewed and you should hear back from us within 24-hours. Be in touch soon! :)
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btnPrimary" type="button" onClick={() => setShowThankYou(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
