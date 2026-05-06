import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import LocationInput from '../components/LocationInput'
import PageHero from '../components/PageHero'
import { useOrganizerAuth } from '../context/OrganizerAuthContext'
import { fetchOrganizerInviteEligibility, type OrganizerInviteEligibility } from '../lib/accounts'
import type { SavedLocation } from '../lib/location-store'

export default function OrganizerRegister() {
  const [params] = useSearchParams()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [location, setLocation] = useState<SavedLocation | null>(null)
  const [email, setEmail] = useState(params.get('email') || '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [eligibility, setEligibility] = useState<OrganizerInviteEligibility | null>(null)
  const [checkingEligibility, setCheckingEligibility] = useState(false)
  const { registerOrganizer } = useOrganizerAuth()
  const navigate = useNavigate()

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email])
  const canCreateOrganizerAccess = Boolean(eligibility?.eligible)

  useEffect(() => {
    setEmail(params.get('email') || '')
  }, [params])

  useEffect(() => {
    let active = true
    if (!normalizedEmail) {
      setEligibility(null)
      setCheckingEligibility(false)
      return () => { active = false }
    }

    setCheckingEligibility(true)
    fetchOrganizerInviteEligibility(normalizedEmail)
      .then((result) => {
        if (!active) return
        setEligibility(result)
      })
      .catch(() => {
        if (!active) return
        setEligibility(null)
      })
      .finally(() => {
        if (active) setCheckingEligibility(false)
      })

    return () => { active = false }
  }, [normalizedEmail])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (!firstName.trim()) throw new Error('First name is required')
      if (!lastName.trim()) throw new Error('Last name is required')
      if (!location) throw new Error('Location is required')
      if (!normalizedEmail) throw new Error('Email is required')
      if (!canCreateOrganizerAccess) throw new Error('You need at least one tournament invite from a host account before creating organizer access.')
      if (password.length < 8) throw new Error('Password must be at least 8 characters')
      if (password !== confirmPassword) throw new Error('Passwords do not match')
      await registerOrganizer({ firstName: firstName.trim(), lastName: lastName.trim(), email: normalizedEmail, password })
      navigate('/organizer/portal', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Organizer registration" title="Create your organizer account" subtitle="Organizer registration is available only after a host invites your email to at least one tournament." />
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 560 }}>
          <div className="formRow formRow--split">
            <div>
              <label className="label">First name</label>
              <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
            </div>
            <div>
              <label className="label">Last name</label>
              <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
            </div>
          </div>
          <LocationInput value={location} onChange={setLocation} />
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          {checkingEligibility ? <div className="small">Checking tournament invite eligibility…</div> : null}
          {!checkingEligibility && normalizedEmail && !canCreateOrganizerAccess ? <div className="small" style={{ color: '#b91c1c' }}>A host must invite this email to at least one tournament before organizer registration is available.</div> : null}
          {!checkingEligibility && eligibility?.hasOrganizerAccount ? <div className="small" style={{ color: '#166534' }}>This email already has organizer access. Use the organizer login page instead.</div> : null}
          {!checkingEligibility && canCreateOrganizerAccess ? <div className="small" style={{ color: '#166534' }}>Tournament invite found. You can create organizer access for this email.</div> : null}
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <div>
            <label className="label">Confirm password</label>
            <input className="input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          </div>
          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy || checkingEligibility || !canCreateOrganizerAccess}>{busy ? 'Creating…' : 'Create organizer account'}</button>
            <Link className="btn" to={`/organizer/login${params.toString() ? `?${params.toString()}` : ''}`}>Already have organizer access?</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
