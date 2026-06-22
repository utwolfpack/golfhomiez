import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { sendHomieInvite } from '../lib/teams'
import { logFrontendEvent } from '../lib/frontend-logger'

export default function InviteHomie() {
  const [params] = useSearchParams()
  const location = useLocation()
  const startingEmail = useMemo(() => params.get('email') || '', [params])
  const reason = params.get('reason') || ''
  const routeNotice = typeof location.state === 'object' && location.state && 'notice' in location.state ? String((location.state as { notice?: string }).notice || '') : ''

  const [email, setEmail] = useState(startingEmail)
  const [message, setMessage] = useState('Would love to have you join Golf Homiez so we can keep our rounds, teams, and score history together.')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setEmail(startingEmail)
  }, [startingEmail])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setStatus(null)
    setError(null)
    const trimmedEmail = email.trim().toLowerCase()

    try {
      logFrontendEvent({ category: 'invite_homie.page', message: 'invite_homie_send_started', data: { email: trimmedEmail, reason } })
      await sendHomieInvite(trimmedEmail, message.trim())
      setStatus(`Registration invite sent to ${trimmedEmail}.`)
      logFrontendEvent({ category: 'invite_homie.page', message: 'invite_homie_send_succeeded', data: { email: trimmedEmail, reason } })
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Could not send invite.'
      setError(messageText)
      logFrontendEvent({ category: 'invite_homie.page', level: 'error', message: 'invite_homie_send_failed', data: { email: trimmedEmail, reason, error: messageText } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container pageStack inviteHomiePage">
      <PageHero
        title="Invite Homie"
        actions={
          <Link
            className="btn btnLightGreen btnSmall"
            to="/profile"
            onClick={() => logFrontendEvent({ category: 'invite_homie.navigation', message: 'return_to_profile_clicked', data: { reason } })}
          >
            Return to Profile
          </Link>
        }
      />

      <section className="card pageCardShell">
        {routeNotice || reason === 'recipient-not-found' ? (
          <div className="inboxStatus inboxStatus--error">{routeNotice || 'Recipient does not exist in Golf Homiez. Send them an invite to join.'}</div>
        ) : null}

        <form className="formStack" onSubmit={handleSubmit}>
          <div>
            <label className="label" htmlFor="inviteHomieEmail">Invitee email</label>
            <input
              id="inviteHomieEmail"
              className="input"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="golfer@example.com"
            />
          </div>

          <div>
            <label className="label" htmlFor="inviteHomieMessage">Custom message</label>
            <textarea
              id="inviteHomieMessage"
              className="input"
              rows={5}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Add a note"
            />
          </div>

          {status ? <div className="inboxStatus inboxStatus--success">{status}</div> : null}
          {error ? <div className="inboxStatus inboxStatus--error">{error}</div> : null}

          <div className="pageHeroActions">
            <button className="btn btnPrimary" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send Invite'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}
