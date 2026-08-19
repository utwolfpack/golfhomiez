import { FormEvent, useState } from 'react'
import { Link } from 'react-router'
import PageHero from '../components/PageHero'
import { requestOrganizerPasswordReset } from '../lib/organizer-auth'
import { logFrontendEvent } from '../lib/frontend-logger'

export default function OrganizerForgotPassword() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    const normalizedEmail = email.trim().toLowerCase()
    try {
      logFrontendEvent({ category: 'organizer.password_reset', message: 'organizer_password_reset_request_started', data: { email: normalizedEmail } })
      const result = await requestOrganizerPasswordReset(normalizedEmail)
      if (!result.response.ok) throw new Error((result.data as any)?.message || 'Could not send reset email')
      setMessage('If that organizer account exists, a reset email has been sent.')
      logFrontendEvent({ category: 'organizer.password_reset', message: 'organizer_password_reset_request_succeeded', data: { email: normalizedEmail } })
    } catch (err: any) {
      const errMessage = err?.message || 'Could not send reset email'
      setError(errMessage)
      logFrontendEvent({ category: 'organizer.password_reset', level: 'error', message: 'organizer_password_reset_request_failed', data: { email: normalizedEmail, error: errMessage } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Organizer password reset" title="Request Password Reset" />
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 560 }}>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="organizer@example.com" required />
          </div>
          {message ? <div className="small" style={{ color: '#166534' }}>{message}</div> : null}
          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy}>{busy ? 'Sending…' : 'Send reset email'}</button>
            <Link className="btn" to="/organizer/login">Back to organizer login</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
