import { FormEvent, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { forgotPassword, getLatestResetLink, type PasswordResetDeliveryMethod } from '../lib/auth-api'
import { logFrontendEvent } from '../lib/frontend-logger'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [deliveryMethod, setDeliveryMethod] = useState<PasswordResetDeliveryMethod>('email')
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
      const result = await forgotPassword(email, redirectTo, deliveryMethod)
      if (result.error) throw new Error(result.error.message || 'Could not start reset flow')
      logFrontendEvent({ category: 'password-reset', message: 'golf_user_password_reset_requested', data: { deliveryMethod } })
      setMessage(deliveryMethod === 'sms' ? 'If that account exists and has a phone number, a reset link has been sent by SMS.' : 'If that account exists, a reset link has been generated.')
      if (deliveryMethod === 'email') {
        const latest = await getLatestResetLink(email)
        if (latest.data?.url) setResetUrl(latest.data.url)
      }
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

          <fieldset className="formStack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Delivery method</legend>
            <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="radio" name="deliveryMethod" value="email" checked={deliveryMethod === 'email'} onChange={() => setDeliveryMethod('email')} />
              Send by email
            </label>
            <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="radio" name="deliveryMethod" value="sms" checked={deliveryMethod === 'sms'} onChange={() => setDeliveryMethod('sms')} />
              Send by SMS
            </label>
          </fieldset>

          {message ? <div className="small" style={{ color: '#166534' }}>{message}</div> : null}
          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          {resetUrl ? (
            <div className="small" style={{ wordBreak: 'break-word' }}>
              Local reset link: <a href={resetUrl}>{resetUrl}</a>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy}>{busy ? 'Sending…' : deliveryMethod === 'sms' ? 'Send reset SMS' : 'Send reset link'}</button>
            <Link className="btn" to="/login">Back to login</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
