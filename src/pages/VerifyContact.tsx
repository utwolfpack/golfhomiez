import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { getLatestPhoneOtp, getLatestVerificationLink, sendPhoneOtp, sendVerificationEmail, verifyPhoneOtp } from '../lib/auth-api'

export default function VerifyContact() {
  const [params] = useSearchParams()
  const startingEmail = useMemo(() => params.get('email') || '', [params])
  const phone = useMemo(() => params.get('phone') || '', [params])
  const showWelcome = useMemo(() => params.get('welcome') === '1', [params])
  const emailCallbackURL = useMemo(() => {
    const publicServerOrigin = String(import.meta.env.VITE_PUBLIC_SERVER_ORIGIN || '').trim()
    const callbackBase = publicServerOrigin || window.location.origin
    return `${callbackBase}/login?verified=1`
  }, [])
  const [email, setEmail] = useState(startingEmail)
  const [phoneCode, setPhoneCode] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null)
  const [latestSmsCode, setLatestSmsCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showWelcomeModal, setShowWelcomeModal] = useState(showWelcome)

  useEffect(() => {
    setEmail(startingEmail)
    setShowWelcomeModal(showWelcome)
  }, [startingEmail, showWelcome])

  useEffect(() => {
    ;(async () => {
      if (email) {
        const latest = await getLatestVerificationLink(email)
        if (latest.data?.url) setVerificationUrl(latest.data.url)
      }
      if (phone) {
        const latest = await getLatestPhoneOtp(phone)
        if (latest.data?.code) setLatestSmsCode(latest.data.code)
      }
    })()
  }, [email, phone])

  async function resendEmail() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await sendVerificationEmail(email, emailCallbackURL)
      if (result.error) throw new Error(result.error.message || 'Could not resend email verification')
      setMessage('Verification email sent.')
      const latest = await getLatestVerificationLink(email)
      if (latest.data?.url) setVerificationUrl(latest.data.url)
    } catch (err: any) {
      setError(err?.message || 'Could not resend email verification')
    } finally {
      setBusy(false)
    }
  }

  async function resendSms() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await sendPhoneOtp(phone)
      if (result.error) throw new Error(result.error.message || 'Could not resend SMS code')
      setMessage('SMS verification code sent.')
      const latest = await getLatestPhoneOtp(phone)
      if (latest.data?.code) setLatestSmsCode(latest.data.code)
    } catch (err: any) {
      setError(err?.message || 'Could not resend SMS code')
    } finally {
      setBusy(false)
    }
  }

  async function onVerifyPhone(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await verifyPhoneOtp(phone, phoneCode, true)
      if (result.error) throw new Error(result.error.message || 'Could not verify phone number')
      setMessage('Phone number verified.')
      setPhoneCode('')
    } catch (err: any) {
      setError(err?.message || 'Could not verify phone number')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {showWelcomeModal ? (
        <div className="modalOverlay" onMouseDown={() => setShowWelcomeModal(false)}>
          <div className="modalCard" onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div style={{ fontSize: 20, fontWeight: 900 }}>Check your email to finish registration</div>
            <div className="small" style={{ marginTop: 10 }}>
              We created your account. Look for the verification email at <strong>{email || 'your inbox'}</strong> and click the link to complete registration.
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button type="button" className="btn btnPrimary" onClick={() => setShowWelcomeModal(false)}>Got it</button>
              <button type="button" className="btn" onClick={resendEmail} disabled={!email || busy}>Resend email</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="container pageStack">
        <div className="card pageCardShell">
          <PageHero
            eyebrow="Verify your contact info"
            title="Finish setup with email and SMS"
            subtitle="Your email verification is required for sign-in. SMS verification is also available for phone-based recovery."
          />

          <div className="grid grid2" style={{ gap: 16 }}>
            <div className="card" style={{ background: 'rgba(255,255,255,.72)' }}>
              <h3 style={{ marginTop: 0 }}>Email verification</h3>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <div className="small" style={{ marginTop: 10 }}>Use the verification link sent to your inbox before signing in.</div>
              {verificationUrl ? <div className="small" style={{ wordBreak: 'break-word', marginTop: 10 }}>Local verification link: <a href={verificationUrl}>{verificationUrl}</a></div> : null}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                <button type="button" className="btn btnPrimary" disabled={busy || !email} onClick={resendEmail}>Resend email</button>
                <Link className="btn" to="/login">Go to login</Link>
              </div>
            </div>

            <div className="card" style={{ background: 'rgba(255,255,255,.72)' }}>
              <h3 style={{ marginTop: 0 }}>SMS verification</h3>
              <div className="small">Phone: <strong>{phone || 'Not provided'}</strong></div>
              <form onSubmit={onVerifyPhone} className="formStack" style={{ marginTop: 12 }}>
                <div>
                  <label className="label">Verification code</label>
                  <input className="input" value={phoneCode} onChange={e => setPhoneCode(e.target.value)} placeholder="6-digit SMS code" />
                </div>
                {latestSmsCode ? <div className="small">Local SMS code: <strong>{latestSmsCode}</strong></div> : null}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button type="submit" className="btn btnPrimary" disabled={busy || !phone}>Verify phone</button>
                  <button type="button" className="btn" disabled={busy || !phone} onClick={resendSms}>Resend SMS</button>
                </div>
              </form>
            </div>
          </div>

          {message ? <div className="small" style={{ color: '#166534', marginTop: 16 }}>{message}</div> : null}
          {error ? <div className="small" style={{ color: '#b91c1c', marginTop: 16 }}>{error}</div> : null}
        </div>
      </div>
    </>
  )
}
