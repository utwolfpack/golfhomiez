import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { useHostAuth } from '../context/HostAuthContext'

export default function HostLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { loginHost } = useHostAuth()

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await loginHost(email.trim(), password)
      navigate('/host/portal', { replace: true })
    } catch (err: any) {
      setError(err?.message || 'Could not sign in to the golf-course account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Golf-course access" title="Sign in to your host portal" subtitle="Use the email and password for your approved golf-course account to manage your host portal." />
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 560 }}>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="course@example.com" />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Host password" />
          </div>
          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy}>{busy ? 'Signing in…' : 'Host login'}</button>
            <Link className="btn" to="/host/redeem">Redeem invite</Link>
          </div>
          <div className="small"><Link to="/host/request-password-reset">Forgot host password?</Link></div>
        </form>
      </div>
    </div>
  )
}
