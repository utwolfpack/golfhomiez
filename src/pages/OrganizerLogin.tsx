import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { useOrganizerAuth } from '../context/OrganizerAuthContext'
import { fetchOrganizerSessionPortal } from '../lib/organizer-auth'
import { logFrontendEvent } from '../lib/frontend-logger'

export default function OrganizerLogin() {
  const [params] = useSearchParams()
  const [email, setEmail] = useState(params.get('email') || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { loginOrganizer } = useOrganizerAuth()
  const navigate = useNavigate()

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await loginOrganizer(email.trim(), password)
      await fetchOrganizerSessionPortal()
      logFrontendEvent({ category: 'organizer.login', message: 'organizer_login_succeeded', data: { email: email.trim().toLowerCase() } })
      navigate('/organizer/portal', { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Organizer login failed'
      logFrontendEvent({
        category: 'organizer.login',
        level: 'error',
        message: 'organizer_login_failed',
        data: { email: email.trim().toLowerCase(), error: message },
      })
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Organizer access" title="Sign in to your organizer portal" subtitle="Existing organizer accounts and invited organizers can sign in here and land on the organizer portal." />
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 560 }}>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy}>{busy ? 'Signing in…' : 'Login to organizer portal'}</button>
            <Link className="btn" to={`/organizer/register${params.toString() ? `?${params.toString()}` : ''}`}>Create organizer access</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
