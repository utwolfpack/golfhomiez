import { FormEvent, useState } from 'react'
import { Link } from 'react-router'
import PageHero from '../components/PageHero'
import { requestHostPasswordReset } from '../lib/host-auth'
import { logFrontendEvent } from '../lib/frontend-logger'

export default function HostForgotPassword() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      logFrontendEvent({ category: 'golf_course.password_reset', message: 'golf_course_password_reset_request_started', data: { email: email.trim().toLowerCase() } })
      const result = await requestHostPasswordReset(email.trim())
      if (!result.response.ok) throw new Error((result.data as any)?.message || 'Could not send reset email')
      setMessage('If that golf-course account exists, a reset email has been sent.')
      logFrontendEvent({ category: 'golf_course.password_reset', message: 'golf_course_password_reset_request_succeeded', data: { email: email.trim().toLowerCase() } })
    } catch (err: any) {
      const errorMessage = err?.message || 'Could not send reset email'
      setError(errorMessage)
      logFrontendEvent({ category: 'golf_course.password_reset', level: 'error', message: 'golf_course_password_reset_request_failed', data: { email: email.trim().toLowerCase(), error: errorMessage } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Golf course password reset" title="Request Password Reset" />
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 560 }}>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="course@example.com" />
          </div>
          {message ? <div className="small" style={{ color: '#166534' }}>{message}</div> : null}
          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy}>{busy ? 'Sending…' : 'Send reset email'}</button>
            <Link className="btn" to="/host/login">Back to golf course login</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
