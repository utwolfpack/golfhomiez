import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
        <h2 style={{ marginTop: 0 }}>Login</h2>
        <div className="small" style={{ marginBottom: 12 }}>
          Username is your email for now.
        </div>

        <label className="label">Username</label>
        <input className="input" value={username} onChange={e => setUsername(e.target.value)} placeholder="you@example.com" />

        <div style={{ height: 12 }} />

        <label className="label">Password</label>
        <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />

        {error ? <div className="small" style={{ color: '#b91c1c', marginTop: 10 }}>{error}</div> : null}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            className="btn btnPrimary"
            disabled={busy}
            onClick={async () => {
              setBusy(true); setError(null)
              try {
                await login(username, password)
                navigate('/')
              } catch (e: any) {
                setError(e.message || 'Login failed')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Signing in…' : 'Login'}
          </button>
          <Link className="btn" to="/register">Create account</Link>
        </div>

        <div className="small" style={{ marginTop: 12 }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
      </div>
    </div>
  )
}
