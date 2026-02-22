import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { register } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
        <h2 style={{ marginTop: 0 }}>Registration</h2>

        <label className="label">Email</label>
        <input className="input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />

        <div style={{ height: 12 }} />

        <label className="label">Password</label>
        <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Create a password" />

        {error ? <div className="small" style={{ color: '#b91c1c', marginTop: 10 }}>{error}</div> : null}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            className="btn btnPrimary"
            disabled={busy}
            onClick={async () => {
              setBusy(true); setError(null)
              try {
                await register(email, password)
                navigate('/login')
              } catch (e: any) {
                setError(e.message || 'Registration failed')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Creating…' : 'Create account'}
          </button>
          <Link className="btn" to="/login">Back to login</Link>
        </div>

        <div className="small" style={{ marginTop: 12 }}>
          Credentials are stored locally in <code>server/data/users.json</code>.
        </div>
      </div>
    </div>
  )
}
