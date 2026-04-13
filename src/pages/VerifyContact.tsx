import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { sendVerificationEmail } from '../lib/auth-api'

export default function VerifyContact() {
  const [params] = useSearchParams()
  const startingEmail = useMemo(() => params.get('email') || '', [params])
  const showWelcome = useMemo(() => params.get('welcome') === '1', [params])
  const emailCallbackURL = useMemo(() => {
    const publicServerOrigin = String(import.meta.env.VITE_PUBLIC_SERVER_ORIGIN || '').trim()
    const callbackBase = publicServerOrigin || window.location.origin
    return `${callbackBase}/login?verified=1`
  }, [])
  const [email, setEmail] = useState(startingEmail)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showWelcomeModal, setShowWelcomeModal] = useState(showWelcome)

  useEffect(() => {
    setEmail(startingEmail)
    setShowWelcomeModal(showWelcome)
  }, [startingEmail, showWelcome])

  async function resendEmail() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await sendVerificationEmail(email, emailCallbackURL)
      if (result.error) throw new Error(result.error.message || 'Could not resend email verification')
      setMessage('Verification email sent.')
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
              <button type="button" className="btn" onClick={resendEmail} disabled={!email || busy}>Resend email</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="container pageStack">
        <div className="card pageCardShell">
          <PageHero
            eyebrow="Verify your contact info"
            title="Finish setup with email"
            subtitle="Your email verification is required before signing in."
          />

          <div className="card" style={{ background: 'rgba(255,255,255,.72)' }}>
            <h3 style={{ marginTop: 0 }}>Email verification</h3>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <button type="button" className="btn btnPrimary" disabled={busy || !email} onClick={resendEmail}>Resend email</button>
              <Link className="btn" to="/login">Go to login</Link>
            </div>
          </div>

          {message ? <div className="small" style={{ color: '#166534', marginTop: 16 }}>{message}</div> : null}
          {error ? <div className="small" style={{ color: '#b91c1c', marginTop: 16 }}>{error}</div> : null}
        </div>
      </div>
    </>
  )
}
