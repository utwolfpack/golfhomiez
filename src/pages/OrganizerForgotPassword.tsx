import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { requestOrganizerPasswordReset, type PasswordResetDeliveryMethod } from '../lib/organizer-auth'
import { logFrontendEvent } from '../lib/frontend-logger'

export default function OrganizerForgotPassword() {
  const [email, setEmail] = useState('')
  const [deliveryMethod, setDeliveryMethod] = useState<PasswordResetDeliveryMethod>('email')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await requestOrganizerPasswordReset(email.trim(), deliveryMethod)
      if (!result.response.ok) throw new Error((result.data as any)?.message || 'Could not send reset link')
      logFrontendEvent({ category: 'password-reset', message: 'organizer_password_reset_requested', data: { deliveryMethod } })
      setMessage(deliveryMethod === 'sms' ? 'If that organizer account exists and has a phone number, a reset link has been sent by SMS.' : 'If that organizer account exists, a reset email has been sent.')
    } catch (err: any) {
      setError(err?.message || 'Could not send reset link')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Organizer password reset" title="Reset your organizer password" subtitle="Enter the organizer account email and choose how to receive the reset link." />
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 560 }}>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="organizer@example.com" />
          </div>

          <fieldset className="formStack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Delivery method</legend>
            <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="radio" name="organizerDeliveryMethod" value="email" checked={deliveryMethod === 'email'} onChange={() => setDeliveryMethod('email')} />
              Send by email
            </label>
            <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="radio" name="organizerDeliveryMethod" value="sms" checked={deliveryMethod === 'sms'} onChange={() => setDeliveryMethod('sms')} />
              Send by SMS
            </label>
          </fieldset>

          {message ? <div className="small" style={{ color: '#166534' }}>{message}</div> : null}
          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy}>{busy ? 'Sending…' : deliveryMethod === 'sms' ? 'Send reset SMS' : 'Send reset email'}</button>
            <Link className="btn" to="/organizer/login">Back to organizer login</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
