import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import PageHero from '../components/PageHero'
import ImageUploadField from '../components/ImageUploadField'
import { useHostAuth } from '../context/HostAuthContext'
import {
  fetchHostProfile,
  updateHostProfile,
  type GolfCoursePublicPageInput,
  type HostAccount,
  type HostAccountInput,
} from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'
import { PHONE_PATTERN, PHONE_VALIDATION_MESSAGE, sanitizePhoneInput, validateOptionalPhoneNumber } from '../lib/phone-validation'

const defaultGolfCourseBanner = '/DefaultGolfBanner.jpg'

const emptyPublicPage: GolfCoursePublicPageInput = {
  summary: '',
  bannerImageUrl: null,
  bannerImageData: null,
  websiteUrl: null,
  contactPhone: null,
  addressLine1: null,
  city: null,
  stateCode: '',
  postalCode: null,
  isPublished: true,
}

function toForm(account: HostAccount | null): HostAccountInput {
  return {
    golfCourseName: account?.golfCourseName || '',
    contactName: account?.contactName || '',
    phone: sanitizePhoneInput(account?.phone || account?.catalogCourse?.phone || ''),
    notes: account?.notes || null,
    publicPage: account?.publicPage ? {
      summary: account.publicPage.summary || '',
      bannerImageUrl: account.publicPage.bannerImageUrl || null,
      bannerImageData: account.publicPage.bannerImageData || null,
      websiteUrl: account.publicPage.websiteUrl || account.catalogCourse?.websiteUrl || null,
      contactPhone: sanitizePhoneInput(account.publicPage.contactPhone || account.catalogCourse?.phone || ''),
      addressLine1: account.publicPage.addressLine1 || account.catalogCourse?.addressLine1 || null,
      city: account.publicPage.city || account.catalogCourse?.city || null,
      stateCode: account.publicPage.stateCode || account.catalogCourse?.stateCode || '',
      postalCode: account.publicPage.postalCode || account.catalogCourse?.postalCode || null,
      isPublished: account.publicPage.isPublished,
    } : {
      ...emptyPublicPage,
      websiteUrl: account?.catalogCourse?.websiteUrl || null,
      contactPhone: sanitizePhoneInput(account?.catalogCourse?.phone || ''),
      addressLine1: account?.catalogCourse?.addressLine1 || null,
      city: account?.catalogCourse?.city || null,
      stateCode: account?.catalogCourse?.stateCode || '',
      postalCode: account?.catalogCourse?.postalCode || null,
    },
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

  function updatePublicPage(updates: Partial<GolfCoursePublicPageInput>) {
    setForm((previous) => ({
      ...previous,
      publicPage: {
        ...(previous.publicPage || emptyPublicPage),
        ...updates,
      },
    }))
  }

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
            publicPageSlug: loaded.publicPage?.slug || null,
            accountPhonePopulated: Boolean(loaded.phone),
            catalogCourseAvailable: Boolean(loaded.catalogCourse),
            uploadedBannerAvailable: Boolean(loaded.publicPage?.bannerImageData),
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
    const accountPhoneError = validateOptionalPhoneNumber(form.phone)
    const publicPhoneError = validateOptionalPhoneNumber(form.publicPage?.contactPhone)
    if (accountPhoneError || publicPhoneError) {
      const validationError = accountPhoneError || publicPhoneError || PHONE_VALIDATION_MESSAGE
      setError(validationError)
      logFrontendEvent({ category: 'host.profile', level: 'error', message: 'host_profile_invalid_phone', data: { hostAccountId: account?.id || null } })
      return
    }
    if (!form.publicPage?.summary?.trim()) {
      setError('Course Summary is a required field.')
      return
    }
    if (!form.publicPage?.stateCode?.trim()) {
      setError('State is a required field.')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      logFrontendEvent({
        category: 'host.profile',
        message: 'host_profile_update_started',
        data: {
          hostAccountId: account?.id || null,
          golfCourseId: account?.golfCourseId || null,
          publicPageSlug: account?.publicPage?.slug || null,
          publicPagePublished: form.publicPage?.isPublished ?? null,
          hasUploadedBanner: Boolean(form.publicPage?.bannerImageData),
        },
      })
      const saved = await updateHostProfile(form)
      setAccount(saved)
      setForm(toForm(saved))
      await refreshHostSession()
      setSuccess('Host profile and public golf-course page updated.')
      logFrontendEvent({
        category: 'host.profile',
        message: 'host_profile_updated',
        data: {
          hostAccountId: saved.id,
          publicPageSlug: saved.publicPage?.slug || null,
          hasUploadedBanner: Boolean(saved.publicPage?.bannerImageData),
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update host profile.'
      setError(message)
      logFrontendEvent({ category: 'host.profile', level: 'error', message: 'host_profile_update_failed', data: { error: message } })
    } finally {
      setSaving(false)
    }
  }

  const publicPage = form.publicPage || emptyPublicPage

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Golf-course portal" title="Host profile" subtitle="Update account details and the public GolfHomiez page for your course." />
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

          <section className="hostProfileSection">
            <div className="hostProfileSectionHeading">
              <div><h2>Public golf-course page</h2></div>
              <label className="hostProfilePublishToggle">
                <input type="checkbox" checked={publicPage.isPublished} onChange={(event) => updatePublicPage({ isPublished: event.target.checked })} />
                Published
              </label>
            </div>

            {account?.publicPage?.url ? (
              <div className="publicPageUrlRow">
                <div>
                  <div className="label">Public page URL</div>
                  <div className="small publicPageUrlText">{account.publicPage.url}</div>
                </div>
                <a className="btn" href={account.publicPage.url} target="_blank" rel="noreferrer">Preview page</a>
              </div>
            ) : null}

            <div>
              <label className="label">Course Summary</label>
              <textarea className="input" rows={6} value={publicPage.summary} onChange={(event) => updatePublicPage({ summary: event.target.value })} maxLength={5000} required />
            </div>

            <ImageUploadField
              label="Golf-course banner"
              value={publicPage.bannerImageData}
              previewValue={publicPage.bannerImageData || defaultGolfCourseBanner}
              emptyText="The default golf-course banner will be used until an image is uploaded."
              previewAlt={publicPage.bannerImageData ? 'Uploaded golf-course banner preview' : 'Default golf-course banner preview'}
              onChange={(bannerImageData) => updatePublicPage({ bannerImageData })}
              onRemove={() => updatePublicPage({ bannerImageData: null })}
              options={{
                maxWidth: 1800,
                maxHeight: 900,
                maxBytes: 700 * 1024,
                quality: 0.82,
                correlationData: { hostAccountId: account?.id || null, publicPageSlug: account?.publicPage?.slug || null, imagePurpose: 'golf-course-banner' },
              }}
            />
            <div className="small">Upload a landscape JPG, PNG, or WebP image. The image is compressed before it is saved.</div>

            <div className="grid grid2" style={{ gap: 12 }}>
              <div>
                <label className="label">Course Website URL</label>
                <input className="input" type="text" inputMode="url" value={publicPage.websiteUrl || ''} onChange={(event) => updatePublicPage({ websiteUrl: nullableInput(event.target.value) })} />
              </div>
              <div>
                <label className="label">Public Contact Phone</label>
                <input className="input" type="tel" inputMode="tel" pattern={PHONE_PATTERN} title={PHONE_VALIDATION_MESSAGE} value={publicPage.contactPhone || ''} onChange={(event) => updatePublicPage({ contactPhone: nullableInput(sanitizePhoneInput(event.target.value)) })} />
              </div>
            </div>

            <div>
              <label className="label">Street Address</label>
              <input className="input" value={publicPage.addressLine1 || ''} onChange={(event) => updatePublicPage({ addressLine1: nullableInput(event.target.value) })} />
            </div>
            <div className="grid grid3" style={{ gap: 12 }}>
              <div>
                <label className="label">City</label>
                <input className="input" value={publicPage.city || ''} onChange={(event) => updatePublicPage({ city: nullableInput(event.target.value) })} />
              </div>
              <div>
                <label className="label">State</label>
                <input className="input" value={publicPage.stateCode} maxLength={2} onChange={(event) => updatePublicPage({ stateCode: event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) })} required />
              </div>
              <div>
                <label className="label">Zip Code</label>
                <input className="input" value={publicPage.postalCode || ''} onChange={(event) => updatePublicPage({ postalCode: nullableInput(event.target.value) })} />
              </div>
            </div>
          </section>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={saving}>{saving ? 'Saving…' : 'Save host profile'}</button>
            <Link className="btn" to="/host/portal">Back to host portal</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
