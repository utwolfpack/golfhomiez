import { FormEvent, useMemo, useState } from 'react'
import { Link } from 'react-router'
import PageHero from '../components/PageHero'
import { forgotPassword } from '../lib/auth-api'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const redirectTo = useMemo(() => `${window.location.origin}/reset-password`, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await forgotPassword(email, redirectTo)
      if (result.error) throw new Error(result.error.message || 'Could not start reset flow')
      setMessage('Check your email for the requested reset password email.')
    } catch (err: any) {
      setError(err?.message || 'Could not start reset flow')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow="Request Password Reset"
          title="Request Password Reset"
        />
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 560 }}>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>

          {message ? <div className="small" style={{ color: '#166534' }}>{message}</div> : null}
          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy}>{busy ? 'Sending…' : 'Request Password Reset'}</button>
            <Link className="btn" to="/login">Back to login</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
