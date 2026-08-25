import { FormEvent, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import PageHero from '../components/PageHero'
import PasswordCriteria from '../components/PasswordCriteria'
import { resetHostPassword } from '../lib/host-auth'
import { logFrontendEvent } from '../lib/frontend-logger'
import { assertPasswordPolicy } from '../lib/password-policy'

export default function HostResetPassword() {
  const [params] = useSearchParams()
  const token = useMemo(() => params.get('token') || '', [params])
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      if (!token) throw new Error('Reset token missing from the URL')
      assertPasswordPolicy(password)
      if (password !== confirmPassword) throw new Error('Passwords do not match')
      logFrontendEvent({ category: 'golf_course.password_reset', message: 'golf_course_password_reset_submit_started', data: { hasToken: Boolean(token) } })
      const result = await resetHostPassword(token, password)
      if (!result.response.ok) throw new Error((result.data as any)?.message || 'Could not reset golf course password')
      setMessage('Golf course password updated. Redirecting to golf course login…')
      logFrontendEvent({ category: 'golf_course.password_reset', message: 'golf_course_password_reset_submit_succeeded', data: { hasToken: Boolean(token) } })
      setTimeout(() => navigate('/host/login', { replace: true }), 1200)
    } catch (err: any) {
      const message = err?.message || 'Could not reset golf course password'
      setError(message)
      logFrontendEvent({ category: 'golf_course.password_reset', level: 'error', message: 'golf_course_password_reset_submit_failed', data: { hasToken: Boolean(token), error: message } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Set a new golf course password" title="Finish your golf-course password reset" subtitle="Choose a new password for the golf course portal, then sign in again." />
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 560 }}>
          <div>
            <label className="label">New password</label>
            <input className="input" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Create a new golf course password" minLength={10} />
            <PasswordCriteria password={password} />
          </div>
          <div>
            <label className="label">Confirm password</label>
            <input className="input" type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter the golf course password" minLength={10} />
          </div>
          {message ? <div className="small" style={{ color: '#166534' }}>{message}</div> : null}
          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy}>{busy ? 'Updating…' : 'Update golf course password'}</button>
            <Link className="btn" to="/host/login">Back to golf course login</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
