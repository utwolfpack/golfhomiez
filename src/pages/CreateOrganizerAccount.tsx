import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { createOrganizerAccount, fetchOrganizerAccount, type OrganizerAccountInput } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { useAuth } from '../context/AuthContext'

const EMPTY_FORM: OrganizerAccountInput = {
  organizationName: '',
  contactName: '',
  phone: '',
  websiteUrl: '',
  notes: '',
}

export default function CreateOrganizerAccount() {
  const [form, setForm] = useState<OrganizerAccountInput>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()
  const { refreshRoles } = useAuth()

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const account = await fetchOrganizerAccount()
        if (!active || !account) return
        setForm({
          organizationName: account.organizationName,
          contactName: account.contactName,
          phone: account.phone || '',
          websiteUrl: account.websiteUrl || '',
          notes: account.notes || '',
        })
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load organizer account.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const account = await createOrganizerAccount(form)
      await refreshRoles()
      setSuccess(`Organizer access is active for ${account.organizationName}.`)
      logFrontendEvent({ category: 'accounts.organizer', message: 'organizer_account_saved', data: { organizationName: account.organizationName, role: account.role } })
      navigate('/organizer/register?created=1', { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save organizer account.'
      setError(message)
      logFrontendEvent({ category: 'accounts.organizer', level: 'error', message: 'organizer_account_save_failed', data: { error: message } })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="container"><div className="card">Loading organizer account…</div></div>

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow="Organizer account"
          title="Create a tournament organizer account"
          subtitle="Reuse the same email as your user account and unlock tournament management features."
        />

        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 640 }}>
          <div>
            <label className="label">Organization name</label>
            <input className="input" value={form.organizationName} onChange={(e) => setForm((prev) => ({ ...prev, organizationName: e.target.value }))} />
          </div>
          <div>
            <label className="label">Contact name</label>
            <input className="input" value={form.contactName} onChange={(e) => setForm((prev) => ({ ...prev, contactName: e.target.value }))} />
          </div>
          <div className="formRow formRow--split">
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone || ''} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} />
            </div>
            <div>
              <label className="label">Website</label>
              <input className="input" value={form.websiteUrl || ''} onChange={(e) => setForm((prev) => ({ ...prev, websiteUrl: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={4} value={form.notes || ''} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
          </div>

          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          {success ? <div className="small" style={{ color: '#166534' }}>{success}</div> : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={saving}>{saving ? 'Saving…' : 'Save organizer account'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
