import { FormEvent, useMemo, useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import PageHero from '../components/PageHero'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const tokenFromSession = typeof window !== 'undefined' ? sessionStorage.getItem('reset_token') || '' : ''
  const tokenFromUrl = useMemo(() => params.get('token') || '', [params])
  const hiddenToken = tokenFromSession || tokenFromUrl
  const expiresAt = typeof window !== 'undefined' ? sessionStorage.getItem('reset_token_expires_at') || '' : ''

  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setStatus(null)

    if (!hiddenToken.trim()) return setError('Your reset session was not found. Start again from Forgot Password.')
    if (newPassword.length < 6) return setError('Password must be at least 6 characters')
    if (newPassword !== confirm) return setError('Passwords do not match')

    setLoading(true)
    try {
      const res = await api<{ ok: boolean; message: string }>('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token: hiddenToken, newPassword })
      })
      setStatus(res.message)
      sessionStorage.removeItem('reset_token')
      sessionStorage.removeItem('reset_token_expires_at')
      localStorage.removeItem('auth_token')
      setTimeout(() => navigate('/login'), 800)
    } catch (err: any) {
      setError(err?.message || 'Failed to reset password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow="Secure reset"
          title="Choose a fresh password"
          subtitle="Your reset token stays hidden in this browser session while you set a new password."
        />

        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 720 }}>
          {expiresAt ? <div className="small">Reset session expires: {new Date(expiresAt).toLocaleString()}</div> : null}

          <div>
            <label className="label">New password</label>
            <input className="input" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </div>

          <div>
            <label className="label">Confirm new password</label>
            <input className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} />
          </div>

          <div>
            <button className="btn btnPrimary" disabled={loading}>{loading ? 'Working…' : 'Reset password'}</button>
          </div>

          {error && <div className="small" style={{ color: '#b91c1c' }}>{error}</div>}
          {status && <div className="small" style={{ color: '#065f46' }}>{status}</div>}
        </form>

        <div className="small" style={{ marginTop: 12 }}>
          <Link to="/forgot-password">Start over</Link>
          {' · '}
          <Link to="/login">Back to login</Link>
        </div>
      </div>
    </div>
  )
}
