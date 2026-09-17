import { useEffect, useMemo, useRef, useState } from 'react'
import type { Tournament, TournamentMessageThread, TournamentMessagesResponse } from '../lib/accounts'
import {
  fetchHostTournamentMessages,
  fetchOrganizerTournamentMessages,
  markHostTournamentMessageThreadRead,
  markHostTournamentMessagesRead,
  markOrganizerTournamentMessageThreadRead,
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
  autoOpenMessages?: boolean
  autoOpenThreadId?: string | null
  autoOpenMessageId?: string | null
  onUnreadCountChange?: (unreadCount: number) => void
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

function timestampMs(value?: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

function formatTimestamp(value?: string | null) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatMessageDate(value?: string | null) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function threadAttendees(thread: TournamentMessageThread) {
  const attendees = thread.recipients.map((recipient) => recipient.name || recipient.email).filter(Boolean)
  return attendees.length ? attendees.join(', ') : 'No attendees listed'
}

function NotificationBellIcon() {
  return (
    <svg className="tournamentMessagesBellIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  )
}

export default function TournamentMessagingPanel({ tournament, actor, autoOpenMessages = false, autoOpenThreadId = null, autoOpenMessageId = null, onUnreadCountChange }: Props) {
  const recipients = useMemo(() => registeredRecipients(tournament), [tournament])
  const [selectedEmails, setSelectedEmails] = useState<string[]>([])
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null)
  const [markingReadThreadId, setMarkingReadThreadId] = useState<string | null>(null)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const messagesModalRef = useRef<HTMLElement | null>(null)
  const [history, setHistory] = useState<TournamentMessagesResponse | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [replyBodyByThread, setReplyBodyByThread] = useState<Record<string, string>>({})
  const [replyingThreadId, setReplyingThreadId] = useState<string | null>(null)
  const autoOpenHandledRef = useRef(false)

  const selectedSet = useMemo(() => new Set(selectedEmails), [selectedEmails])
  const allSelected = recipients.length > 0 && selectedEmails.length === recipients.length
  const sortedThreads = useMemo(
    () => [...(history?.threads || [])].sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt) || String(b.id).localeCompare(String(a.id))),
    [history?.threads],
  )

  async function loadHistory(options: { quiet?: boolean } = {}) {
    if (!options.quiet) setHistoryLoading(true)
    try {
      const result = actor === 'host'
        ? await fetchHostTournamentMessages(tournament.id)
        : await fetchOrganizerTournamentMessages(tournament.id)
      setHistory(result)
      onUnreadCountChange?.(Number(result.unreadCount || 0))
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
    const intervalId = window.setInterval(() => { void loadHistory({ quiet: true }) }, 30000)
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshOnFocus)
    }
    // tournament/actor changes create a new panel identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament.id, actor])

  useEffect(() => {
    autoOpenHandledRef.current = false
    setExpandedThreadId(null)
  }, [tournament.id, autoOpenThreadId, autoOpenMessageId])

  useEffect(() => {
    if (!autoOpenMessages || autoOpenHandledRef.current) return
    autoOpenHandledRef.current = true
    void openMessages(autoOpenThreadId, autoOpenMessageId)
    // The auto-open request is intentionally one-shot for the selected tournament/thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenMessages, autoOpenThreadId, autoOpenMessageId, tournament.id])

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

  async function openMessages(targetThreadId: string | null = null, targetMessageId: string | null = null) {
    setComposeOpen(true)
    setMessagesOpen(true)
    setExpandedThreadId(null)
    setError(null)
    const result = await loadHistory()
    if (!result) return
    const targetThread = targetThreadId ? result.threads.find((thread) => thread.id === targetThreadId) : null
    if (targetThread) {
      setExpandedThreadId(targetThread.id)
      // A top-level unread-message selection already marks only that individual message read.
      // Do not convert that action into a thread-wide mark-read when the modal opens.
      if (!targetMessageId && Number(targetThread.unreadCount || 0) > 0) await markThreadRead(targetThread, Number(result.unreadCount || 0))
    }
    logFrontendEvent({ category: `${actor}.portal.tournamentMessages`, message: 'tournament_messages_opened', data: { tournamentId: tournament.id, threadCount: result.totalThreads, unreadCount: result.unreadCount, targetThreadId: targetThreadId || null, targetMessageId: targetMessageId || null, composeExpanded: true, individualUnreadSelection: Boolean(targetMessageId) } })
  }

  async function markThreadRead(thread: TournamentMessageThread, currentUnreadOverride?: number) {
    const unreadToClear = Math.max(0, Number(thread.unreadCount || 0))
    if (!unreadToClear || markingReadThreadId === thread.id) return
    setMarkingReadThreadId(thread.id)
    try {
      const state = actor === 'host'
        ? await markHostTournamentMessageThreadRead(tournament.id, thread.id)
        : await markOrganizerTournamentMessageThreadRead(tournament.id, thread.id)
      const currentUnread = Math.max(0, Number(currentUnreadOverride ?? history?.unreadCount ?? unreadToClear))
      const nextUnread = Math.max(0, currentUnread - unreadToClear)
      setHistory((current) => current ? {
        ...current,
        unreadCount: Math.max(0, Number(current.unreadCount || 0) - unreadToClear),
        threads: current.threads.map((item) => item.id === thread.id ? { ...item, unreadCount: 0, lastReadAt: state.lastReadAt || new Date().toISOString() } : item),
      } : current)
      onUnreadCountChange?.(nextUnread)
      logFrontendEvent({ category: `${actor}.portal.tournamentMessages`, message: 'tournament_message_thread_marked_read', data: { tournamentId: tournament.id, threadId: thread.id, unreadCleared: unreadToClear, remainingUnread: nextUnread } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update this message notification.'
      setError(message)
      logFrontendEvent({ category: `${actor}.portal.tournamentMessages`, level: 'error', message: 'tournament_message_thread_mark_read_failed', data: { tournamentId: tournament.id, threadId: thread.id, error: message } })
    } finally {
      setMarkingReadThreadId(null)
    }
  }

  async function toggleThread(thread: TournamentMessageThread) {
    const opening = expandedThreadId !== thread.id
    setExpandedThreadId(opening ? thread.id : null)
    logFrontendEvent({ category: `${actor}.portal.tournamentMessages`, message: opening ? 'tournament_message_thread_expanded' : 'tournament_message_thread_collapsed', data: { tournamentId: tournament.id, threadId: thread.id, unreadCount: Number(thread.unreadCount || 0) } })
    if (opening && Number(thread.unreadCount || 0) > 0) await markThreadRead(thread)
  }

  async function markAllMessagesRead() {
    if (!history || Number(history.unreadCount || 0) <= 0 || markingAllRead) return
    setMarkingAllRead(true)
    setError(null)
    try {
      const state = actor === 'host'
        ? await markHostTournamentMessagesRead(tournament.id)
        : await markOrganizerTournamentMessagesRead(tournament.id)
      setHistory((current) => current ? {
        ...current,
        unreadCount: 0,
        lastReadAt: state.lastReadAt || new Date().toISOString(),
        threads: current.threads.map((thread) => ({ ...thread, unreadCount: 0, lastReadAt: state.lastReadAt || new Date().toISOString() })),
      } : current)
      onUnreadCountChange?.(0)
      logFrontendEvent({ category: `${actor}.portal.tournamentMessages`, message: 'tournament_messages_marked_all_read', data: { tournamentId: tournament.id } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not mark tournament messages read.'
      setError(message)
      logFrontendEvent({ category: `${actor}.portal.tournamentMessages`, level: 'error', message: 'tournament_messages_mark_all_read_failed', data: { tournamentId: tournament.id, error: message } })
    } finally {
      setMarkingAllRead(false)
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
              </div>
              <div className="tournamentMessagesModalHeaderActions">
                {(history?.unreadCount || 0) > 0 ? <button type="button" className="button secondary small" disabled={markingAllRead} onClick={() => void markAllMessagesRead()}>{markingAllRead ? 'Updating…' : 'Mark all read'}</button> : null}
                <button type="button" className="button secondary small" onClick={() => setMessagesOpen(false)}>Close</button>
              </div>
            </div>

            {error ? <div className="alert error" role="alert">{error}</div> : null}
            {historyLoading ? <p>Loading tournament messages…</p> : null}
            {!historyLoading && sortedThreads.length === 0 ? <p className="emptyState">No tournament messages have been sent yet.</p> : null}

            <div className="tournamentMessageThreadList">
              {sortedThreads.map((thread) => {
                const expanded = expandedThreadId === thread.id
                const unreadCount = Math.max(0, Number(thread.unreadCount || 0))
                const attendees = threadAttendees(thread)
                return (
                  <article className={`tournamentMessageThread${unreadCount > 0 ? ' tournamentMessageThread--unread' : ''}`} key={thread.id}>
                    <button
                      type="button"
                      className="tournamentMessageThreadSummary"
                      aria-expanded={expanded}
                      aria-controls={`tournament-message-thread-${thread.id}`}
                      onClick={() => void toggleThread(thread)}
                    >
                      <span className="tournamentMessageThreadSummaryDate">{formatMessageDate(thread.createdAt)}</span>
                      <span className="tournamentMessageThreadSummaryAttendees">{attendees}</span>
                      {!expanded && unreadCount > 0 ? (
                        <span className="tournamentMessageThreadUnread" aria-label={`${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`}>
                          <NotificationBellIcon />
                          <span>{unreadCount > 99 ? '99+' : unreadCount}</span>
                        </span>
                      ) : null}
                      <span className="tournamentMessageThreadSummaryChevron" aria-hidden="true">⌄</span>
                    </button>

                    {expanded ? (
                      <div id={`tournament-message-thread-${thread.id}`} className="tournamentMessageThreadContent">
                        <div className="tournamentMessageThreadHeader">
                          <div>
                            <strong>Sent to {thread.recipients.length} golfer{thread.recipients.length === 1 ? '' : 's'}</strong>
                            <span>{attendees}</span>
                          </div>
                          <span>{formatTimestamp(thread.createdAt)}</span>
                        </div>

                        <div className="tournamentMessageDialogue">
                          {thread.messages.map((message) => (
                            <div className={`tournamentMessageDialogueEntry tournamentMessageDialogueEntry--${String(message.senderRole || 'user').toLowerCase()}${autoOpenMessageId === message.id ? ' tournamentMessageDialogueEntry--selectedUnread' : ''}`} key={message.id}>
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
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
