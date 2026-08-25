import { FormEvent, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import PageHero from '../components/PageHero'
import PasswordCriteria from '../components/PasswordCriteria'
import { resetPassword } from '../lib/auth-api'
import { assertPasswordPolicy } from '../lib/password-policy'
import { logFrontendEvent } from '../lib/frontend-logger'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = useMemo(() => params.get('token') || '', [params])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      if (!token) throw new Error('Reset token missing from the URL')
      assertPasswordPolicy(password)
      if (password !== confirmPassword) throw new Error('Passwords do not match')
      logFrontendEvent({ category: 'auth.password_reset', message: 'password_reset_submit_started', data: { hasToken: Boolean(token) } })
      const result = await resetPassword(token, password)
      if (result.error) throw new Error(result.error.message || 'Reset failed')
      setMessage('Password updated. Redirecting to login…')
      logFrontendEvent({ category: 'auth.password_reset', message: 'password_reset_submit_succeeded', data: { hasToken: Boolean(token) } })
      setTimeout(() => navigate('/login'), 1200)
    } catch (err: any) {
      const message = err?.message || 'Reset failed'
      setError(message)
      logFrontendEvent({ category: 'auth.password_reset', level: 'error', message: 'password_reset_submit_failed', data: { hasToken: Boolean(token), error: message } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow="Set a new password"
          title="Finish your password reset"
          subtitle="Choose a new password, then sign back in with your updated credentials."
        />
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 560 }}>
          <div>
            <label className="label">New password</label>
            <input className="input" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Create a new password" minLength={10} />
            <PasswordCriteria password={password} />
          </div>
          <div>
            <label className="label">Confirm password</label>
            <input className="input" type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" minLength={10} />
          </div>

          {message ? <div className="small" style={{ color: '#166534' }}>{message}</div> : null}
          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
            <Link className="btn" to="/login">Back to login</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
