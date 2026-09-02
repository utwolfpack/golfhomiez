import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { cancelSubscription, completeCheckout, fetchBillingStatus, openBillingPortal, redeemAccessCode, resumeSubscription, startCheckout, type BillingStatus } from '../lib/billing'
import { useAuth } from '../context/AuthContext'
import { logFrontendEvent } from '../lib/frontend-logger'

function displayDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : 'Not available'
}

function accessDescription(status: BillingStatus) {
  if (status.accessSource === 'code_free') return `Active — Homie Token ${status.accessCode || 'applied'}`
  if (status.accessSource === 'legacy_free') return 'Active — Founding golfer access'
  if (status.accessSource === 'complimentary_host') return 'Active — Golf course host access'
  if (status.accessSource === 'complimentary_organizer') return 'Active — Tournament organizer access'
  if (!status.accessAllowed) return 'Payment or Homie Token required'
  return `Active — ${status.accessSource.replaceAll('_', ' ')}`
}

function cardBrand(value?: string | null) {
  const brand = String(value || 'Card').trim()
  return brand.charAt(0).toUpperCase() + brand.slice(1)
}

export default function Billing() {
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const { user, loading, refreshBillingStatus } = useAuth()

  useEffect(() => {
    let active = true
    const sessionId = new URLSearchParams(window.location.search).get('session_id')
    const request = sessionId ? completeCheckout(sessionId) : fetchBillingStatus()
    request
      .then((result) => { if (active) setStatus(result); logFrontendEvent({ category: 'billing', message: 'payment_information_loaded', data: { accessSource: result.accessSource, setupComplete: result.setupComplete } }) })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : 'Payment information could not be loaded.') })
    return () => { active = false }
  }, [])

  async function redirect(action: () => Promise<{ url: string }>) {
    setBusy(true); setMessage('')
    try {
      logFrontendEvent({ category: 'billing', message: 'payment_redirect_started' })
      const result = await action(); window.location.assign(result.url)
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Payment setup could not be opened.'); setBusy(false) }
  }

  async function redeem() {
    setBusy(true); setMessage('')
    try {
      const result = await redeemAccessCode(code)
      setStatus(result); setCode(''); setMessage('Your Homie Token was applied. Your Golf Homiez access is active.'); await refreshBillingStatus()
      logFrontendEvent({ category: 'billing', message: 'homie_token_applied', data: { accessSource: result.accessSource } })
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Code could not be redeemed.') }
    finally { setBusy(false) }
  }

  async function changeCancellation(cancel: boolean) {
    setBusy(true); setMessage('')
    try { setStatus(await (cancel ? cancelSubscription() : resumeSubscription())); await refreshBillingStatus() }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Subscription could not be updated.') }
    finally { setBusy(false) }
  }

  if (!loading && !user) return <Navigate to="/login" replace />
  if (!status) return <div className="container"><div className="card">Loading payment information…</div></div>
  if (!status.enabled) return <div className="container"><div className="card"><h1>Payment Information</h1><p>Billing is disabled in this environment.</p><Link className="btn btnPrimary" to="/profile">Back to profile</Link></div></div>

  const permanentlyFree = ['legacy_free', 'code_free', 'complimentary_host', 'complimentary_organizer'].includes(status.accessSource)
  return <div className="container pageStack billingPage"><section className="card pageCardShell">
    <div className="billingHeading"><div><span className="pageHeroEyebrow">Account setup</span><h1>Payment Information</h1></div><span className={`billingSetupBadge ${status.setupComplete ? 'isComplete' : ''}`}>{status.setupComplete ? 'Setup complete' : 'Action needed'}</span></div>
    <p className="billingIntro">Golf Homiez is only $0.99 per month. We appreciate you being a part of the Golf Homiez Community!</p>
    {!status.setupComplete ? <div className="onboardingNotice" role="note"><strong>One last step</strong><span>Add a payment method or enter a Homie Token below. You’ll stay on this page until one of those options is complete.</span></div> : null}
    <div className="billingSummary">
      <div><span>Access</span><strong>{accessDescription(status)}</strong>{status.accessCodeLabel ? <small>{status.accessCodeLabel}</small> : null}</div>
      {status.trialEndsAt ? <div><span>Free period ends</span><strong>{displayDate(status.trialEndsAt)}</strong></div> : null}
      {status.currentPeriodEndsAt ? <div><span>Current period ends</span><strong>{displayDate(status.currentPeriodEndsAt)}</strong></div> : null}
      {status.graceEndsAt ? <div><span>Payment grace period ends</span><strong>{displayDate(status.graceEndsAt)}</strong></div> : null}
    </div>
    {status.paymentMethod ? <section className="paymentMethodCard" aria-label="Payment method">
      <div className="paymentMethodIcon" aria-hidden="true">••••</div>
      <div><span className="small">Payment method</span><strong>{cardBrand(status.paymentMethod.brand)} ending in {status.paymentMethod.lastFour}</strong><span>Expires {String(status.paymentMethod.expMonth || '').padStart(2, '0')}/{status.paymentMethod.expYear || '—'}</span></div>
    </section> : null}
    {message ? <p role="status" className="statusNotice">{message}</p> : null}
    {!permanentlyFree ? <div className="billingActions">
      <button type="button" className="btn btnPrimary" disabled={busy} onClick={() => void redirect(startCheckout)}>{status.paymentMethod ? 'Reactivate subscription' : 'Add payment method'}</button>
      {status.hasPaymentAccount ? <button type="button" className="btn" disabled={busy} onClick={() => void redirect(openBillingPortal)}>Manage payment method</button> : null}
      {status.subscriptionStatus === 'active' && !status.cancelAtPeriodEnd ? <button type="button" className="btn" disabled={busy} onClick={() => void changeCancellation(true)}>Cancel at period end</button> : null}
      {status.cancelAtPeriodEnd ? <button type="button" className="btn btnPrimary" disabled={busy} onClick={() => void changeCancellation(false)}>Undo cancellation</button> : null}
    </div> : null}
    {!permanentlyFree ? <div className="promoCodePanel"><div><label className="label" htmlFor="billing-code">Homie Token</label><p className="small">Enter the friendly Homie Token provided by Golf Homiez.</p></div><div className="promoCodeControls"><input className="input" id="billing-code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" /><button type="button" className="btn btnPrimary" disabled={busy || code.trim().length < 1} onClick={() => void redeem()}>Apply Homie Token</button></div></div> : null}
    <p className="billingTerms small">Failed payments receive a 60-day access grace period. Cancelling stops renewal at the end of the current paid period and is available 14 days after account creation.</p>
    <Link className="btn billingBackButton" to="/profile">Back to profile</Link>
  </section></div>
}
