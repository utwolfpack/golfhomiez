import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import ImageUploadField from '../components/ImageUploadField'
import PageHero from '../components/PageHero'
import {
  fetchHostGolfHomiezSite,
  updateHostGolfHomiezSite,
  type GolfCoursePublicPageInput,
  type HostAccount,
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

function nullableInput(value: string) {
  return value.trim() ? value : null
}

function toPublicPage(account: HostAccount | null): GolfCoursePublicPageInput {
  const page = account?.publicPage
  return page ? {
    summary: page.summary || '',
    bannerImageUrl: page.bannerImageUrl || null,
    bannerImageData: page.bannerImageData || null,
    websiteUrl: page.websiteUrl || account?.catalogCourse?.websiteUrl || null,
    contactPhone: sanitizePhoneInput(page.contactPhone || account?.catalogCourse?.phone || ''),
    addressLine1: page.addressLine1 || account?.catalogCourse?.addressLine1 || null,
    city: page.city || account?.catalogCourse?.city || null,
    stateCode: page.stateCode || account?.catalogCourse?.stateCode || '',
    postalCode: page.postalCode || account?.catalogCourse?.postalCode || null,
    isPublished: page.isPublished,
  } : {
    ...emptyPublicPage,
    websiteUrl: account?.catalogCourse?.websiteUrl || null,
    contactPhone: sanitizePhoneInput(account?.catalogCourse?.phone || ''),
    addressLine1: account?.catalogCourse?.addressLine1 || null,
    city: account?.catalogCourse?.city || null,
    stateCode: account?.catalogCourse?.stateCode || '',
    postalCode: account?.catalogCourse?.postalCode || null,
  }
}

export default function HostGolfHomiezSite() {
  const [account, setAccount] = useState<HostAccount | null>(null)
  const [publicPage, setPublicPage] = useState<GolfCoursePublicPageInput>(emptyPublicPage)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  function updatePublicPage(updates: Partial<GolfCoursePublicPageInput>) {
    setPublicPage((previous) => ({ ...previous, ...updates }))
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const loaded = await fetchHostGolfHomiezSite()
        if (!active) return
        setAccount(loaded)
        setPublicPage(toPublicPage(loaded))
        logFrontendEvent({
          category: 'host.golfhomiezSite',
          message: 'host_golfhomiez_site_loaded',
          data: {
            hostAccountId: loaded.id,
            golfCourseId: loaded.golfCourseId || null,
            publicPageSlug: loaded.publicPage?.slug || null,
            publicPageUrl: loaded.publicPage?.url || null,
            websiteUrl: loaded.publicPage?.websiteUrl || null,
            hasUploadedBanner: Boolean(loaded.publicPage?.bannerImageData),
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load the Golf Homiez Site settings.'
        if (active) setError(message)
        logFrontendEvent({ category: 'host.golfhomiezSite', level: 'error', message: 'host_golfhomiez_site_load_failed', data: { error: message } })
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const phoneError = validateOptionalPhoneNumber(publicPage.contactPhone)
    if (phoneError) {
      setError(phoneError || PHONE_VALIDATION_MESSAGE)
      logFrontendEvent({ category: 'host.golfhomiezSite', level: 'error', message: 'host_golfhomiez_site_invalid_phone', data: { hostAccountId: account?.id || null } })
      return
    }
    if (!publicPage.summary.trim()) {
      setError('Course Summary is a required field.')
      return
    }
    if (!publicPage.stateCode.trim()) {
      setError('State is a required field.')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      logFrontendEvent({
        category: 'host.golfhomiezSite',
        message: 'host_golfhomiez_site_update_started',
        data: {
          hostAccountId: account?.id || null,
          publicPageSlug: account?.publicPage?.slug || null,
          publicPagePublished: publicPage.isPublished,
          hasUploadedBanner: Boolean(publicPage.bannerImageData),
          websiteUrl: publicPage.websiteUrl || null,
        },
      })
      const saved = await updateHostGolfHomiezSite(publicPage)
      setAccount(saved)
      setPublicPage(toPublicPage(saved))
      setSuccess('Golf Homiez Site updated.')
      logFrontendEvent({
        category: 'host.golfhomiezSite',
        message: 'host_golfhomiez_site_updated',
        data: {
          hostAccountId: saved.id,
          publicPageSlug: saved.publicPage?.slug || null,
          publicPageUrl: saved.publicPage?.url || null,
          websiteUrl: saved.publicPage?.websiteUrl || null,
          hasUploadedBanner: Boolean(saved.publicPage?.bannerImageData),
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update the Golf Homiez Site.'
      setError(message)
      logFrontendEvent({ category: 'host.golfhomiezSite', level: 'error', message: 'host_golfhomiez_site_update_failed', data: { error: message } })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Golf-course portal" title="Golf Homiez Site" subtitle="Manage the public GolfHomiez website for your golf course." />
        {loading ? <div className="small">Loading Golf Homiez Site…</div> : null}
        {error ? <div className="small" role="alert" style={{ color: '#b91c1c' }}>{error}</div> : null}
        {success ? <div className="small" role="status" style={{ color: '#166534' }}>{success}</div> : null}

        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 860 }}>
          <section className="hostProfileSection">
            <div className="hostProfileSectionHeading">
              <div><h2>Public Golf-Course Page</h2></div>
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
              onChange={(bannerImageData) => updatePublicPage({ bannerImageData, bannerImageUrl: null })}
              onRemove={() => updatePublicPage({ bannerImageData: null, bannerImageUrl: null })}
              options={{
                maxWidth: 1800,
                maxHeight: 900,
                maxBytes: 700 * 1024,
                quality: 0.82,
                correlationData: { hostAccountId: account?.id || null, publicPageSlug: account?.publicPage?.slug || null, imagePurpose: 'golf-course-banner' },
              }}
            />
            <div className="small">Upload a landscape JPG, PNG, or WebP image. Custom banner URLs are not used; the uploaded image is compressed before it is saved.</div>

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
            <button className="btn btnPrimary" disabled={saving}>{saving ? 'Saving…' : 'Save Golf Homiez Site'}</button>
            <Link className="btn" to="/host/portal/profile">Host profile</Link>
            <Link className="btn" to="/host/portal">Back to host portal</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
