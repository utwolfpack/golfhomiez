import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [resetUrl, setResetUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setStatus(null)
    setToken(null)
    setResetUrl(null)
    setExpiresAt(null)
    setLoading(true)
    try {
      const res = await api<{ ok: boolean; message: string; token?: string; resetUrl?: string; expiresAt?: string }>(
        '/api/auth/password-reset/request',
        { method: 'POST', body: JSON.stringify({ email }) }
      )
      setStatus(res.message)
      if (res.token) setToken(res.token)
      if (res.resetUrl) setResetUrl(res.resetUrl)
      if (res.expiresAt) setExpiresAt(res.expiresAt)
    } catch (err: any) {
      setError(err?.message || 'Failed to request reset token')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 720, margin: '0 auto' }}>
        <h2 style={{ marginTop: 0 }}>Forgot Password</h2>
        <div className="small" style={{ marginBottom: 12 }}>
          Enter your email to generate a one-time reset token (local app mode).
        </div>

        <form onSubmit={onSubmit}>
          <label className="label">Email</label>
          <input className="input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />

          <div style={{ height: 12 }} />
          <button className="btn btnPrimary" disabled={loading}>
            {loading ? 'Working…' : 'Generate reset token'}
          </button>

          {error && <div className="small" style={{ color: '#b91c1c', marginTop: 10 }}>{error}</div>}
          {status && <div className="small" style={{ color: '#065f46', marginTop: 10 }}>{status}</div>}
        </form>

        {(token || resetUrl) && (
          <div className="card" style={{ marginTop: 14, borderStyle: 'dashed' }}>
            <h3 style={{ marginTop: 0 }}>Reset token</h3>
            {expiresAt && (
              <div className="small" style={{ marginBottom: 8 }}>
                Expires: {new Date(expiresAt).toLocaleString()}
              </div>
            )}
            {token && (
              <div style={{ wordBreak: 'break-all', padding: 10, border: '1px solid #d8dae6', borderRadius: 10, background: '#fafafa' }}>
                <code>{token}</code>
              </div>
            )}
            {resetUrl && (
              <div style={{ marginTop: 10 }}>
                <Link className="btn" to={resetUrl}>Open reset page</Link>
              </div>
            )}
          </div>
        )}

        <div className="small" style={{ marginTop: 12 }}>
          <Link to="/login">Back to login</Link>
        </div>
      </div>
    </div>
  )
}
