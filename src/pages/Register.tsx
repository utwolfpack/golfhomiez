import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PageHero from '../components/PageHero'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { register } = useAuth()
  const navigate = useNavigate()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await register(email, password)
      navigate('/login')
    } catch (err: any) {
      setError(err?.message || 'Registration failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow="Get started"
          title="Create your Golf Homiez account"
          subtitle="Sign up once and keep your team rounds, solo rounds, and roster details together."
        />

        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 560 }}>
          <div>
            <label className="label">Email</label>
            <input className="input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>

          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Create a password" />
          </div>

          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </button>
            <Link className="btn" to="/login">Back to login</Link>
          </div>

          <div className="small">
            Credentials are stored locally in <code>server/data/users.json</code>.
          </div>
        </form>
      </div>
    </div>
  )
}
