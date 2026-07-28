import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import PageHero from '../components/PageHero'
import { useAuth } from '../context/AuthContext'
import {
  fetchInboxMessages,
  fetchSentInboxMessages,
  markInboxMessageRead,
  RecipientNotFoundError,
  replyToInboxMessage,
  sendInboxMessage,
  type InboxMessage,
} from '../lib/inbox'
import { logFrontendEvent } from '../lib/frontend-logger'

type InboxThread = {
  threadId: string
  displayMessage: InboxMessage
  messages: InboxMessage[]
  unreadMessages: InboxMessage[]
  unreadCount: number
}

function formatInboxTimestamp(value?: string | null) {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function messageThreadId(message: InboxMessage) {
  return message.threadId || message.id
}

function sortThreadMessages(messages: InboxMessage[]) {
  return [...messages].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
}

function latestThreadMessage(messages: InboxMessage[]) {
  const sorted = sortThreadMessages(messages)
  return sorted[sorted.length - 1]
}

function buildInboxThreads(messages: InboxMessage[]): InboxThread[] {
  const grouped = new Map<string, InboxMessage[]>()
  messages.forEach((message) => {
    const threadId = messageThreadId(message)
    grouped.set(threadId, [...(grouped.get(threadId) || []), message])
  })

  return Array.from(grouped.entries())
    .map(([threadId, threadMessages]) => {
      const sortedMessages = sortThreadMessages(threadMessages)
      const unreadMessages = sortedMessages.filter((message) => !message.readAt)
      return {
        threadId,
        displayMessage: unreadMessages[unreadMessages.length - 1] || sortedMessages[sortedMessages.length - 1],
        messages: sortedMessages,
        unreadMessages,
        unreadCount: unreadMessages.length,
      }
    })
    .sort((a, b) => String(b.displayMessage.createdAt || '').localeCompare(String(a.displayMessage.createdAt || '')))
}

function getMessagePreview(body?: string | null) {
  const normalized = String(body || '').replace(/\s+/g, ' ').trim()
  if (normalized.length <= 140) return normalized
  return `${normalized.slice(0, 140)}…`
}

function uniqueInboxMessages(messages: InboxMessage[]) {
  const byId = new Map<string, InboxMessage>()
  messages.forEach((message) => {
    if (message?.id) byId.set(String(message.id), message)
  })
  return Array.from(byId.values())
}

export default function Inbox() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [messages, setMessages] = useState<InboxMessage[]>([])
  const [sentMessages, setSentMessages] = useState<InboxMessage[]>([])
  const [recipientEmail, setRecipientEmail] = useState('')
  const [messageComposeOpen, setMessageComposeOpen] = useState(false)
  const [body, setBody] = useState('')
  const [replyingTo, setReplyingTo] = useState<InboxMessage | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [replySending, setReplySending] = useState(false)
  const [markingReadThreadId, setMarkingReadThreadId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const currentUserEmail = useMemo(() => String(user?.email || '').trim().toLowerCase(), [user?.email])
  const messageOnlyMessages = useMemo(() => messages.filter((message) => message.messageType === 'message'), [messages])
  const unreadCount = useMemo(() => messageOnlyMessages.filter((message) => !message.readAt).length, [messageOnlyMessages])
  const receivedThreads = useMemo(() => buildInboxThreads(messageOnlyMessages), [messageOnlyMessages])
  const allConversationMessages = useMemo(() => uniqueInboxMessages([...messages, ...sentMessages].filter((message) => message.messageType === 'message')), [messages, sentMessages])
  const canSubmitMessage = Boolean(body.trim() && recipientEmail.trim())

  function getConversationFor(message: InboxMessage) {
    const threadId = messageThreadId(message)
    return sortThreadMessages(allConversationMessages.filter((item) => messageThreadId(item) === threadId))
  }

  function getLatestConversationMessage(message: InboxMessage) {
    return latestThreadMessage(getConversationFor(message)) || message
  }

  function sentByCurrentUser(message: InboxMessage) {
    return String(message.senderUserId || '') === String(user?.id || '') || String(message.senderEmail || '').trim().toLowerCase() === currentUserEmail
  }

  async function loadInbox() {
    setLoading(true)
    setError(null)
    try {
      const [inboxResult, sentResult] = await Promise.all([fetchInboxMessages(), fetchSentInboxMessages()])
      setMessages(inboxResult.messages || [])
      setSentMessages(sentResult.sentMessages || [])
      logFrontendEvent({
        category: 'inbox.page',
        message: 'inbox_messages_loaded',
        data: {
          unreadCount: inboxResult.unreadCount,
          messageCount: inboxResult.messages?.length || 0,
          receivedThreadCount: buildInboxThreads((inboxResult.messages || []).filter((message) => message.messageType === 'message')).length,
          sentMessageCount: sentResult.sentMessages?.length || 0,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load messages.'
      setError(message)
      logFrontendEvent({ category: 'inbox.page', level: 'error', message: 'inbox_messages_load_failed', data: { error: message } })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadInbox()
  }, [])

  async function handleMessageSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedRecipient = recipientEmail.trim()
    const trimmedBody = body.trim()
    setSending(true)
    setError(null)
    setStatus(null)

    try {
      logFrontendEvent({ category: 'inbox.message', message: 'inbox_send_started', data: { recipientEmail: trimmedRecipient, messageType: 'message' } })
      const result = await sendInboxMessage({ recipientEmail: trimmedRecipient, messageType: 'message', body: trimmedBody })
      setStatus(result.notice || 'Your message was sent successfully.')
      setRecipientEmail('')
      setBody('')
      setMessageComposeOpen(false)
      logFrontendEvent({ category: 'inbox.message', message: 'inbox_send_succeeded', data: { recipientEmail: trimmedRecipient, messageId: result.message?.id, threadId: result.message?.threadId } })
      await loadInbox()
    } catch (err) {
      if (err instanceof RecipientNotFoundError) {
        const message = err.message || 'Recipient does not exist in Golf Homiez. Send them an invite to join.'
        logFrontendEvent({ category: 'inbox.message', level: 'warn', message: 'inbox_recipient_not_found_redirecting_to_invite_homie', data: { recipientEmail: err.recipientEmail } })
        navigate(`/invite-homie?email=${encodeURIComponent(err.recipientEmail)}&reason=recipient-not-found`, { state: { notice: message } })
        return
      }
      const message = err instanceof Error ? err.message : 'Could not send message.'
      setError(message)
      logFrontendEvent({ category: 'inbox.message', level: 'error', message: 'inbox_send_failed', data: { recipientEmail: trimmedRecipient, error: message } })
    } finally {
      setSending(false)
    }
  }

  async function handleReplySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!replyingTo) return
    const trimmedBody = replyBody.trim()
    setReplySending(true)
    setError(null)
    setStatus(null)

    try {
      logFrontendEvent({ category: 'inbox.reply', message: 'inbox_reply_started', data: { replyToMessageId: replyingTo.id, threadId: replyingTo.threadId || replyingTo.id, recipientEmail: replyingTo.senderEmail } })
      const result = await replyToInboxMessage({ message: replyingTo, body: trimmedBody })
      setStatus(result.notice || 'Your message was sent successfully.')
      setReplyingTo(null)
      setReplyBody('')
      logFrontendEvent({ category: 'inbox.reply', message: 'inbox_reply_succeeded', data: { replyToMessageId: replyingTo.id, messageId: result.message?.id, threadId: result.message?.threadId } })
      await loadInbox()
    } catch (err) {
      if (err instanceof RecipientNotFoundError) {
        const message = err.message || 'Recipient does not exist in Golf Homiez. Send them an invite to join.'
        logFrontendEvent({ category: 'inbox.reply', level: 'warn', message: 'inbox_reply_recipient_not_found_redirecting_to_invite_homie', data: { recipientEmail: err.recipientEmail, replyToMessageId: replyingTo.id } })
        navigate(`/invite-homie?email=${encodeURIComponent(err.recipientEmail)}&reason=recipient-not-found`, { state: { notice: message } })
        return
      }
      const message = err instanceof Error ? err.message : 'Could not send reply.'
      setError(message)
      logFrontendEvent({ category: 'inbox.reply', level: 'error', message: 'inbox_reply_failed', data: { replyToMessageId: replyingTo.id, error: message } })
    } finally {
      setReplySending(false)
    }
  }

  function toggleThreadExpansion(thread: InboxThread) {
    setExpandedThreadId((current) => {
      const next = current === thread.threadId ? null : thread.threadId
      if (next !== thread.threadId && replyingTo && messageThreadId(replyingTo) === thread.threadId) {
        setReplyingTo(null)
        setReplyBody('')
      }
      if (next === thread.threadId) {
        setReplyingTo(null)
        setReplyBody('')
      }
      logFrontendEvent({
        category: 'inbox.message',
        message: next === thread.threadId ? 'inbox_thread_expanded' : 'inbox_thread_collapsed',
        data: { threadId: thread.threadId, displayMessageId: thread.displayMessage.id, threadMessageCount: thread.messages.length, unreadCount: thread.unreadCount, source: 'messages' },
      })
      return next
    })
  }

  async function handleMarkThreadRead(thread: InboxThread) {
    if (thread.unreadMessages.length === 0) return
    setMarkingReadThreadId(thread.threadId)
    try {
      const updatedMessages = await Promise.all(thread.unreadMessages.map((message) => markInboxMessageRead(message.id)))
      setMessages((prev) => prev.map((item) => updatedMessages.find((updated) => updated.id === item.id) || item))
      logFrontendEvent({ category: 'inbox.message', message: 'inbox_thread_marked_read', data: { threadId: thread.threadId, unreadCount: thread.unreadCount, messageIds: thread.unreadMessages.map((message) => message.id) } })
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Could not mark thread as read.'
      setError(messageText)
      logFrontendEvent({ category: 'inbox.message', level: 'error', message: 'inbox_thread_mark_read_failed', data: { threadId: thread.threadId, error: messageText } })
    } finally {
      setMarkingReadThreadId(null)
    }
  }

  function renderConversation(message: InboxMessage) {
    const conversation = getConversationFor(message)
    if (conversation.length <= 1) return null

    return (
      <div className="inboxConversationThread">
        <div className="small inboxConversationTitle">Conversation</div>
        {conversation.map((item) => (
          <div key={item.id} className={`inboxConversationItem ${sentByCurrentUser(item) ? 'inboxConversationItem--sent' : 'inboxConversationItem--received'}`}>
            <div className="inboxConversationMeta">
              <strong>{sentByCurrentUser(item) ? 'You' : (item.senderName || item.senderEmail)}</strong>
              <span>{formatInboxTimestamp(item.createdAt)}</span>
            </div>
            <p>{item.body}</p>
          </div>
        ))}
      </div>
    )
  }

  function renderReplyForm(message: InboxMessage) {
    if (!replyingTo || messageThreadId(replyingTo) !== messageThreadId(message)) return null
    return (
      <form className="formStack inboxReplyForm" onSubmit={handleReplySubmit}>
        <label className="label" htmlFor={`reply-${message.id}`}>Reply</label>
        <textarea
          id={`reply-${message.id}`}
          className="input"
          rows={4}
          maxLength={2000}
          required
          value={replyBody}
          onChange={(event) => setReplyBody(event.target.value)}
          placeholder="Write your reply"
        />
        <div className="small">{replyBody.length}/2000 characters</div>
        <div className="pageHeroActions inboxMessageActions">
          <button className="btn btnPrimary btnSmall" type="submit" disabled={replySending || !replyBody.trim()}>{replySending ? 'Sending reply…' : 'Send Reply'}</button>
          <button type="button" className="btn btnSmall" onClick={() => { setReplyingTo(null); setReplyBody('') }}>Cancel</button>
        </div>
      </form>
    )
  }

  function renderThreadCard(thread: InboxThread) {
    const message = thread.displayMessage
    const isExpanded = expandedThreadId === thread.threadId
    const latestMessage = getLatestConversationMessage(message)
    const unreadText = thread.unreadCount === 1 ? '1 new' : `${thread.unreadCount} new`

    return (
      <article key={thread.threadId} className={`inboxMessageCard ${thread.unreadCount > 0 ? 'inboxMessageCard--unread' : 'inboxMessageCard--read'} ${isExpanded ? 'inboxMessageCard--expanded' : 'inboxMessageCard--collapsed'}`}>
        <div className="inboxMessageTopline">
          <span className="pill">Message</span>
          {thread.unreadCount > 0 ? <span className="inboxUnreadIndicator">{unreadText}</span> : <span className="small">Latest {formatInboxTimestamp(latestMessage.createdAt)}</span>}
        </div>
        <div className="inboxMessageSender">From: {message.senderName || message.senderEmail}</div>
        <div className="small">Latest activity {formatInboxTimestamp(latestMessage.createdAt)}</div>
        {isExpanded ? (
          <>
            <p className="inboxMessageBody">{latestMessage.body}</p>
            {renderConversation(message)}
          </>
        ) : (
          <p className="inboxMessagePreview">{getMessagePreview(latestMessage.body)}</p>
        )}
        <div className="pageHeroActions inboxMessageActions">
          <button type="button" className="btn btnSmall" aria-expanded={isExpanded} onClick={() => toggleThreadExpansion(thread)}>{isExpanded ? 'Collapse' : 'Expand'}</button>
          {thread.unreadCount > 0 ? <button type="button" className="btn btnSmall" disabled={markingReadThreadId === thread.threadId} onClick={() => void handleMarkThreadRead(thread)}>{markingReadThreadId === thread.threadId ? 'Marking…' : 'Mark read'}</button> : null}
          {isExpanded ? <button type="button" className="btn btnSmall" onClick={() => { setReplyingTo(getLatestConversationMessage(message)); setReplyBody('') }}>Reply</button> : null}
        </div>
        {isExpanded ? renderReplyForm(message) : null}
      </article>
    )
  }

  return (
    <div className="container pageStack inboxPage">
      <PageHero
        eyebrow="Golf user messages"
        title="Messages"
        actions={
          <Link
            className="btn btnLightGreen btnSmall"
            to="/profile"
            onClick={() => logFrontendEvent({ category: 'inbox.navigation', message: 'return_to_profile_clicked', data: { unreadCount, receivedThreadCount: receivedThreads.length } })}
          >
            Return to Profile
          </Link>
        }
      />

      <section className="card inboxListCard inboxMessagesListCard">
        <div className="inboxSectionHeader inboxSectionHeader--withActions">
          <div className="inboxSectionActions">
            <span className={unreadCount > 0 ? 'inboxUnreadIndicator' : 'pill'}>{unreadCount > 0 ? `${unreadCount} unread` : 'No unread messages'}</span>
            <button
              type="button"
              className="btn btnPrimary btnSmall inboxSendMessageButton"
              aria-expanded={messageComposeOpen}
              onClick={() => {
                setMessageComposeOpen(true)
                logFrontendEvent({ category: 'inbox.messageCompose', message: 'send_message_button_opened' })
              }}
            >
              Send a Message
            </button>
          </div>
        </div>

        {messageComposeOpen ? (
          <form className="formStack inboxEmbeddedForm inboxMessageComposeForm" onSubmit={handleMessageSubmit}>
            <div>
              <label className="label" htmlFor="inboxRecipientEmail">Recipient email</label>
              <input
                id="inboxRecipientEmail"
                className="input"
                type="email"
                required
                value={recipientEmail}
                onChange={(event) => setRecipientEmail(event.target.value)}
                placeholder="golfer@example.com"
              />
            </div>

            <div>
              <label className="label" htmlFor="inboxMessageBody">Message</label>
              <textarea
                id="inboxMessageBody"
                className="input"
                rows={5}
                required
                maxLength={2000}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Write your Golf Homiez message"
              />
              <div className="small">{body.length}/2000 characters</div>
            </div>

            {status ? <div className="inboxStatus inboxStatus--success">{status}</div> : null}
            {error ? <div className="inboxStatus inboxStatus--error">{error}</div> : null}

            <div className="pageHeroActions">
              <button className="btn btnPrimary" type="submit" disabled={sending || !canSubmitMessage}>{sending ? 'Sending…' : 'Send Message'}</button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setMessageComposeOpen(false)
                  logFrontendEvent({ category: 'inbox.messageCompose', message: 'send_message_form_cancelled' })
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {loading ? <div className="small">Loading messages…</div> : null}
        {!loading && receivedThreads.length === 0 ? <div className="small">No inbox messages yet.</div> : null}
        <div className="inboxMessageList">
          {receivedThreads.map((thread) => renderThreadCard(thread))}
        </div>
      </section>
    </div>
  )
}
