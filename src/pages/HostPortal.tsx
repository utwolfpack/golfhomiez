import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { useHostAuth } from '../context/HostAuthContext'
import { fetchHostPortal } from '../lib/host-auth'

export default function HostPortal() {
  const { hostAccount, logoutHost } = useHostAuth()
  const [portalData, setPortalData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const result = await fetchHostPortal()
        if (!active) return
        if (!result.response.ok) throw new Error((result.data as any)?.message || 'Could not load host portal')
        setPortalData(result.data)
      } catch (err: any) {
        if (active) setError(err?.message || 'Could not load host portal')
      } finally {
        if (active) setBusy(false)
      }
    })()
    return () => { active = false }
  }, [])

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero eyebrow="Golf-course portal" title={hostAccount ? hostAccount.golfCourseName : 'Host portal'} subtitle="This protected host route confirms the golf-course account can sign in directly after invite redemption." />
        {busy ? <div className="small">Loading host portal…</div> : null}
        {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
        {portalData?.account ? (
          <div className="formStack" style={{ maxWidth: 680 }}>
            <div className="card" style={{ padding: 16 }}>
              <div><strong>Golf-course:</strong> {portalData.account.golfCourseName}</div>
              <div><strong>Email:</strong> {portalData.account.email}</div>
              <div><strong>Validated:</strong> {portalData.account.isValidated ? 'Yes' : 'No'}</div>
            </div>
            <div>
              <strong>Invite history</strong>
              <div className="small">Most recent invite records tied to this golf-course account.</div>
              <ul>
                {(portalData.invites || []).map((invite: any) => (
                  <li key={invite.id}>{invite.email} — {invite.golfCourseName || 'Golf-course invite'} — {invite.consumedAt ? 'redeemed' : 'active'}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btnPrimary" onClick={() => void logoutHost()}>Sign out of host portal</button>
          <Link className="btn" to="/host/request-password-reset">Reset host password</Link>
        </div>
      </div>
    </div>
  )
}
