import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../context/AuthContext'
import PageHero from '../components/PageHero'
import ProtectedRoute from '../components/ProtectedRoute'
import { fetchProfile, saveProfile, type FeatureFlags, type ProfileInput, type ProfileSummary } from '../lib/profile'
import { PHONE_PATTERN, PHONE_VALIDATION_MESSAGE, sanitizePhoneInput, validateRequiredPhoneNumber } from '../lib/phone-validation'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'
import { searchLocations, type ResolvedLocation } from '../lib/locations'
import beerImg from '../assets/profile/beer-friendly.svg'
import friendly420Img from '../assets/profile/friendly-420.svg'
import soberGolfImg from '../assets/profile/sober-golf.svg'

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
  phone: '',
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
  const [needsEnrichment, setNeedsEnrichment] = useState(false)
  const [hasSavedPhoneNumber, setHasSavedPhoneNumber] = useState(false)
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null)
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>({})
  const [citySuggestions, setCitySuggestions] = useState<ResolvedLocation[]>([])
  const [citySuggestionsOpen, setCitySuggestionsOpen] = useState(false)
  const [citySearchLoading, setCitySearchLoading] = useState(false)
  const [cityHelperText, setCityHelperText] = useState<string | null>(null)
  const citySearchRequestId = useRef(0)
  const cityBlurTimer = useRef<number | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const { hasRole, refreshProfileStatus } = useAuth()

  const isGuidedEnrichment = useMemo(() => new URLSearchParams(location.search).get('enrich') === '1', [location.search])
  const isPreferenceRestricted = hasRole('admin') || hasRole('host') || hasRole('organizer')
  const socialPreferencesEnabled = Boolean(featureFlags.profileSocialPreferences)
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
          phone: sanitizePhoneInput(profile.phone || ''),
          primaryCity: profile.primaryCity || '',
          primaryState: profile.primaryState || '',
          primaryZipCode: profile.primaryZipCode || '',
          alcoholPreference: profile.alcoholPreference || '',
          cannabisPreference: profile.cannabisPreference || '',
          sobrietyPreference: profile.sobrietyPreference || '',
        })
        const savedPhoneAvailable = Boolean(sanitizePhoneInput(profile.phone || '').trim())
        setHasSavedPhoneNumber(savedPhoneAvailable)
        setNeedsEnrichment(Boolean(profile.needsEnrichment))
        setProfileSummary(profile.summary || null)
        setFeatureFlags(profile.featureFlags || {})
        logFrontendEvent({ category: 'profile.navigation', message: 'profile_header_links_state_loaded', data: { enabled: savedPhoneAvailable, reason: savedPhoneAvailable ? 'saved_phone_available' : 'saved_phone_required' } })
      } catch (err) {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to load profile.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!citySuggestionsOpen) {
      setCitySuggestions([])
      setCitySearchLoading(false)
      return
    }

    const query = form.primaryCity.trim()
    if (query.length < 2) {
      setCitySuggestions([])
      setCitySearchLoading(false)
      return
    }

    const requestId = ++citySearchRequestId.current
    const correlationId = getCorrelationId()
    setCitySearchLoading(true)
    setCityHelperText(null)
    logFrontendEvent({ category: 'profile.citySearch', message: 'city_typeahead_started', data: { correlationId, query } })

    searchLocations(query, 8)
      .then((results) => {
        if (requestId !== citySearchRequestId.current) return
        setCitySuggestions(results)
        logFrontendEvent({ category: 'profile.citySearch', message: 'city_typeahead_completed', data: { correlationId, query, resultCount: results.length, postalCodeResultCount: results.filter((item) => Boolean(item.postalCode)).length } })
      })
      .catch((err) => {
        if (requestId !== citySearchRequestId.current) return
        setCitySuggestions([])
        setCityHelperText('City suggestions are temporarily unavailable. You can still enter your city, state, and zip manually.')
        logFrontendEvent({ category: 'profile.citySearch', level: 'error', message: 'city_typeahead_failed', data: { correlationId, query, error: err instanceof Error ? err.message : String(err) } })
      })
      .finally(() => {
        if (requestId === citySearchRequestId.current) setCitySearchLoading(false)
      })
  }, [form.primaryCity, citySuggestionsOpen])

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

  function setPhoneValue(value: string) {
    patch('phone', sanitizePhoneInput(value))
  }

  function handleCityInput(value: string) {
    setForm((prev) => ({ ...prev, primaryCity: value, primaryState: '', primaryZipCode: '' }))
    setCityHelperText('Select a city from the suggestions to populate state and zip.')
    setCitySuggestionsOpen(true)
  }

  function selectCitySuggestion(location: ResolvedLocation) {
    const city = String(location.city || '').trim()
    const state = String(location.stateName || location.state || location.stateCode || '').trim()
    const zip = String(location.postalCode || '').trim()
    setForm((prev) => ({
      ...prev,
      primaryCity: city,
      primaryState: state,
      primaryZipCode: zip || prev.primaryZipCode || '',
    }))
    setCitySuggestionsOpen(false)
    setCitySuggestions([])
    setCityHelperText(zip ? `Selected ${city}, ${location.stateCode} ${zip}.` : `Selected ${city}, ${location.stateCode}. Enter your zip code to finish your profile location.`)
    logFrontendEvent({ category: 'profile.citySearch', message: 'city_typeahead_selected', data: { correlationId: getCorrelationId(), city, stateCode: location.stateCode, stateName: state, postalCodeAvailable: Boolean(zip) } })
  }

  function handleCityFocus() {
    if (cityBlurTimer.current) window.clearTimeout(cityBlurTimer.current)
    setCitySuggestionsOpen(true)
  }

  function handleCityBlur() {
    cityBlurTimer.current = window.setTimeout(() => setCitySuggestionsOpen(false), 120)
  }

  function getLocationValidationError() {
    if (!form.primaryCity.trim() || !form.primaryState.trim() || !form.primaryZipCode.trim()) {
      return 'City, state, and zip code are required.'
    }
    return null
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const phoneValidationError = validateRequiredPhoneNumber(form.phone)
      if (phoneValidationError) {
        logFrontendEvent({ category: 'profile.save', level: 'error', message: 'profile_invalid_phone', data: { hasPhone: Boolean(form.phone && form.phone.trim()) } })
        throw new Error(phoneValidationError)
      }
      const locationValidationError = getLocationValidationError()
      if (locationValidationError) {
        logFrontendEvent({ category: 'profile.save', level: 'error', message: 'profile_invalid_location', data: { hasCity: Boolean(form.primaryCity.trim()), hasState: Boolean(form.primaryState.trim()), hasZipCode: Boolean(form.primaryZipCode.trim()) } })
        throw new Error(locationValidationError)
      }
      const payload = !socialPreferencesEnabled || isPreferenceRestricted ? { ...form, alcoholPreference: '', cannabisPreference: '', sobrietyPreference: '' } : form
      const saved = await saveProfile(payload)
      setHasSavedPhoneNumber(Boolean(sanitizePhoneInput(saved.phone || '').trim()))
      setNeedsEnrichment(Boolean(saved.needsEnrichment))
      setProfileSummary(saved.summary || null)
      setFeatureFlags(saved.featureFlags || {})
      setStatus('Profile saved.')
      logFrontendEvent({ category: 'profile.save', message: 'profile_saved', data: { needsEnrichment: saved.needsEnrichment, hasLocation: Boolean(saved.primaryCity && saved.primaryState && saved.primaryZipCode), socialPreferencesEnabled: Boolean(saved.featureFlags?.profileSocialPreferences), roundsGolfed: saved.summary?.roundsGolfed || 0 } })
      await refreshProfileStatus()
      if (isGuidedEnrichment) {
        navigate('/?profileEnriched=1', { replace: true })
      } else {
        navigate('/', { replace: true })
      }
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
          title={isGuidedEnrichment || needsEnrichment ? 'Complete your profile' : 'Your Profile'}
          subtitle={isGuidedEnrichment || needsEnrichment ? 'We only ask this once on your first sign-in. After that, you can come back here any time to edit it.' : ''}
          actions={
            <div>
              <div className="profileHeaderLinks" aria-label="Profile page links">
                {hasSavedPhoneNumber ? <Link className="btn btnLightGreen btnSmall" to="/support">Support</Link> : <span className="btn btnLightGreen btnSmall" aria-disabled="true" title="Save a phone number to unlock Support.">Support</span>}
                {hasSavedPhoneNumber ? <Link className="btn btnLightGreen btnSmall" to="/invite-homie">Invite Homie</Link> : <span className="btn btnLightGreen btnSmall" aria-disabled="true" title="Save a phone number to unlock Invite Homie.">Invite Homie</span>}
                {hasSavedPhoneNumber ? <Link className="btn btnLightGreen btnSmall" to="/teams">Teams</Link> : <span className="btn btnLightGreen btnSmall" aria-disabled="true" title="Save a phone number to unlock Teams.">Teams</span>}
                {hasSavedPhoneNumber ? <Link className="btn btnLightGreen btnSmall" to="/inbox">Messages</Link> : <span className="btn btnLightGreen btnSmall" aria-disabled="true" title="Save a phone number to unlock Messages.">Messages</span>}
              </div>
              {!hasSavedPhoneNumber ? <div className="profileHeaderLinksHint">Save your phone number to unlock these profile actions.</div> : null}
            </div>
          }
        />

        <div className="formStack" style={{ maxWidth: 860 }}>
          <div>
            <label className="label">Phone</label>
            <input className="input" type="tel" inputMode="tel" pattern={PHONE_PATTERN} title={PHONE_VALIDATION_MESSAGE} required aria-invalid={Boolean(validateRequiredPhoneNumber(form.phone))} value={form.phone || ''} onChange={(e) => setPhoneValue(e.target.value)} placeholder="801 743 7000" autoComplete="tel" />
          </div>

          <div>
            <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr 0.8fr', gap: 12 }}>
              <div className="locationBox">
                <label className="label" htmlFor="profilePrimaryCity">City</label>
                <input
                  id="profilePrimaryCity"
                  className="input"
                  required
                  role="combobox"
                  aria-expanded={citySuggestionsOpen}
                  aria-controls="profileCitySuggestions"
                  value={form.primaryCity}
                  onChange={(e) => handleCityInput(e.target.value)}
                  onFocus={handleCityFocus}
                  onBlur={handleCityBlur}
                  placeholder="Start typing your city"
                  autoComplete="off"
                />
                {citySuggestionsOpen ? (
                  <div id="profileCitySuggestions" className="locationSuggestions" role="listbox">
                    {citySearchLoading ? <div className="small" style={{ padding: 8 }}>Loading city suggestions…</div> : null}
                    {!citySearchLoading && citySuggestions.map((item) => (
                      <button
                        type="button"
                        key={`${item.city}|${item.stateCode}|${item.postalCode || ''}|${item.latitude}|${item.longitude}`}
                        className="locationSuggestion"
                        role="option"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectCitySuggestion(item)}
                      >
                        <span>{item.city}, {item.stateCode}{item.postalCode ? ` ${item.postalCode}` : ''}</span>
                        <span className="small">{item.stateName}</span>
                      </button>
                    ))}
                    {!citySearchLoading && !citySuggestions.length && form.primaryCity.trim().length >= 2 ? <div className="small" style={{ padding: 8 }}>No city suggestions found.</div> : null}
                  </div>
                ) : null}
              </div>
              <div>
                <label className="label" htmlFor="profilePrimaryState">State</label>
                <input id="profilePrimaryState" className="input" required value={form.primaryState} onChange={(e) => patch('primaryState', e.target.value)} placeholder="Auto-filled" autoComplete="address-level1" />
              </div>
              <div>
                <label className="label" htmlFor="profilePrimaryZipCode">Zip code</label>
                <input id="profilePrimaryZipCode" className="input" required value={form.primaryZipCode} onChange={(e) => patch('primaryZipCode', e.target.value)} placeholder="Auto-filled" autoComplete="postal-code" />
              </div>
            </div>
            {cityHelperText ? <div className="small" style={{ marginTop: 6 }}>{cityHelperText}</div> : null}
          </div>

          <ProfileSummarySection summary={profileSummary} />

          {socialPreferencesEnabled ? (!isPreferenceRestricted ? (
            <>
              <div>
                <label className="label">Alcohol</label>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
                  <ChoiceCard selected={alcoholSelected} disabled={alcoholAnd420Disabled} title={alcoholSelected ? 'You are Alcohol Friendly' : 'Alcohol-friendly'} imageSrc={beerImg} imageAlt="Alcohol-friendly golfer option" onClick={toggleAlcoholPreference} />
                </div>
              </div>

              <div>
                <label className="label">Weed</label>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
                  <ChoiceCard selected={cannabisSelected} disabled={alcoholAnd420Disabled} title={cannabisSelected ? 'You are 420 Friendly' : '420 friendly'} imageSrc={friendly420Img} imageAlt="420-friendly golfer option" onClick={toggleCannabisPreference} />
                </div>
              </div>

              <div>
                <label className="label">Sobriety</label>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
                  <ChoiceCard selected={soberSelected} disabled={soberDisabled} title="Prefer to golf with other sober golfers" imageSrc={soberGolfImg} imageAlt="Sober golfer preference option" onClick={toggleSobrietyPreference} />
                </div>
              </div>
            </>
          ) : <div className="small">Preference settings are not available for admin, host, or organizer accounts.</div>) : null}

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


