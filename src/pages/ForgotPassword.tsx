import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import PageHero from '../components/PageHero'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [resetUrl, setResetUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setStatus(null)
    setResetUrl(null)
    setExpiresAt(null)
    setLoading(true)
    try {
      const res = await api<{ ok: boolean; message: string; token?: string; resetUrl?: string; expiresAt?: string }>(
        '/api/auth/password-reset/request',
        { method: 'POST', body: JSON.stringify({ email }) }
      )
      if (res.token) sessionStorage.setItem('reset_token', res.token)
      if (res.expiresAt) sessionStorage.setItem('reset_token_expires_at', res.expiresAt)
      setStatus('Reset session created. Continue to choose a new password.')
      if (res.resetUrl) setResetUrl(res.resetUrl)
      if (res.expiresAt) setExpiresAt(res.expiresAt)
    } catch (err: any) {
      setError(err?.message || 'Failed to request reset token')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow="Password help"
          title="Start a secure password reset"
          subtitle="This local-app flow creates a one-time reset session and keeps the token hidden from view."
        />

        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 720 }}>
          <div>
            <label className="label">Email</label>
            <input className="input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>

          <div>
            <button className="btn btnPrimary" disabled={loading}>
              {loading ? 'Working…' : 'Start reset'}
            </button>
          </div>

          {error && <div className="small" style={{ color: '#b91c1c' }}>{error}</div>}
          {status && <div className="small" style={{ color: '#065f46' }}>{status}</div>}
        </form>

        {(status || resetUrl) && (
          <div className="card" style={{ marginTop: 14, borderStyle: 'dashed' }}>
            <h3 style={{ marginTop: 0 }}>Reset session ready</h3>
            <div className="small">Your reset token is stored privately in this browser session and is never shown on screen.</div>
            {expiresAt && (
              <div className="small" style={{ marginTop: 8 }}>
                Expires: {new Date(expiresAt).toLocaleString()}
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <Link className="btn btnPrimary" to={resetUrl || '/reset-password'}>Continue to reset password</Link>
            </div>
          </div>
        )}

        <div className="small" style={{ marginTop: 12 }}>
          <Link to="/login">Back to login</Link>
        </div>
      </div>
    </div>
  )
}
