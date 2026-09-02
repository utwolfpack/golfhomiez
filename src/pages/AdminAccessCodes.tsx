import { useEffect, useState } from 'react'
import { createBillingAccessCode, fetchBillingAccessCodes, updateBillingAccessCode, type BillingAccessCode } from '../lib/admin'
import { logFrontendEvent } from '../lib/frontend-logger'

export default function AdminAccessCodes() {
  const [codes, setCodes] = useState<BillingAccessCode[]>([])
  const [homieToken, setHomieToken] = useState('')
  const [label, setLabel] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => {
    fetchBillingAccessCodes()
      .then((result) => { setCodes(result.codes); logFrontendEvent({ category: 'admin.billing', message: 'access_codes_loaded', data: { count: result.codes.length } }) })
      .catch((error) => setMessage(error.message))
  }, [])

  async function create() {
    setMessage('')
    try {
      const result = await createBillingAccessCode({ homieToken, label, maxRedemptions: maxUses ? Number(maxUses) : null, expiresAt: expiresAt || null })
      setCodes(result.codes); setExpandedId(result.created.id); setHomieToken(''); setLabel(''); setMaxUses(''); setExpiresAt('')
      setMessage(`Homie Token ${result.created.homieToken} was created.`)
      logFrontendEvent({ category: 'admin.billing', message: 'access_code_created', data: { accessCodeId: result.created.id } })
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create code.') }
  }

  async function toggle(item: BillingAccessCode) {
    try {
      setCodes((await updateBillingAccessCode(item.id, { active: !item.active })).codes)
      logFrontendEvent({ category: 'admin.billing', message: 'access_code_status_updated', data: { accessCodeId: item.id, active: !item.active } })
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update code.') }
  }

  return <div className="container pageStack"><section className="card pageCardShell"><h1>Homie Tokens</h1>
    <p>Create a friendly Homie Token that grants permanent free access once redeemed. Expiration and deactivation only affect future redemption.</p>
    {message ? <p role="status" className="statusNotice">{message}</p> : null}
    <div className="formGrid"><label>Homie Token<input required minLength={4} maxLength={64} value={homieToken} onChange={(e) => setHomieToken(e.target.value)} placeholder="Example: DAYBREAK-HOMIE" /></label><label>Label<input value={label} onChange={(e) => setLabel(e.target.value)} /></label><label>Maximum uses (blank = unlimited)<input type="number" min="1" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} /></label><label>Expires (optional)<input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></label></div>
    <button type="button" className="btn btnPrimary" disabled={homieToken.trim().length < 4} onClick={() => void create()}>Create Homie Token</button>
    <div className="accessCodeList" aria-label="Generated Homie Tokens">{codes.map((item) => {
      const expanded = expandedId === item.id
      return <article className={`accessCodeItem${expanded ? ' isExpanded' : ''}`} key={item.id}>
        <button type="button" className="accessCodeSummary" aria-expanded={expanded} aria-controls={`access-code-${item.id}`} onClick={() => setExpandedId(expanded ? null : item.id)}>
          <span className="accessCodeChevron" aria-hidden="true">›</span>
          <span><span className="small">Homie Token</span><code>{item.homieToken || item.code}</code></span>
          <span><span className="small">Generated</span><strong>{new Date(item.createdAt).toLocaleString()}</strong></span>
          <span><span className="small">Uses</span><strong>{item.redemptionCount}/{item.maxRedemptions ?? '∞'}</strong></span>
          <span className={`pill ${item.active ? '' : 'accessCodeInactive'}`}>{item.active ? 'Active' : 'Inactive'}</span>
        </button>
        {expanded ? <div id={`access-code-${item.id}`} className="accessCodeDetails">
          <dl className="accessCodeMetadata">
            <div><dt>Label</dt><dd>{item.label || 'No label'}</dd></div>
            <div><dt>Expires</dt><dd>{item.expiresAt ? new Date(item.expiresAt).toLocaleString() : 'Never'}</dd></div>
            <div><dt>Stripe/internal mapping ID</dt><dd>{item.id}</dd></div>
          </dl>
          <div>
            <h2>Redemption activity</h2>
            {item.redemptions.length ? <div className="accessCodeRedemptions">{item.redemptions.map((use) => <div key={use.id} className="accessCodeRedemption">
              <strong>{use.name || use.email || 'Golf Homiez account'}</strong>
              {use.email && use.name ? <span>{use.email}</span> : null}
              <span>Used {new Date(use.redeemedAt).toLocaleString()}</span>
              {use.userId ? <span className="small">Account ID: {use.userId}</span> : null}
            </div>)}</div> : <p className="small">This code has not been used yet.</p>}
          </div>
          <button type="button" className="btn" onClick={() => void toggle(item)}>{item.active ? 'Deactivate Homie Token' : 'Reactivate Homie Token'}</button>
        </div> : null}
      </article>
    })}</div>
  </section></div>
}
