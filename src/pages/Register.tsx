import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PageHero from '../components/PageHero'
import LocationInput from '../components/LocationInput'
import type { SavedLocation } from '../lib/location-store'

export default function Register() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [location, setLocation] = useState<SavedLocation | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { register } = useAuth()
  const navigate = useNavigate()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const trimmedFirstName = firstName.trim()
      const trimmedLastName = lastName.trim()
      if (!trimmedFirstName) throw new Error('First name is required')
      if (!trimmedLastName) throw new Error('Last name is required')
      if (!location) throw new Error('Location is required')
      if (password.length < 8) throw new Error('Password must be at least 8 characters')
      if (password !== confirmPassword) throw new Error('Passwords do not match')
      await register(trimmedFirstName, trimmedLastName, email.trim(), password)
      navigate('/')
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
          <div className="formRow formRow--split">
            <div>
              <label className="label">First name</label>
              <input className="input" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" autoComplete="given-name" />
            </div>

            <div>
              <label className="label">Last name</label>
              <input className="input" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" autoComplete="family-name" />
            </div>
          </div>

          <LocationInput value={location} onChange={setLocation} />

          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </div>

          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Create a password" autoComplete="new-password" />
          </div>

          <div>
            <label className="label">Confirm password</label>
            <input className="input" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" autoComplete="new-password" />
          </div>

          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </button>
            <Link className="btn" to="/login">Back to login</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
