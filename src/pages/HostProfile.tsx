import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import PageHero from '../components/PageHero'
import { useHostAuth } from '../context/HostAuthContext'
import { fetchHostProfile, updateHostProfile, type HostAccount, type HostAccountInput } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { PHONE_PATTERN, PHONE_VALIDATION_MESSAGE, sanitizePhoneInput, validateOptionalPhoneNumber } from '../lib/phone-validation'

function toForm(account: HostAccount | null): HostAccountInput {
  return {
    golfCourseName: account?.golfCourseName || '',
    contactName: account?.contactName || '',
    phone: sanitizePhoneInput(account?.phone || account?.catalogCourse?.phone || ''),
    notes: account?.notes || null,
  }
}

function nullableInput(value: string) {
  return value.trim() ? value : null
}

export default function HostProfile() {
  const { refreshHostSession } = useHostAuth()
  const [account, setAccount] = useState<HostAccount | null>(null)
  const [form, setForm] = useState<HostAccountInput>(toForm(null))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const loaded = await fetchHostProfile()
        if (!active) return
        setAccount(loaded)
        setForm(toForm(loaded))
        logFrontendEvent({
          category: 'host.profile',
          message: 'host_profile_loaded',
          data: {
            hostAccountId: loaded.id,
            golfCourseId: loaded.golfCourseId || null,
            accountPhonePopulated: Boolean(loaded.phone),
            catalogCourseAvailable: Boolean(loaded.catalogCourse),
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load host profile.'
        if (active) setError(message)
        logFrontendEvent({ category: 'host.profile', level: 'error', message: 'host_profile_load_failed', data: { error: message } })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const phoneError = validateOptionalPhoneNumber(form.phone)
    if (phoneError) {
      setError(phoneError || PHONE_VALIDATION_MESSAGE)
      logFrontendEvent({ category: 'host.profile', level: 'error', message: 'host_profile_invalid_phone', data: { hostAccountId: account?.id || null } })
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      logFrontendEvent({
        category: 'host.profile',
        message: 'host_profile_update_started',
        data: { hostAccountId: account?.id || null, golfCourseId: account?.golfCourseId || null },
      })
      const saved = await updateHostProfile({
        golfCourseName: form.golfCourseName,
        contactName: form.contactName,
        phone: form.phone,
        notes: form.notes,
      })
      setAccount(saved)
      setForm(toForm(saved))
      await refreshHostSession()
      setSuccess('Host profile updated.')
      logFrontendEvent({ category: 'host.profile', message: 'host_profile_updated', data: { hostAccountId: saved.id } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update host profile.'
      setError(message)
      logFrontendEvent({ category: 'host.profile', level: 'error', message: 'host_profile_update_failed', data: { error: message } })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Golf-course portal" title="Host profile" subtitle="Update the host account details for your golf course." />
        {loading ? <div className="small">Loading host profile…</div> : null}
        {error ? <div className="small" role="alert" style={{ color: '#b91c1c' }}>{error}</div> : null}
        {success ? <div className="small" role="status" style={{ color: '#166534' }}>{success}</div> : null}

        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 860 }}>
          <section className="hostProfileSection">
            <h2>Host account</h2>
            <div>
              <label className="label">Golf Course Name</label>
              <input className="input" value={form.golfCourseName} readOnly aria-readonly="true" title="The golf-course name is managed from the associated golf-course record." />
            </div>
            <div className="grid grid2" style={{ gap: 12 }}>
              <div>
                <label className="label">Contact name</label>
                <input className="input" value={form.contactName || ''} onChange={(event) => setForm((previous) => ({ ...previous, contactName: event.target.value }))} />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" type="tel" inputMode="tel" pattern={PHONE_PATTERN} title={PHONE_VALIDATION_MESSAGE} value={form.phone || ''} onChange={(event) => setForm((previous) => ({ ...previous, phone: sanitizePhoneInput(event.target.value) }))} />
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input" rows={3} value={form.notes ?? ''} onChange={(event) => setForm((previous) => ({ ...previous, notes: nullableInput(event.target.value) }))} />
            </div>
            <div className="small"><strong>Email:</strong> {account?.email || 'Not available'}</div>
          </section>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={saving}>{saving ? 'Saving…' : 'Save host profile'}</button>
            <Link className="btn" to="/host/golfhomiezsite">Golf Homiez Site</Link>
            <Link className="btn" to="/host/portal">Back to host portal</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
