import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { logFrontendEvent } from '../lib/frontend-logger'
import { formatFriendlyDateTime } from '../lib/time-format'
import { fetchSupportTicket, fetchSupportTickets, replyToSupportTicket, sendSupportMessage, type SupportTicket } from '../lib/support'

const MAX_SUBJECT_LENGTH = 160
const MAX_MESSAGE_LENGTH = 5000

type HostSupportSectionProps = {
  accountId?: string | null
  email: string
  golfCourseName?: string | null
}

function ticketDate(ticket: SupportTicket) {
  return formatFriendlyDateTime(ticket.lastMessageAt || ticket.updatedAt || ticket.createdAt || '')
}

function SupportUnreadIcon() {
  return <span className="supportTicketAlertIcon" title="Unread message from GolfHomiez admin" aria-label="Unread message from GolfHomiez admin">!</span>
}

export default function HostSupportSection({ accountId = null, email, golfCourseName = null }: HostSupportSectionProps) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [replyMessage, setReplyMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [replying, setReplying] = useState(false)
  const [ticketsLoading, setTicketsLoading] = useState(false)
  const [ticketLoading, setTicketLoading] = useState(false)
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const openTickets = useMemo(() => tickets.filter((ticket) => ticket.status === 'open'), [tickets])
  const closedTickets = useMemo(() => tickets.filter((ticket) => ticket.status === 'closed'), [tickets])

  async function loadTickets() {
    setTicketsLoading(true)
    setError(null)
    try {
      logFrontendEvent({ category: 'host.portal.support', message: 'host_support_ticket_list_load_started', data: { accountId, email, golfCourseName } })
      const result = await fetchSupportTickets()
      setTickets(result.tickets || [])
      logFrontendEvent({
        category: 'host.portal.support',
        message: 'host_support_ticket_list_loaded',
        data: {
          accountId,
          email,
          golfCourseName,
          ticketCount: result.tickets?.length || 0,
          openTicketCount: (result.tickets || []).filter((ticket) => ticket.status === 'open').length,
          unreadTicketCount: (result.tickets || []).filter((ticket) => ticket.userUnread).length,
        },
      })
    } catch (err) {
      const failureMessage = err instanceof Error ? err.message : 'Could not load support tickets.'
      setError(failureMessage)
      logFrontendEvent({ category: 'host.portal.support', level: 'error', message: 'host_support_ticket_list_load_failed', data: { accountId, error: failureMessage } })
    } finally {
      setTicketsLoading(false)
    }
  }

  useEffect(() => {
    setTickets([])
    setSelectedTicket(null)
    setReplyMessage('')
    void loadTickets()
  }, [accountId])

  async function openTicket(ticket: SupportTicket) {
    setTicketLoading(true)
    setError(null)
    setStatusMessage(null)
    try {
      logFrontendEvent({ category: 'host.portal.support', message: 'host_support_ticket_selected', data: { accountId, ticketId: ticket.id, status: ticket.status, hadUnreadAdminMessage: ticket.userUnread } })
      const result = await fetchSupportTicket(ticket.id)
      setSelectedTicket(result.ticket)
      setTickets((current) => current.map((entry) => entry.id === result.ticket.id ? { ...entry, ...result.ticket, userUnread: false } : entry))
      logFrontendEvent({ category: 'host.portal.support', message: 'host_support_ticket_detail_loaded', data: { accountId, ticketId: ticket.id, status: result.ticket.status, messageCount: result.ticket.messages?.length || 0 } })
    } catch (err) {
      const failureMessage = err instanceof Error ? err.message : 'Could not load this support ticket.'
      setError(failureMessage)
      logFrontendEvent({ category: 'host.portal.support', level: 'error', message: 'host_support_ticket_detail_load_failed', data: { accountId, ticketId: ticket.id, error: failureMessage } })
    } finally {
      setTicketLoading(false)
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmedSubject = subject.trim()
    const trimmedMessage = message.trim()
    setError(null)
    setStatusMessage(null)

    if (!trimmedSubject) {
      setError('Subject is required.')
      logFrontendEvent({ category: 'host.portal.support', level: 'warn', message: 'host_support_ticket_validation_failed', data: { accountId, reason: 'missing_subject' } })
      return
    }
    if (!trimmedMessage) {
      setError('Support message is required.')
      logFrontendEvent({ category: 'host.portal.support', level: 'warn', message: 'host_support_ticket_validation_failed', data: { accountId, reason: 'missing_message' } })
      return
    }

    setSubmitting(true)
    try {
      logFrontendEvent({ category: 'host.portal.support', message: 'host_support_ticket_create_started', data: { accountId, subjectLength: trimmedSubject.length, messageLength: trimmedMessage.length } })
      const result = await sendSupportMessage({ subject: trimmedSubject, message: trimmedMessage })
      setSubject('')
      setMessage('')
      setTickets((current) => [result.ticket, ...current.filter((ticket) => ticket.id !== result.ticket.id)])
      setSelectedTicket(result.ticket)
      setStatusMessage('Support request submitted. GolfHomiez admin can now respond to this ticket.')
      logFrontendEvent({ category: 'host.portal.support', message: 'host_support_ticket_created', data: { accountId, ticketId: result.ticket.id } })
    } catch (err) {
      const failureMessage = err instanceof Error ? err.message : 'Could not send your support message.'
      setError(failureMessage)
      logFrontendEvent({ category: 'host.portal.support', level: 'error', message: 'host_support_ticket_create_failed', data: { accountId, error: failureMessage } })
    } finally {
      setSubmitting(false)
    }
  }

  async function onReply(event: FormEvent) {
    event.preventDefault()
    if (!selectedTicket || selectedTicket.status !== 'open') return
    const trimmedMessage = replyMessage.trim()
    if (!trimmedMessage) {
      setError('Reply message is required.')
      return
    }

    setReplying(true)
    setError(null)
    setStatusMessage(null)
    try {
      logFrontendEvent({ category: 'host.portal.support', message: 'host_support_ticket_reply_started', data: { accountId, ticketId: selectedTicket.id, messageLength: trimmedMessage.length } })
      const result = await replyToSupportTicket(selectedTicket.id, trimmedMessage)
      setSelectedTicket(result.ticket)
      setTickets((current) => current.map((ticket) => ticket.id === result.ticket.id ? { ...ticket, ...result.ticket } : ticket))
      setReplyMessage('')
      setStatusMessage('Your update was added to the support ticket.')
      logFrontendEvent({ category: 'host.portal.support', message: 'host_support_ticket_reply_saved', data: { accountId, ticketId: selectedTicket.id, messageCount: result.ticket.messages?.length || 0 } })
    } catch (err) {
      const failureMessage = err instanceof Error ? err.message : 'Could not add your support update.'
      setError(failureMessage)
      logFrontendEvent({ category: 'host.portal.support', level: 'error', message: 'host_support_ticket_reply_failed', data: { accountId, ticketId: selectedTicket.id, error: failureMessage } })
    } finally {
      setReplying(false)
    }
  }

  return (
    <section className="card hostPortalSupportSection" data-testid="host-support-section" aria-labelledby="host-support-heading">
      <div className="supportSectionHeading hostPortalSupportHeading">
        <div>
          <h2 id="host-support-heading">Support</h2>
          <p className="small">{golfCourseName ? `${golfCourseName} · ` : ''}{email}</p>
          <p className="small">Submit support requests and continue conversations with GolfHomiez admin.</p>
        </div>
        {openTickets.some((ticket) => ticket.userUnread) ? <SupportUnreadIcon /> : null}
      </div>

      {statusMessage ? <p className="statusMessage statusSuccess">{statusMessage}</p> : null}
      {error ? <p className="statusMessage statusError">{error}</p> : null}

      <div className="supportWorkspace">
        <section className="supportTicketSection" aria-labelledby="host-open-support-heading">
          <div className="supportSectionHeading">
            <div>
              <h3 id="host-open-support-heading">Open support requests</h3>
              <p className="small">Select an open request to review the conversation or add more detail.</p>
            </div>
            <span className="pill">{openTickets.length} open</span>
          </div>

          {ticketsLoading ? <div className="small">Loading support requests…</div> : openTickets.length ? (
            <div className="supportTicketLineList">
              {openTickets.map((ticket) => (
                <button
                  key={ticket.id}
                  className={`supportTicketLineItem${selectedTicket?.id === ticket.id ? ' supportTicketLineItem--selected' : ''}`}
                  type="button"
                  onClick={() => void openTicket(ticket)}
                >
                  <span className="supportTicketLineMain">
                    <span className="supportTicketSubject">{ticket.subject}</span>
                    <span className="small">Updated {ticketDate(ticket)} · {ticket.messageCount || 1} message{Number(ticket.messageCount || 1) === 1 ? '' : 's'}</span>
                  </span>
                  <span className="supportTicketLineMeta">
                    {ticket.userUnread ? <SupportUnreadIcon /> : null}
                    <span aria-hidden="true">›</span>
                  </span>
                </button>
              ))}
            </div>
          ) : <div className="small supportEmptyState">No open support requests.</div>}
        </section>

        {selectedTicket ? (
          <section className="card supportTicketDetail" aria-live="polite">
            <div className="supportSectionHeading">
              <div>
                <div className="supportTicketDetailTitleRow">
                  <h3>{selectedTicket.subject}</h3>
                  <span className={`pill ${selectedTicket.status === 'closed' ? 'supportTicketStatusClosed' : 'supportTicketStatusOpen'}`}>{selectedTicket.status}</span>
                </div>
                <p className="small">Opened {ticketDate({ ...selectedTicket, lastMessageAt: selectedTicket.createdAt })}</p>
              </div>
              <button className="btn btnSmall" type="button" onClick={() => setSelectedTicket(null)}>Close view</button>
            </div>

            {ticketLoading ? <div className="small">Loading conversation…</div> : (
              <div className="supportConversation">
                {(selectedTicket.messages || []).map((entry) => (
                  <article key={entry.id} className={`supportMessageBubble supportMessageBubble--${entry.senderType}`}>
                    <div className="supportMessageMeta">
                      <strong>{entry.senderType === 'admin' ? 'GolfHomiez admin' : 'You'}</strong>
                      <span>{formatFriendlyDateTime(entry.createdAt || '')}</span>
                    </div>
                    <div className="supportMessageText">{entry.message}</div>
                  </article>
                ))}
              </div>
            )}

            {selectedTicket.status === 'open' ? (
              <form className="formStack supportReplyForm" onSubmit={onReply}>
                <div>
                  <label className="label" htmlFor="host-support-ticket-reply">Add details or respond to GolfHomiez admin</label>
                  <textarea
                    id="host-support-ticket-reply"
                    className="input"
                    rows={5}
                    value={replyMessage}
                    maxLength={MAX_MESSAGE_LENGTH}
                    onChange={(event) => setReplyMessage(event.target.value)}
                    placeholder="Add any additional details that will help us resolve this request."
                  />
                </div>
                <div><button className="btn btnPrimary" type="submit" disabled={replying}>{replying ? 'Sending…' : 'Send update'}</button></div>
              </form>
            ) : (
              <div className="supportClosedNotice">This ticket is closed and is now read-only. You can continue to review the conversation.</div>
            )}
          </section>
        ) : null}

        <section className="supportTicketSection" aria-labelledby="host-new-support-heading">
          <div className="supportSectionHeading">
            <div>
              <h3 id="host-new-support-heading">Submit a new support request</h3>
              <p className="small">Provide a subject and the details GolfHomiez admin should review.</p>
            </div>
          </div>
          <form onSubmit={onSubmit} className="formStack supportNewTicketForm">
            <div>
              <label className="label" htmlFor="host-support-subject">Subject</label>
              <input
                id="host-support-subject"
                className="input"
                value={subject}
                maxLength={MAX_SUBJECT_LENGTH}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Briefly describe the issue"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="host-support-message">Support message</label>
              <textarea
                id="host-support-message"
                className="input"
                rows={7}
                value={message}
                maxLength={MAX_MESSAGE_LENGTH}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Include what you were trying to do, what happened, and any details support should review."
                required
              />
            </div>
            <div><button className="btn btnPrimary" disabled={submitting}>{submitting ? 'Sending…' : 'Send support message'}</button></div>
          </form>
        </section>

        {closedTickets.length ? (
          <section className="supportTicketSection" aria-labelledby="host-closed-support-heading">
            <div className="supportSectionHeading">
              <div>
                <h3 id="host-closed-support-heading">Closed support history</h3>
                <p className="small">Closed tickets remain available to view, but they can no longer be edited.</p>
              </div>
              <span className="pill">{closedTickets.length} closed</span>
            </div>
            <div className="supportClosedHistory">
              {closedTickets.map((ticket) => (
                <button key={ticket.id} className="supportClosedHistoryItem" type="button" onClick={() => void openTicket(ticket)}>
                  <span>
                    <strong>{ticket.subject}</strong>
                    <span className="small">Closed {formatFriendlyDateTime(ticket.closedAt || ticket.updatedAt || ticket.createdAt || '')}</span>
                  </span>
                  <span className="supportTicketLineMeta">
                    {ticket.userUnread ? <SupportUnreadIcon /> : null}
                    <span>View</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  )
}
