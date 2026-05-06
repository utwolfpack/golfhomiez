import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PageHero from '../components/PageHero'
import clubhouseImg from '../assets/gallery/clubhouse-twilight.svg'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const normalizedEmail = email.trim().toLowerCase()
      await login(normalizedEmail, password)
      navigate('/')
    } catch (err: any) {
      setError(err?.message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow="Welcome back"
          title="Sign in and hit the first tee"
          subtitle="User, host, and organizer accounts can share the same email address, but each account signs in here only with its own user credentials."
        />

        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 560 }}>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </div>

          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </div>

          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy}>
              {busy ? 'Signing in…' : 'Login'}
            </button>
            <Link className="btn" to="/register">Create account</Link>
          </div>

          <div className="small">
            <Link to="/request-password-reset">Forgot password?</Link>
          </div>
        </form>

        <div className="photoStrip photoStrip--compact" style={{ marginTop: 16 }}>
          <div className="photoCard">
            <img src={clubhouseImg} alt="Clubhouse finish" className="photoCardImg" />
            <div className="photoCardOverlay">
              <div className="photoCardTitle">Clubhouse finish</div>
              <div className="photoCardSubtitle">Wrap up rounds, rosters, and records in one place.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