function formatProfileSummaryDate(value: string | null | undefined) {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T00:00:00`))
  } catch {
    return String(value)
  }
}

type ProfileSummarySectionProps = {
  summary: ProfileSummary | null
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function ProfileSummarySection({ summary }: ProfileSummarySectionProps) {
  const roundsGolfed = summary?.roundsGolfed ?? 0
  const individualEvents = summary?.eventTypes?.individual ?? 0
  const teamEvents = summary?.eventTypes?.team ?? 0
  const mostPlayedCourse = summary?.mostPlayedCourse
  const handicap = summary?.handicap
  const bestScore = summary?.bestScore
  const hasRounds = roundsGolfed > 0

  const eventSummary = [
    individualEvents ? pluralize(individualEvents, 'individual event') : '',
    teamEvents ? pluralize(teamEvents, 'team event') : '',
  ].filter(Boolean).join(' and ')

  const courseSummary = mostPlayedCourse
    ? `You golf most at ${mostPlayedCourse.course}, with ${pluralize(mostPlayedCourse.count, 'logged round')} there.`
    : 'Start logging rounds to reveal the course you play the most.'

  const bestScoreSummary = bestScore
    ? `Your best completed ${bestScore.mode === 'solo' ? 'individual' : 'team'} score is ${bestScore.score}${bestScore.course ? ` at ${bestScore.course}` : ''}${bestScore.date ? ` on ${formatProfileSummaryDate(bestScore.date)}` : ''}.`
    : 'Finish an 18-hole scorecard to unlock your best completed score.'

  const handicapSummary = handicap?.handicap != null
    ? `Your current handicap is ${handicap.handicap.toFixed(1)}. ${handicap.message}`
    : `${handicap?.message || 'Log rated solo rounds to unlock a handicap.'}`

  const leadSentence = hasRounds
    ? `You have logged ${pluralize(roundsGolfed, 'round')} across ${eventSummary || 'golf events'}.`
    : 'Your Golf Homiez profile is ready for your first logged round.'

  const encouragement = hasRounds
    ? 'Keep chasing lower scores, adding complete rounds, and building your Golf Homiez history.'
    : 'Log your next round to start building your golf story and track your progress.'

  return (
    <section className="profileSummaryCard card" aria-labelledby="profile-summary-title">
      <div>
        <div id="profile-summary-title" className="label">Profile Summary</div>
        <div className="small">A quick snapshot of your Golf Homiez activity.</div>
      </div>
      <p className="profileSummaryNarrative">
        {leadSentence} {courseSummary} {bestScoreSummary} {handicapSummary} {encouragement}
      </p>
    </section>
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
