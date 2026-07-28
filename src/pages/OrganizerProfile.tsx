import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import PageHero from '../components/PageHero'
import { useOrganizerAuth } from '../context/OrganizerAuthContext'
import { fetchOrganizerProfile, updateOrganizerProfile, type OrganizerAccount, type OrganizerAccountInput } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { PHONE_PATTERN, PHONE_VALIDATION_MESSAGE, sanitizePhoneInput, validateOptionalPhoneNumber } from '../lib/phone-validation'

function toForm(account: OrganizerAccount | null): OrganizerAccountInput {
  return {
    organizationName: account?.organizationName || '',
    contactName: account?.contactName || '',
    phone: sanitizePhoneInput(account?.phone || ''),
    notes: account?.notes || null,
  }
}

export default function OrganizerProfile() {
  const { refreshOrganizerSession } = useOrganizerAuth()
  const [account, setAccount] = useState<OrganizerAccount | null>(null)
  const [form, setForm] = useState<OrganizerAccountInput>(toForm(null))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  function setPhoneValue(value: string) {
    setForm((prev) => ({ ...prev, phone: sanitizePhoneInput(value) }))
  }

  function setNotesValue(value: string) {
    setForm((prev) => ({ ...prev, notes: value.trim() ? value : null }))
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const loaded = await fetchOrganizerProfile()
        if (!active) return
        setAccount(loaded)
        setForm(toForm(loaded))
        logFrontendEvent({ category: 'organizer.profile', message: 'organizer_profile_loaded', data: { organizerAccountId: loaded.id } })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load organizer profile.'
        if (active) setError(message)
        logFrontendEvent({ category: 'organizer.profile', level: 'error', message: 'organizer_profile_load_failed', data: { error: message } })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const phoneValidationError = validateOptionalPhoneNumber(form.phone)
    if (phoneValidationError) {
      setError(phoneValidationError)
      logFrontendEvent({ category: 'organizer.profile', level: 'error', message: 'organizer_profile_invalid_phone', data: { organizerAccountId: account?.id || null } })
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      logFrontendEvent({ category: 'organizer.profile', message: 'organizer_profile_update_started', data: { organizerAccountId: account?.id || null, hasNotes: Boolean(form.notes && form.notes.trim()), hasPhone: Boolean(form.phone && form.phone.trim()) } })
      const saved = await updateOrganizerProfile(form)
      setAccount(saved)
      setForm(toForm(saved))
      await refreshOrganizerSession()
      setSuccess('Organizer profile updated.')
      logFrontendEvent({ category: 'organizer.profile', message: 'organizer_profile_updated', data: { organizerAccountId: saved.id } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update organizer profile.'
      setError(message)
      logFrontendEvent({ category: 'organizer.profile', level: 'error', message: 'organizer_profile_update_failed', data: { error: message } })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Organizer portal" title="Organizer profile" subtitle="Update the organization profile information used with hosted tournament invitations." />
        {loading ? <div className="small">Loading organizer profile…</div> : null}
        {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
        {success ? <div className="small" style={{ color: '#166534' }}>{success}</div> : null}
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 760 }}>
          <div>
            <label className="label">Organization name</label>
            <input className="input" value={form.organizationName} onChange={(e) => setForm((prev) => ({ ...prev, organizationName: e.target.value }))} required />
          </div>
          <div>
            <label className="label">Contact name</label>
            <input className="input" value={form.contactName || ''} onChange={(e) => setForm((prev) => ({ ...prev, contactName: e.target.value }))} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" type="tel" inputMode="tel" pattern={PHONE_PATTERN} title={PHONE_VALIDATION_MESSAGE} aria-invalid={Boolean(form.phone && validateOptionalPhoneNumber(form.phone))} value={form.phone || ''} onChange={(e) => setPhoneValue(e.target.value)} />
            <div className="small">Format: 801 743 7000.</div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={4} value={form.notes ?? ''} onChange={(e) => setNotesValue(e.target.value)} />
          </div>
          <div className="small"><strong>Email:</strong> {account?.email || 'Not available'}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={saving}>{saving ? 'Saving…' : 'Save organizer profile'}</button>
            <Link className="btn" to="/organizer/portal">Back to organizer portal</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
