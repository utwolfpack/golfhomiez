import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { getVerificationStatus, sendVerificationEmail } from '../lib/auth-api'

export default function VerifyContact() {
  const [params] = useSearchParams()
  const startingEmail = useMemo(() => params.get('email') || '', [params])
  const showWelcome = useMemo(() => params.get('welcome') === '1', [params])
  const emailCallbackURL = useMemo(() => `${window.location.origin}/login?verified=1`, [])
  const [email, setEmail] = useState(startingEmail)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showWelcomeModal, setShowWelcomeModal] = useState(showWelcome)
  const [isVerified, setIsVerified] = useState(false)

  useEffect(() => {
    setEmail(startingEmail)
    setShowWelcomeModal(showWelcome)
  }, [startingEmail, showWelcome])

  useEffect(() => {
    let active = true

    async function loadStatus() {
      if (!email) {
        if (active) {
          setIsVerified(false)
          setMessage(null)
        }
        return
      }

      try {
        const result = await getVerificationStatus(email)
        if (!active) return
        const verified = Boolean(result.data?.verified)
        setIsVerified(verified)
        if (verified) {
          setMessage('This email address is already verified. You can sign in now.')
          setError(null)
        }
      } catch {
        if (active) setIsVerified(false)
      }
    }

    void loadStatus()
    return () => {
      active = false
    }
  }, [email])

  async function resendEmail() {
    if (isVerified) {
      setError(null)
      setMessage('This email address is already verified. You can sign in now.')
      return
    }

    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await sendVerificationEmail(email, emailCallbackURL)
      if (result.error) throw new Error(result.error.message || 'Could not resend email verification')
      if (result.data?.alreadyVerified) {
        setIsVerified(true)
        setMessage('This email address is already verified. You can sign in now.')
        return
      }
      setMessage(result.data?.message || 'Verification email sent.')
    } catch (err: any) {
      setError(err?.message || 'Could not resend email verification')
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
              <button type="button" className="btn" onClick={resendEmail} disabled={!email || busy || isVerified}>Resend email</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="container pageStack">
        <div className="card pageCardShell">
          <PageHero
            eyebrow="Verify your contact info"
            title="Finish setup with email verification"
            subtitle="Your email verification is required before you can sign in."
          />

          <div className="grid" style={{ gap: 16 }}>
            <div className="card" style={{ background: 'rgba(255,255,255,.72)', maxWidth: 640 }}>
              <h3 style={{ marginTop: 0 }}>Email verification</h3>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                <button type="button" className="btn btnPrimary" disabled={busy || !email || isVerified} onClick={resendEmail}>Resend email</button>
                <Link className="btn" to="/login">Go to login</Link>
              </div>
              {isVerified ? <div className="small" style={{ color: '#166534', marginTop: 12 }}>This email address is already verified. You can sign in now.</div> : null}
            </div>
          </div>

          {message ? <div className="small" style={{ color: '#166534', marginTop: 16 }}>{message}</div> : null}
          {error ? <div className="small" style={{ color: '#b91c1c', marginTop: 16 }}>{error}</div> : null}
        </div>
      </div>
    </>
  )
}
