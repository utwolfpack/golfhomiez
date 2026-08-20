import { useEffect, useMemo, useRef, useState } from 'react'
import type { Tournament, TournamentMessageThread, TournamentMessagesResponse } from '../lib/accounts'
import {
  fetchHostTournamentMessages,
  fetchOrganizerTournamentMessages,
  markHostTournamentMessagesRead,
  markOrganizerTournamentMessagesRead,
  replyHostTournamentMessage,
  replyOrganizerTournamentMessage,
  sendHostTournamentMessage,
  sendOrganizerTournamentMessage,
} from '../lib/accounts'
import { logFrontendEvent } from '../lib/frontend-logger'

type Props = {
  tournament: Tournament
  actor: 'host' | 'organizer'
}

type Recipient = { email: string; name: string }

function registeredRecipients(tournament: Tournament): Recipient[] {
  const byEmail = new Map<string, Recipient>()
  for (const registration of tournament.registrations || []) {
    const registrationEmail = String(registration.email || '').trim().toLowerCase()
    if (registrationEmail) byEmail.set(registrationEmail, { email: registrationEmail, name: registration.name || registrationEmail })
    for (const member of registration.teamMembers || []) {
      const email = String(member.email || '').trim().toLowerCase()
      if (email && member.registered) byEmail.set(email, { email, name: member.name || email })
    }
  }
  return [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function formatTimestamp(value?: string | null) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function NotificationBellIcon() {
  return (
    <svg className="tournamentMessagesBellIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  )
}

export default function TournamentMessagingPanel({ tournament, actor }: Props) {
  const recipients = useMemo(() => registeredRecipients(tournament), [tournament])
  const [selectedEmails, setSelectedEmails] = useState<string[]>([])
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const messagesModalRef = useRef<HTMLElement | null>(null)
  const [history, setHistory] = useState<TournamentMessagesResponse | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [replyBodyByThread, setReplyBodyByThread] = useState<Record<string, string>>({})
  const [replyingThreadId, setReplyingThreadId] = useState<string | null>(null)

  const selectedSet = useMemo(() => new Set(selectedEmails), [selectedEmails])
  const allSelected = recipients.length > 0 && selectedEmails.length === recipients.length

  async function loadHistory(options: { quiet?: boolean } = {}) {
    if (!options.quiet) setHistoryLoading(true)
    try {
      const result = actor === 'host'
        ? await fetchHostTournamentMessages(tournament.id)
        : await fetchOrganizerTournamentMessages(tournament.id)
      setHistory(result)
      logFrontendEvent({ category: `${actor}.portal.tournamentMessages`, message: 'tournament_message_history_loaded', data: { tournamentId: tournament.id, threadCount: result.totalThreads, unreadCount: result.unreadCount } })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load tournament messages.'
      if (!options.quiet) setError(message)
      logFrontendEvent({ category: `${actor}.portal.tournamentMessages`, level: 'error', message: 'tournament_message_history_load_failed', data: { tournamentId: tournament.id, error: message } })
      return null
    } finally {
      if (!options.quiet) setHistoryLoading(false)
    }
  }

  useEffect(() => {
    void loadHistory({ quiet: true })
    const refreshOnFocus = () => { void loadHistory({ quiet: true }) }
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
    // tournament/actor changes create a new panel identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament.id, actor])

  useEffect(() => {
    if (!messagesOpen) return
    const frameId = window.requestAnimationFrame(() => {
      if (!messagesModalRef.current) return
      messagesModalRef.current.scrollTop = 0
      messagesModalRef.current.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [messagesOpen])

  function toggleCompose() {
    const nextOpen = !composeOpen
    setComposeOpen(nextOpen)
    setError(null)
    logFrontendEvent({ category: `${actor}.portal.tournamentMessages`, message: nextOpen ? 'tournament_message_compose_opened' : 'tournament_message_compose_closed', data: { tournamentId: tournament.id, registeredGolferCount: recipients.length } })
  }

  function toggleRecipient(email: string) {
    setSelectedEmails((current) => current.includes(email) ? current.filter((item) => item !== email) : [...current, email])
  }

  async function send() {
    const trimmedBody = body.trim()
    if (!trimmedBody) return
    if (selectedEmails.length === 0) {
      setError('Select at least one registered golfer.')
      return
    }
    setSending(true)
    setError(null)
    setStatus(null)
    try {
      const payload = { body: trimmedBody, recipientEmails: selectedEmails }
      const result = actor === 'host'
        ? await sendHostTournamentMessage(tournament.id, payload)
        : await sendOrganizerTournamentMessage(tournament.id, payload)
      setBody('')
      setSelectedEmails([])
      setStatus(`Message sent to ${result.sentCount} registered golfer${result.sentCount === 1 ? '' : 's'}.`)
      logFrontendEvent({ category: `${actor}.portal.tournamentMessages`, message: 'tournament_message_sent', data: { tournamentId: tournament.id, threadId: result.threadId, sentCount: result.sentCount } })
      await loadHistory({ quiet: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send the tournament message.'
      setError(message)
      logFrontendEvent({ category: `${actor}.portal.tournamentMessages`, level: 'error', message: 'tournament_message_send_failed', data: { tournamentId: tournament.id, selectedRecipientCount: selectedEmails.length, error: message } })
    } finally {
      setSending(false)
    }
  }

  async function openMessages() {
    setMessagesOpen(true)
    setError(null)
    const result = await loadHistory()
    if (!result) return
    try {
      if (actor === 'host') await markHostTournamentMessagesRead(tournament.id)
      else await markOrganizerTournamentMessagesRead(tournament.id)
      setHistory((current) => current ? { ...current, unreadCount: 0, lastReadAt: new Date().toISOString() } : current)
      logFrontendEvent({ category: `${actor}.portal.tournamentMessages`, message: 'tournament_messages_opened', data: { tournamentId: tournament.id, threadCount: result.totalThreads, unreadCount: result.unreadCount } })
    } catch (err) {
      logFrontendEvent({ category: `${actor}.portal.tournamentMessages`, level: 'error', message: 'tournament_messages_mark_read_failed', data: { tournamentId: tournament.id, error: err instanceof Error ? err.message : String(err) } })
    }
  }

  async function sendReply(thread: TournamentMessageThread) {
    const replyBody = String(replyBodyByThread[thread.id] || '').trim()
    if (!replyBody) return
    setReplyingThreadId(thread.id)
    setError(null)
    try {
      if (actor === 'host') await replyHostTournamentMessage(tournament.id, thread.id, replyBody)
      else await replyOrganizerTournamentMessage(tournament.id, thread.id, replyBody)
      setReplyBodyByThread((current) => ({ ...current, [thread.id]: '' }))
      await loadHistory({ quiet: true })
      logFrontendEvent({ category: `${actor}.portal.tournamentMessages`, message: 'tournament_message_reply_sent', data: { tournamentId: tournament.id, threadId: thread.id, recipientCount: thread.recipients.length } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send the tournament reply.'
      setError(message)
      logFrontendEvent({ category: `${actor}.portal.tournamentMessages`, level: 'error', message: 'tournament_message_reply_failed', data: { tournamentId: tournament.id, threadId: thread.id, error: message } })
    } finally {
      setReplyingThreadId(null)
    }
  }

  return (
    <>
      <div className="card tournamentMessagingPanel">
        <div className="tournamentMessagingHeader">
          <div>
            <button
              type="button"
              className="tournamentSectionToggleLink"
              aria-expanded={composeOpen}
              aria-controls={`tournament-message-compose-${tournament.id}`}
              onClick={toggleCompose}
            >
              Send a message
            </button>
          </div>
          <div className="tournamentMessagingHeaderMeta">
            <button type="button" className="tournamentMessagesLink" onClick={() => void openMessages()}>
              <span>Tournament messages</span>
              {(history?.unreadCount || 0) > 0 ? (
                <span className="tournamentMessagesNotification" aria-label={`${history?.unreadCount || 0} new tournament messages`}>
                  <NotificationBellIcon />
                  <span>{(history?.unreadCount || 0) > 99 ? '99+' : history?.unreadCount}</span>
                </span>
              ) : null}
            </button>
            <span className="small">{recipients.length} registered golfer{recipients.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        {status ? <div className="alert success" role="status">{status}</div> : null}

        {composeOpen ? (
          <div id={`tournament-message-compose-${tournament.id}`} className="tournamentMessagingCompose">
            <div className="small">Select the registered golfers who should receive this tournament message.</div>
            {error && !messagesOpen ? <div className="alert error" role="alert">{error}</div> : null}
            {recipients.length === 0 ? <div className="small">No registered golfers are available to message yet.</div> : (
              <>
                <div className="tournamentMessagingRecipientTools">
                  <button type="button" className="button secondary small" onClick={() => setSelectedEmails(allSelected ? [] : recipients.map((recipient) => recipient.email))}>{allSelected ? 'Clear selection' : 'Select all'}</button>
                  <span className="small">{selectedEmails.length} selected</span>
                </div>
                <div className="tournamentMessagingRecipients" role="group" aria-label="Registered golfers to message">
                  {recipients.map((recipient) => (
                    <label key={recipient.email} className="tournamentMessagingRecipient">
                      <input type="checkbox" checked={selectedSet.has(recipient.email)} onChange={() => toggleRecipient(recipient.email)} />
                      <span><strong>{recipient.name}</strong><small>{recipient.email}</small></span>
                    </label>
                  ))}
                </div>
                <label className="tournamentMessagingBody">
                  Message
                  <textarea rows={3} maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Tournament message for selected golfers" />
                </label>
                <div className="tournamentMessagingActions tournamentMessagingActionsSingle">
                  <button type="button" className="button primary tournamentMessageSendButton" disabled={sending || !body.trim() || selectedEmails.length === 0} onClick={() => void send()}>{sending ? 'Sending…' : 'Send a message'}</button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      {messagesOpen ? (
        <div className="modalOverlay tournamentMessagesModalOverlay" role="presentation" onClick={() => setMessagesOpen(false)}>
          <section ref={messagesModalRef} tabIndex={-1} className="modalCard tournamentMessagesModal" role="dialog" aria-modal="true" aria-labelledby={`tournament-messages-title-${tournament.id}`} onClick={(event) => event.stopPropagation()}>
            <div className="tournamentMessagesModalHeader">
              <div>
                <h2 id={`tournament-messages-title-${tournament.id}`}>Tournament messages</h2>
                <p>{tournament.name}</p>
              </div>
              <button type="button" className="button secondary small" onClick={() => setMessagesOpen(false)}>Close</button>
            </div>

            {error ? <div className="alert error" role="alert">{error}</div> : null}
            {historyLoading ? <p>Loading tournament messages…</p> : null}
            {!historyLoading && (history?.threads.length || 0) === 0 ? <p className="emptyState">No tournament messages have been sent yet.</p> : null}

            <div className="tournamentMessageThreadList">
              {(history?.threads || []).map((thread) => (
                <article className="tournamentMessageThread" key={thread.id}>
                  <div className="tournamentMessageThreadHeader">
                    <div>
                      <strong>Sent to {thread.recipients.length} golfer{thread.recipients.length === 1 ? '' : 's'}</strong>
                      <span>{thread.recipients.map((recipient) => recipient.name || recipient.email).join(', ')}</span>
                    </div>
                    <span>{formatTimestamp(thread.createdAt)}</span>
                  </div>

                  <div className="tournamentMessageDialogue">
                    {thread.messages.map((message) => (
                      <div className={`tournamentMessageDialogueEntry tournamentMessageDialogueEntry--${String(message.senderRole || 'user').toLowerCase()}`} key={message.id}>
                        <div className="tournamentMessageDialogueMeta">
                          <strong>{message.senderName || message.senderEmail || (message.senderRole === 'user' ? 'Registered golfer' : 'Tournament staff')}</strong>
                          <span>{formatTimestamp(message.createdAt)}</span>
                        </div>
                        <p>{message.body}</p>
                      </div>
                    ))}
                  </div>

                  <div className="tournamentMessageReplyBox">
                    <textarea
                      rows={2}
                      maxLength={2000}
                      aria-label={`Reply to tournament message sent ${formatTimestamp(thread.createdAt)}`}
                      placeholder="Reply to everyone included in this message"
                      value={replyBodyByThread[thread.id] || ''}
                      onChange={(event) => setReplyBodyByThread((current) => ({ ...current, [thread.id]: event.target.value }))}
                    />
                    <button type="button" className="button primary small tournamentMessageReplyButton" disabled={replyingThreadId === thread.id || !String(replyBodyByThread[thread.id] || '').trim()} onClick={() => void sendReply(thread)}>{replyingThreadId === thread.id ? 'Sending…' : 'Reply'}</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
