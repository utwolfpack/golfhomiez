import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import PageHero from '../components/PageHero'
import ProtectedRoute from '../components/ProtectedRoute'
import UseMyLocationButton from '../components/UseMyLocationButton'
import { fetchProfile, saveProfile, type ProfileInput } from '../lib/profile'
import { logFrontendEvent } from '../lib/frontend-logger'
import beerImg from '../assets/profile/beer-friendly.svg'
import friendly420Img from '../assets/profile/friendly-420.svg'
import soberGolfImg from '../assets/profile/sober-golf.svg'
import type { SavedLocation } from '../lib/location-store'

type ChoiceCardProps = {
  selected: boolean
  disabled?: boolean
  title: string
  description?: string
  imageSrc: string
  imageAlt: string
  onClick: () => void
}

const EMPTY_FORM: ProfileInput = {
  primaryCity: '',
  primaryState: '',
  primaryZipCode: '',
  alcoholPreference: '',
  cannabisPreference: '',
  sobrietyPreference: '',
}

export default function ProfilePage() {
  return (
    <ProtectedRoute>
      <ProfileInner />
    </ProtectedRoute>
  )
}

function ProfileInner() {
  const [form, setForm] = useState<ProfileInput>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [locationStatus, setLocationStatus] = useState<string | null>(null)
  const [needsEnrichment, setNeedsEnrichment] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  const isGuidedEnrichment = useMemo(() => new URLSearchParams(location.search).get('enrich') === '1', [location.search])
  const alcoholSelected = form.alcoholPreference === 'alcohol_friendly'
  const cannabisSelected = form.cannabisPreference === 'weed_friendly'
  const soberSelected = form.sobrietyPreference === 'sober_only'
  const alcoholAnd420Disabled = soberSelected
  const soberDisabled = alcoholSelected || cannabisSelected

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const profile = await fetchProfile()
        if (!active) return
        setForm({
          primaryCity: profile.primaryCity || '',
          primaryState: profile.primaryState || '',
          primaryZipCode: profile.primaryZipCode || '',
          alcoholPreference: profile.alcoholPreference || '',
          cannabisPreference: profile.cannabisPreference || '',
          sobrietyPreference: profile.sobrietyPreference || '',
        })
        setNeedsEnrichment(Boolean(profile.needsEnrichment))
      } catch (err) {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to load profile.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  function patch<K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function toggleAlcoholPreference() {
    setForm((prev) => {
      if (prev.sobrietyPreference === 'sober_only') return prev
      return {
        ...prev,
        alcoholPreference: prev.alcoholPreference === 'alcohol_friendly' ? '' : 'alcohol_friendly',
        sobrietyPreference: '',
      }
    })
  }

  function toggleCannabisPreference() {
    setForm((prev) => {
      if (prev.sobrietyPreference === 'sober_only') return prev
      return {
        ...prev,
        cannabisPreference: prev.cannabisPreference === 'weed_friendly' ? '' : 'weed_friendly',
        sobrietyPreference: '',
      }
    })
  }

  function toggleSobrietyPreference() {
    setForm((prev) => {
      if (prev.alcoholPreference === 'alcohol_friendly' || prev.cannabisPreference === 'weed_friendly') return prev
      return {
        ...prev,
        sobrietyPreference: prev.sobrietyPreference === 'sober_only' ? '' : 'sober_only',
        alcoholPreference: '',
        cannabisPreference: '',
      }
    })
  }

  async function handleLocationResolved(locationData: SavedLocation) {
    patch('primaryCity', locationData.city || '')
    patch('primaryState', locationData.stateName || '')
    patch('primaryZipCode', locationData.postalCode || '')
    setLocationStatus(locationData.postalCode ? `Location ready: ${locationData.city}, ${locationData.stateName} ${locationData.postalCode}.` : `Location ready: ${locationData.city}, ${locationData.stateName}. Add your zip code if needed.`)
    logFrontendEvent({ category: 'profile.location', message: 'profile_location_prefilled', data: { city: locationData.city, stateName: locationData.stateName, postalCode: locationData.postalCode || null } })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const saved = await saveProfile(form)
      setNeedsEnrichment(Boolean(saved.needsEnrichment))
      setStatus('Profile saved.')
      logFrontendEvent({ category: 'profile.save', message: 'profile_saved', data: { needsEnrichment: saved.needsEnrichment } })
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile.')
      logFrontendEvent({ category: 'profile.save', level: 'error', message: 'profile_save_failed', data: { error: err instanceof Error ? err.message : String(err) } })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="container"><div className="card">Loading profile…</div></div>
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow={isGuidedEnrichment || needsEnrichment ? 'First sign-in setup' : ''}
          title={isGuidedEnrichment || needsEnrichment ? 'Complete your golfer profile' : 'Your golfer profile'}
          subtitle={isGuidedEnrichment || needsEnrichment ? 'We only ask this once on your first sign-in. After that, you can come back here any time to edit it.' : ''}
        />

        <div className="formStack" style={{ maxWidth: 860 }}>
          <div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <UseMyLocationButton onResolved={handleLocationResolved} onStatus={setLocationStatus} />
            </div>
            {locationStatus ? <div className="small" style={{ marginTop: 8 }}>{locationStatus}</div> : null}
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr 0.8fr', gap: 12 }}>
            <div>
              <label className="label">City</label>
              <input className="input" value={form.primaryCity} onChange={(e) => patch('primaryCity', e.target.value)} placeholder="Salt Lake City" />
            </div>
            <div>
              <label className="label">State</label>
              <input className="input" value={form.primaryState} onChange={(e) => patch('primaryState', e.target.value)} placeholder="Utah" />
            </div>
            <div>
              <label className="label">Zip code</label>
              <input className="input" value={form.primaryZipCode} onChange={(e) => patch('primaryZipCode', e.target.value)} placeholder="84101" />
            </div>
          </div>

          <div>
            <label className="label">Alcohol</label>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
              <ChoiceCard selected={alcoholSelected} disabled={alcoholAnd420Disabled} title={alcoholSelected ? 'You are alcohol freindly' : 'Alcohol-friendly'} imageSrc={beerImg} imageAlt="Alcohol-friendly golfer option" onClick={toggleAlcoholPreference} />
            </div>
          </div>

          <div>
            <label className="label">Weed</label>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
              <ChoiceCard selected={cannabisSelected} disabled={alcoholAnd420Disabled} title={cannabisSelected ? 'You are 420 freindly' : '420 friendly'} imageSrc={friendly420Img} imageAlt="420-friendly golfer option" onClick={toggleCannabisPreference} />
            </div>
          </div>

          <div>
            <label className="label">Sobriety</label>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
              <ChoiceCard selected={soberSelected} disabled={soberDisabled} title="Prefer to golf with other sober golfers" imageSrc={soberGolfImg} imageAlt="Sober golfer preference option" onClick={toggleSobrietyPreference} />
            </div>
          </div>

          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          {status ? <div className="small" style={{ color: '#166534' }}>{status}</div> : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btnPrimary" disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save'}</button>
            {!needsEnrichment && !isGuidedEnrichment ? <button type="button" className="btn" onClick={() => navigate('/')}>Done</button> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function ChoiceCard({ selected, disabled = false, title, description, imageSrc, imageAlt, onClick }: ChoiceCardProps) {
  return (
    <button
      type="button"
      className="card"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      style={{
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        border: selected ? '2px solid #15803d' : '1px solid rgba(15,23,42,.12)',
        boxShadow: selected ? '0 0 0 3px rgba(22,163,74,.12)' : undefined,
        background: selected ? 'rgba(240,253,244,.9)' : 'rgba(255,255,255,.85)',
      }}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <img src={imageSrc} alt={imageAlt} style={{ width: 64, height: 64, borderRadius: 16, objectFit: 'cover', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontWeight: 800 }}>{title}</div>
            {selected ? <span aria-label="Selected preference" title="Selected preference" style={{ fontSize: 18, lineHeight: 1 }}>🙂</span> : null}
          </div>
          {description ? <div className="small" style={{ marginTop: 6 }}>{description}</div> : null}
        </div>
      </div>
    </button>
  )
}
