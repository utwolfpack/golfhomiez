import { FormEvent, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { resetHostPassword } from '../lib/host-auth'

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
      if (password.length < 8) throw new Error('Password must be at least 8 characters')
      if (password !== confirmPassword) throw new Error('Passwords do not match')
      const result = await resetHostPassword(token, password)
      if (!result.response.ok) throw new Error((result.data as any)?.message || 'Could not reset host password')
      setMessage('Host password updated. Redirecting to host login…')
      setTimeout(() => navigate('/host/login', { replace: true }), 1200)
    } catch (err: any) {
      setError(err?.message || 'Could not reset host password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Set a new host password" title="Finish your golf-course password reset" subtitle="Choose a new password for the host portal, then sign in again." />
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 560 }}>
          <div>
            <label className="label">New password</label>
            <input className="input" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Create a new host password" />
          </div>
          <div>
            <label className="label">Confirm password</label>
            <input className="input" type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter the host password" />
          </div>
          {message ? <div className="small" style={{ color: '#166534' }}>{message}</div> : null}
          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy}>{busy ? 'Updating…' : 'Update host password'}</button>
            <Link className="btn" to="/host/login">Back to host login</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
