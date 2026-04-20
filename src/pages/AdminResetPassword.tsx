import { FormEvent, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { requestAdminPasswordReset, resetAdminPassword } from '../lib/admin'

export default function AdminResetPassword() {
  const [params] = useSearchParams()
  const token = useMemo(() => params.get('token') || '', [params])
  const [identifier, setIdentifier] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onRequest(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    setError(null)
    try {
      await requestAdminPasswordReset(identifier)
      setMessage('If that admin account exists, a reset link has been emailed from no-reply@golfhomiez.com.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request reset email.')
    }
  }

  async function onReset(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    setError(null)
    try {
      if (!token) throw new Error('Reset token missing from the URL.')
      if (password.length < 8) throw new Error('Password must be at least 8 characters.')
      if (password !== confirmPassword) throw new Error('Passwords do not match.')
      await resetAdminPassword(token, password)
      setMessage('Admin password updated. Return to /golfadmin and sign in with the new password.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password.')
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Admin password reset" title="Manage GolfHomiez admin passwords" subtitle="Reset links are sent through no-reply@golfhomiez.com." />
        {!token ? (
          <form onSubmit={onRequest} className="formStack" style={{ maxWidth: 520 }}>
            <input className="input" placeholder="Admin username or email" value={identifier} onChange={e => setIdentifier(e.target.value)} />
            <button className="btn btnPrimary">Email reset link</button>
          </form>
        ) : (
          <form onSubmit={onReset} className="formStack" style={{ maxWidth: 520 }}>
            <input className="input" type="password" placeholder="New admin password" value={password} onChange={e => setPassword(e.target.value)} />
            <input className="input" type="password" placeholder="Confirm admin password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
            <button className="btn btnPrimary">Update password</button>
          </form>
        )}
        {message ? <div className="small" style={{ color: '#166534', marginTop: 12 }}>{message}</div> : null}
        {error ? <div className="small" style={{ color: '#b91c1c', marginTop: 12 }}>{error}</div> : null}
        <div style={{ marginTop: 16 }}><Link className="btn" to="/golfadmin">Back to admin portal</Link></div>
      </div>
    </div>
  )
}
