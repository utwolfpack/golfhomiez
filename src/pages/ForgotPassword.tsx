import { FormEvent, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { forgotPassword, getLatestResetLink } from '../lib/auth-api'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resetUrl, setResetUrl] = useState<string | null>(null)

  const redirectTo = useMemo(() => `${window.location.origin}/reset-password`, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    setResetUrl(null)
    try {
      const result = await forgotPassword(email, redirectTo)
      if (result.error) throw new Error(result.error.message || 'Could not start reset flow')
      setMessage('If that account exists, a reset link has been generated.')
      const latest = await getLatestResetLink(email)
      if (latest.data?.url) setResetUrl(latest.data.url)
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
          eyebrow="Reset password"
          title="Request a password reset"
          subtitle="Enter your email and use the generated reset link in local development."
        />
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 560 }}>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>

          {message ? <div className="small" style={{ color: '#166534' }}>{message}</div> : null}
          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          {resetUrl ? (
            <div className="small" style={{ wordBreak: 'break-word' }}>
              Local reset link: <a href={resetUrl}>{resetUrl}</a>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
            <Link className="btn" to="/login">Back to login</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
