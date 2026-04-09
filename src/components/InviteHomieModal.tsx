import { FormEvent, useEffect, useState } from 'react'

type Props = {
  open: boolean
  defaultEmail?: string
  title?: string
  submitLabel?: string
  onClose: () => void
  onSubmit: (payload: { email: string; message: string }) => Promise<void>
}

export default function InviteHomieModal({
  open,
  defaultEmail = '',
  title = 'Invite Homie',
  submitLabel = 'Send Invite',
  onClose,
  onSubmit,
}: Props) {
  const [email, setEmail] = useState(defaultEmail)
  const [message, setMessage] = useState('Would love to have you join Golf Homiez so we can keep our rounds, teams, and score history together.')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setEmail(defaultEmail)
    setError(null)
    setBusy(false)
  }, [defaultEmail, open])

  if (!open) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ email: email.trim(), message: message.trim() })
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Could not send invite')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modalOverlay" onMouseDown={onClose}>
      <div className="modalCard" onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div className="small">Bring another golfer in</div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{title}</div>
          </div>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>

        <form className="formStack" style={{ marginTop: 14 }} onSubmit={handleSubmit}>
          <div>
            <label className="label">Invitee email</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="golfer@example.com" />
          </div>

          <div>
            <label className="label">Custom message</label>
            <textarea className="input" rows={5} value={message} onChange={e => setMessage(e.target.value)} placeholder="Add a note" />
          </div>

          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={busy || !email.trim()}>{busy ? 'Sending…' : submitLabel}</button>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
