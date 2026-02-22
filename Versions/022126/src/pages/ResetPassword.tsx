import { FormEvent, useMemo, useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const tokenFromUrl = useMemo(() => params.get('token') || '', [params])

  const [token, setToken] = useState(tokenFromUrl)
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setStatus(null)

    if (!token.trim()) return setError('Token is required')
    if (newPassword.length < 6) return setError('Password must be at least 6 characters')
    if (newPassword !== confirm) return setError('Passwords do not match')

    setLoading(true)
    try {
      const res = await api<{ ok: boolean; message: string }>('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword })
      })
      setStatus(res.message)
      // Ensure client token is cleared (user must log in again)
      localStorage.removeItem('auth_token')
      setTimeout(() => navigate('/login'), 800)
    } catch (err: any) {
      setError(err?.message || 'Failed to reset password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 720, margin: '0 auto' }}>
        <h2 style={{ marginTop: 0 }}>Reset Password</h2>
        <div className="small" style={{ marginBottom: 12 }}>
          Paste your reset token and choose a new password.
        </div>

        <form onSubmit={onSubmit}>
          <label className="label">Reset token</label>
          <textarea
            className="input"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Paste token here"
            rows={3}
            style={{ resize: 'vertical' }}
          />

          <div style={{ height: 12 }} />

          <label className="label">New password</label>
          <input className="input" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />

          <div style={{ height: 12 }} />

          <label className="label">Confirm new password</label>
          <input className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} />

          <div style={{ height: 12 }} />
          <button className="btn btnPrimary" disabled={loading}>{loading ? 'Working…' : 'Reset password'}</button>

          {error && <div className="small" style={{ color: '#b91c1c', marginTop: 10 }}>{error}</div>}
          {status && <div className="small" style={{ color: '#065f46', marginTop: 10 }}>{status}</div>}
        </form>

        <div className="small" style={{ marginTop: 12 }}>
          <Link to="/forgot-password">Need a token?</Link>
          {' · '}
          <Link to="/login">Back to login</Link>
        </div>
      </div>
    </div>
  )
}
