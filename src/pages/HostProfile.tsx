import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { useHostAuth } from '../context/HostAuthContext'
import { fetchHostProfile, updateHostProfile, type HostAccount, type HostAccountInput } from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'

function toForm(account: HostAccount | null): HostAccountInput {
  return {
    golfCourseName: account?.golfCourseName || '',
    contactName: account?.contactName || '',
    phone: account?.phone || '',
    websiteUrl: account?.websiteUrl || '',
    notes: account?.notes || '',
  }
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
        logFrontendEvent({ category: 'host.profile', message: 'host_profile_loaded', data: { hostAccountId: loaded.id } })
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
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const saved = await updateHostProfile(form)
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
        <PageHero eyebrow="Golf-course portal" title="Host profile" subtitle="Update the golf-course profile information organizers and administrators use for tournaments." />
        {loading ? <div className="small">Loading host profile…</div> : null}
        {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
        {success ? <div className="small" style={{ color: '#166534' }}>{success}</div> : null}
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 760 }}>
          <div>
            <label className="label">Golf-course name</label>
            <input className="input" value={form.golfCourseName} onChange={(e) => setForm((prev) => ({ ...prev, golfCourseName: e.target.value }))} required />
          </div>
          <div>
            <label className="label">Contact name</label>
            <input className="input" value={form.contactName || ''} onChange={(e) => setForm((prev) => ({ ...prev, contactName: e.target.value }))} />
          </div>
          <div className="formRow formRow--split">
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone || ''} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} />
            </div>
            <div>
              <label className="label">Website URL</label>
              <input className="input" type="url" value={form.websiteUrl || ''} onChange={(e) => setForm((prev) => ({ ...prev, websiteUrl: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={4} value={form.notes || ''} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
          </div>
          <div className="small"><strong>Email:</strong> {account?.email || 'Not available'}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={saving}>{saving ? 'Saving…' : 'Save host profile'}</button>
            <Link className="btn" to="/host/portal">Back to host portal</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
