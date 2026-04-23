import { FormEvent, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import PageHero from '../components/PageHero'
import GolfCourseInput from '../components/GolfCourseInput'
import { useHostAuth } from '../context/HostAuthContext'

export default function RedeemHostInvite() {
  const [params] = useSearchParams()
  const [email, setEmail] = useState(params.get('email') || '')
  const [golfCourseName, setGolfCourseName] = useState('')
  const [securityKey, setSecurityKey] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { registerHost } = useHostAuth()

  const helperText = useMemo(
    () => params.get('email')
      ? 'Use the approved email from the link and the security key from your invite email.'
      : 'Enter the approved email address and the security key from your invite email.',
    [params],
  )

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (!email.trim()) throw new Error('Invite email is required')
      if (!golfCourseName.trim()) throw new Error('Golf-course name is required')
      if (!securityKey.trim()) throw new Error('Security key is required')
      if (password.length < 8) throw new Error('Password must be at least 8 characters')
      if (password !== confirmPassword) throw new Error('Passwords do not match')
      await registerHost({ email: email.trim(), golfCourseName: golfCourseName.trim(), securityKey: securityKey.trim(), password })
      navigate('/host/portal', { replace: true })
    } catch (err: any) {
      setError(err?.message || 'Could not create golf-course account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Golf-course invite" title="Create your golf-course account" subtitle="Finish the invite by entering the email and security key you received, then set your host password." />
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 560 }}>
          <div className="small">{helperText}</div>
          <div>
            <label className="label">Invited email</label>
            <input className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="course@example.com" />
          </div>
          <GolfCourseInput
            label="Golf-course account name"
            value={golfCourseName}
            onChange={setGolfCourseName}
            datalistId="host-account-course-options"
            helperText="Search the imported golf course catalog and pick the course tied to this host account."
            placeholder="Start typing the golf course name…"
          />
          <div>
            <label className="label">Security key</label>
            <input className="input" value={securityKey} onChange={e => setSecurityKey(e.target.value)} placeholder="Enter the security key from your invite" />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Create a host password" />
          </div>
          <div>
            <label className="label">Confirm password</label>
            <input className="input" type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter the host password" />
          </div>
          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy}>{busy ? 'Creating…' : 'Create golf-course account'}</button>
            <Link className="btn" to="/host/login">Already have a host account?</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
