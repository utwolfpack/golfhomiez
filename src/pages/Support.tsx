import { FormEvent, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { useAuth } from '../context/AuthContext'
import { useHostAuth } from '../context/HostAuthContext'
import { useOrganizerAuth } from '../context/OrganizerAuthContext'
import { logFrontendEvent } from '../lib/frontend-logger'
import { sendSupportMessage } from '../lib/support'

const MAX_SUBJECT_LENGTH = 160
const MAX_MESSAGE_LENGTH = 5000

type SupportAccountContext = {
  accountType: 'golf_user' | 'host' | 'organizer'
  accountLabel: string
  accountId: string | null
  email: string
}


function getSupportHomePath(accountType: SupportAccountContext['accountType'] | null | undefined) {
  if (accountType === 'host') return '/host/portal'
  if (accountType === 'organizer') return '/organizer/portal'
  return '/'
}

export default function Support() {
  const { user } = useAuth()
  const { hostAccount } = useHostAuth()
  const { organizerAccount } = useOrganizerAuth()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const accountContext = useMemo<SupportAccountContext | null>(() => {
    if (hostAccount) {
      return {
        accountType: 'host',
        accountLabel: 'Host account',
        accountId: hostAccount.id,
        email: hostAccount.email,
      }
    }
    if (organizerAccount) {
      return {
        accountType: 'organizer',
        accountLabel: 'Organizer account',
        accountId: organizerAccount.id,
        email: organizerAccount.email,
      }
    }
    if (user) {
      return {
        accountType: 'golf_user',
        accountLabel: 'Golf user account',
        accountId: user.id,
        email: user.email,
      }
    }
    return null
  }, [hostAccount, organizerAccount, user])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmedSubject = subject.trim()
    const trimmedMessage = message.trim()
    setError(null)

    if (!trimmedSubject) {
      setError('Subject is required.')
      logFrontendEvent({ category: 'support', level: 'warn', message: 'support_message_validation_failed', data: { reason: 'missing_subject', accountType: accountContext?.accountType || null } })
      return
    }
    if (!trimmedMessage) {
      setError('Support message is required.')
      logFrontendEvent({ category: 'support', level: 'warn', message: 'support_message_validation_failed', data: { reason: 'missing_message', accountType: accountContext?.accountType || null } })
      return
    }

    setSubmitting(true)
    try {
      logFrontendEvent({ category: 'support', message: 'support_message_submit_started', data: { accountType: accountContext?.accountType || null, accountId: accountContext?.accountId || null, subjectLength: trimmedSubject.length, messageLength: trimmedMessage.length } })
      await sendSupportMessage({ subject: trimmedSubject, message: trimmedMessage })
      setSubject('')
      setMessage('')
      const redirectPath = getSupportHomePath(accountContext?.accountType)
      logFrontendEvent({ category: 'support', message: 'support_message_submit_succeeded', data: { accountType: accountContext?.accountType || null, accountId: accountContext?.accountId || null, redirectPath } })
      navigate(redirectPath, { replace: true })
    } catch (err) {
      const failureMessage = err instanceof Error ? err.message : 'Could not send your support message.'
      setError(failureMessage)
      logFrontendEvent({ category: 'support', level: 'error', message: 'support_message_submit_failed', data: { accountType: accountContext?.accountType || null, accountId: accountContext?.accountId || null, error: failureMessage } })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container pageStack">
      <div className="card pageCardShell">
        <PageHero
          eyebrow="GolfHomiez support"
          title="Contact support"
        />
        <form onSubmit={onSubmit} className="formStack" style={{ maxWidth: 760 }}>
          <div>
            <label className="label">Subject</label>
            <input
              className="input"
              value={subject}
              maxLength={MAX_SUBJECT_LENGTH}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Briefly describe the issue"
              required
            />
          </div>
          <div>
            <label className="label">Support message</label>
            <textarea
              className="input"
              rows={8}
              value={message}
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Include what you were trying to do, what happened, and any details support should review."
              required
            />
          </div>
          {error ? <div className="small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btnPrimary" disabled={submitting}>{submitting ? 'Sending…' : 'Send support message'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
