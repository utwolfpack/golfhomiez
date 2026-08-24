import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import PageHero from '../components/PageHero'
import { useAuth } from '../context/AuthContext'
import { RecipientNotFoundError, sendInboxMessage, type InboxMessage } from '../lib/inbox'
import {
  addMessageGroupMember,
  createMessageGroup,
  fetchMessageGroups,
  fetchNotifications,
  fetchTournamentConversation,
  notifyNotificationsChanged,
  removeMessageGroupMember,
  sendMessageGroupMessage,
  sendTournamentConversationMessage,
  setNotificationThreadState,
  type MessageGroup,
  type NotificationFilter,
  type NotificationThread,
  type NotificationsResponse,
  type TournamentConversation,
} from '../lib/notifications'
import { logFrontendEvent } from '../lib/frontend-logger'

const PAGE_SIZE = 10
const FILTERS: Array<{ value: NotificationFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'messages', label: 'Messages' },
  { value: 'challenges', label: 'Challenges' },
  { value: 'tournaments', label: 'Tournaments' },
]

function formatTimestamp(value?: string | null, dateOnly = false) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, dateOnly ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' })
}

function notificationTypeLabel(thread: NotificationThread) {
  if (thread.category === 'challenges') return thread.messageType === 'individual_challenge' ? 'Individual challenge' : 'Team challenge'
  if (thread.category === 'tournaments') return 'Tournament'
  if (thread.messageType === 'group_message') return thread.displayMessage.groupName ? `Group · ${thread.displayMessage.groupName}` : 'Group message'
  return 'Message'
}

function notificationSender(message: { senderName?: string | null; senderEmail?: string | null; senderRole?: string | null }) {
  return message.senderName || message.senderEmail || (message.senderRole ? `${message.senderRole} notification` : 'GolfHomiez')
}

function notificationDate(thread: NotificationThread) {
  if (thread.category === 'challenges') return formatTimestamp(thread.displayMessage.challengeDate, true)
  if (thread.category === 'tournaments') return formatTimestamp(thread.displayMessage.eventDate, true)
  return formatTimestamp(thread.latestActivityAt || thread.displayMessage.createdAt)
}

function challengeNotificationIsCompleted(thread: NotificationThread) {
  if (thread.category !== 'challenges') return false
  return thread.messages.some((message) => String(message.challengeStatus || '').trim().toLowerCase() === 'completed')
}

function parseMemberEmails(value: string) {
  return [...new Set(value.split(/[\n,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))]
}

export default function Inbox() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [deletedView, setDeletedView] = useState(false)
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<NotificationsResponse | null>(null)
  const [groups, setGroups] = useState<MessageGroup[]>([])
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const [composeOpen, setComposeOpen] = useState(false)
  const [recipientEmail, setRecipientEmail] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [sending, setSending] = useState(false)
  const [replyBody, setReplyBody] = useState('')
  const [replySending, setReplySending] = useState(false)

  const [groupName, setGroupName] = useState('')
  const [groupMemberEmails, setGroupMemberEmails] = useState('')
  const [groupSaving, setGroupSaving] = useState(false)
  const [memberEmailByGroup, setMemberEmailByGroup] = useState<Record<string, string>>({})
  const [messageBodyByGroup, setMessageBodyByGroup] = useState<Record<string, string>>({})
  const [sendingGroupId, setSendingGroupId] = useState<string | null>(null)
  const [groupsOpen, setGroupsOpen] = useState(false)
  const groupsSectionRef = useRef<HTMLElement | null>(null)
  const [tournamentConversation, setTournamentConversation] = useState<TournamentConversation | null>(null)
  const [tournamentConversationLoading, setTournamentConversationLoading] = useState(false)
  const [canMessageTournamentHost, setCanMessageTournamentHost] = useState(false)
  const [tournamentHostName, setTournamentHostName] = useState('Tournament host')

  const currentUserEmail = String(user?.email || '').trim().toLowerCase()
  const expandedThread = useMemo(
    () => result?.notifications.find((thread) => thread.threadId === expandedThreadId) || null,
    [expandedThreadId, result?.notifications],
  )
  const displayedNotifications = expandedThread ? [expandedThread] : (result?.notifications || [])

  async function loadNotifications(nextPage = page, nextFilter = filter, nextDeleted = deletedView) {
    setLoading(true)
    setError(null)
    try {
      const [notificationResult, groupResult] = await Promise.all([
        fetchNotifications({ filter: nextFilter, deleted: nextDeleted, page: nextPage, pageSize: PAGE_SIZE }),
        fetchMessageGroups(),
      ])
      setResult(notificationResult)
      setGroups(groupResult.groups || [])
      if (notificationResult.page !== nextPage) setPage(notificationResult.page)
      logFrontendEvent({
        category: 'notifications.page',
        message: 'notifications_loaded',
        data: {
          filter: nextFilter,
          deleted: nextDeleted,
          page: notificationResult.page,
          pageSize: notificationResult.pageSize,
          total: notificationResult.total,
          unreadCount: notificationResult.unreadCount,
          groupCount: groupResult.groups?.length || 0,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load notifications.'
      setError(message)
      logFrontendEvent({ category: 'notifications.page', level: 'error', message: 'notifications_load_failed', data: { error: message, filter: nextFilter, deleted: nextDeleted, page: nextPage } })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadNotifications(page, filter, deletedView)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filter, deletedView])

  useEffect(() => {
    if (!groupsOpen) return
    const frameId = window.requestAnimationFrame(() => {
      groupsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      groupsSectionRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [groupsOpen])

  function toggleGroups() {
    const nextOpen = !groupsOpen
    setGroupsOpen(nextOpen)
    logFrontendEvent({ category: 'notifications.group', message: nextOpen ? 'groups_section_opened' : 'groups_section_hidden', data: { groupCount: groups.length } })
  }

  function applyFilter(nextFilter: NotificationFilter) {
    setExpandedThreadId(null)
    setReplyBody('')
    setPage(1)
    setFilter(nextFilter)
    setDeletedView(false)
    logFrontendEvent({ category: 'notifications.filter', message: 'notification_filter_selected', data: { filter: nextFilter } })
  }

  function applyDeletedView() {
    setExpandedThreadId(null)
    setReplyBody('')
    setPage(1)
    setDeletedView((current) => !current)
    logFrontendEvent({ category: 'notifications.filter', message: 'notification_deleted_filter_toggled', data: { deleted: !deletedView } })
  }

  async function openThread(thread: NotificationThread) {
    setExpandedThreadId(thread.threadId)
    setReplyBody('')
    setTournamentConversation(null)
    setCanMessageTournamentHost(false)
    setTournamentHostName('Tournament host')
    logFrontendEvent({ category: 'notifications.thread', message: 'notification_thread_opened', data: { threadId: thread.threadId, category: thread.category, unreadCount: thread.unreadCount } })
    if (thread.category === 'tournaments') {
      setTournamentConversationLoading(true)
      try {
        const tournamentResult = await fetchTournamentConversation(thread.displayMessage.id)
        setTournamentConversation(tournamentResult.conversation)
        setCanMessageTournamentHost(tournamentResult.canMessageHost)
        setTournamentHostName(tournamentResult.hostName || 'Tournament host')
        logFrontendEvent({ category: 'notifications.tournament', message: 'tournament_conversation_loaded', data: { threadId: thread.threadId, conversationId: tournamentResult.conversation?.id || null, messageCount: tournamentResult.conversation?.messages?.length || 0 } })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load the tournament conversation.'
        setError(message)
        logFrontendEvent({ category: 'notifications.tournament', level: 'error', message: 'tournament_conversation_load_failed', data: { threadId: thread.threadId, error: message } })
      } finally {
        setTournamentConversationLoading(false)
      }
    }
    if (thread.unreadCount > 0) {
      try {
        await setNotificationThreadState(thread.threadId, { markRead: true })
        setResult((current) => current ? {
          ...current,
          unreadCount: Math.max(0, current.unreadCount - thread.unreadCount),
          notifications: current.notifications.map((item) => item.threadId === thread.threadId ? { ...item, unreadCount: 0, lastReadAt: new Date().toISOString() } : item),
        } : current)
        logFrontendEvent({ category: 'notifications.thread', message: 'notification_thread_marked_read', data: { threadId: thread.threadId, category: thread.category } })
        logFrontendEvent({ category: 'inbox.message', message: 'inbox_thread_marked_read', data: { threadId: thread.threadId, unreadCount: thread.unreadCount } })
      } catch (err) {
        logFrontendEvent({ category: 'notifications.thread', level: 'error', message: 'notification_mark_read_failed', data: { threadId: thread.threadId, error: err instanceof Error ? err.message : String(err) } })
      }
    }
  }

  async function handleDeleteOrRestore(thread: NotificationThread, deleted: boolean) {
    setError(null)
    setStatus(null)
    try {
      await setNotificationThreadState(thread.threadId, { deleted })
      setExpandedThreadId(null)
      setStatus(deleted ? 'Notification moved to Deleted.' : 'Notification restored.')
      logFrontendEvent({ category: 'notifications.thread', message: deleted ? 'notification_thread_deleted' : 'notification_thread_restored', data: { threadId: thread.threadId, category: thread.category } })
      await loadNotifications(1, filter, deletedView)
      setPage(1)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update the notification.'
      setError(message)
      logFrontendEvent({ category: 'notifications.thread', level: 'error', message: 'notification_delete_restore_failed', data: { threadId: thread.threadId, deleted, error: message } })
    }
  }

  function directConversationRecipient(thread: NotificationThread) {
    for (const message of thread.messages) {
      const senderEmail = String(message.senderEmail || '').trim().toLowerCase()
      const recipient = String(message.recipientEmail || '').trim().toLowerCase()
      if (senderEmail && senderEmail !== currentUserEmail) return message.senderEmail
      if (recipient && recipient !== currentUserEmail) return message.recipientEmail
    }
    return ''
  }

  async function handleReply(event: FormEvent<HTMLFormElement>, thread: NotificationThread) {
    event.preventDefault()
    const body = replyBody.trim()
    if (!body) return
    const isChallengeReply = thread.messageType === 'challenge_request' || thread.messageType === 'individual_challenge'
    setReplySending(true)
    setError(null)
    setStatus(null)
    try {
      if (isChallengeReply) {
        logFrontendEvent({ category: 'notifications.challenge.reply', message: 'notification_challenge_reply_started', data: { threadId: thread.threadId, messageType: thread.messageType, replyToMessageId: thread.displayMessage.id, directFromNotification: true } })
      }
      if (thread.messageType === 'group_message' && thread.displayMessage.groupId) {
        await sendMessageGroupMessage(thread.displayMessage.groupId, body)
      } else if (thread.messageType === 'message') {
        const recipient = directConversationRecipient(thread)
        if (!recipient) throw new Error('Could not determine the golfer to reply to.')
        await sendInboxMessage({ recipientEmail: recipient, messageType: 'message', body, replyToMessageId: thread.displayMessage.id })
        notifyNotificationsChanged()
      } else if (thread.messageType === 'tournament_notification') {
        const response = await sendTournamentConversationMessage(thread.displayMessage.id, body)
        setTournamentConversation(response.conversation)
        setCanMessageTournamentHost(true)
      } else if (isChallengeReply) {
        await sendInboxMessage({
          recipientEmail: thread.displayMessage.senderEmail || '',
          messageType: thread.messageType,
          body,
          replyToMessageId: thread.displayMessage.id,
        })
        notifyNotificationsChanged()
      } else {
        throw new Error('Open this notification to continue the challenge activity.')
      }
      setReplyBody('')
      setStatus(isChallengeReply ? 'Challenge message sent.' : 'Message sent.')
      logFrontendEvent({ category: 'notifications.reply', message: 'notification_reply_sent', data: { threadId: thread.threadId, messageType: thread.messageType } })
      if (isChallengeReply) {
        logFrontendEvent({ category: 'notifications.challenge.reply', message: 'notification_challenge_reply_succeeded', data: { threadId: thread.threadId, messageType: thread.messageType, directFromNotification: true } })
      }
      await loadNotifications(page, filter, deletedView)
    } catch (err) {
      if (err instanceof RecipientNotFoundError) {
        navigate(`/invite-homie?email=${encodeURIComponent(err.recipientEmail)}&reason=recipient-not-found`, { state: { notice: err.message } })
        return
      }
      const message = err instanceof Error ? err.message : 'Could not send reply.'
      setError(message)
      logFrontendEvent({ category: 'notifications.reply', level: 'error', message: 'notification_reply_failed', data: { threadId: thread.threadId, error: message } })
      if (isChallengeReply) {
        logFrontendEvent({ category: 'notifications.challenge.reply', level: 'error', message: 'notification_challenge_reply_failed', data: { threadId: thread.threadId, messageType: thread.messageType, directFromNotification: true, error: message } })
      }
    } finally {
      setReplySending(false)
    }
  }

  async function handleDirectMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = recipientEmail.trim()
    const body = composeBody.trim()
    if (!email || !body) return
    setSending(true)
    setError(null)
    setStatus(null)
    try {
      logFrontendEvent({ category: 'inbox.message', message: 'inbox_send_started', data: { recipientEmail: email, messageType: 'message' } })
      const sendResult = await sendInboxMessage({ recipientEmail: email, messageType: 'message', body })
      setRecipientEmail('')
      setComposeBody('')
      setComposeOpen(false)
      setStatus('Your message was sent successfully.')
      notifyNotificationsChanged()
      logFrontendEvent({ category: 'notifications.compose', message: 'direct_message_sent', data: { recipientEmail: email } })
      logFrontendEvent({ category: 'inbox.message', message: 'inbox_send_succeeded', data: { recipientEmail: email, messageId: sendResult.message?.id, threadId: sendResult.message?.threadId } })
      await loadNotifications(1, filter, deletedView)
      setPage(1)
    } catch (err) {
      if (err instanceof RecipientNotFoundError) {
        navigate(`/invite-homie?email=${encodeURIComponent(err.recipientEmail)}&reason=recipient-not-found`, { state: { notice: err.message } })
        return
      }
      const message = err instanceof Error ? err.message : 'Could not send message.'
      setError(message)
      logFrontendEvent({ category: 'notifications.compose', level: 'error', message: 'direct_message_send_failed', data: { recipientEmail: email, error: message } })
    } finally {
      setSending(false)
    }
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setGroupSaving(true)
    setError(null)
    setStatus(null)
    try {
      const memberEmails = parseMemberEmails(groupMemberEmails)
      const response = await createMessageGroup({ name: groupName, memberEmails })
      setGroupName('')
      setGroupMemberEmails('')
      setStatus(`Group ${response.group?.name || ''} created.`.trim())
      logFrontendEvent({ category: 'notifications.group', message: 'message_group_created', data: { groupId: response.group?.id || null, memberCount: response.group?.members?.length || 0 } })
      await loadNotifications(page, filter, deletedView)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create group.'
      setError(message)
      logFrontendEvent({ category: 'notifications.group', level: 'error', message: 'message_group_create_failed', data: { error: message } })
    } finally {
      setGroupSaving(false)
    }
  }

  async function handleAddMember(group: MessageGroup) {
    const email = String(memberEmailByGroup[group.id] || '').trim()
    if (!email) return
    setError(null)
    setStatus(null)
    try {
      await addMessageGroupMember(group.id, email)
      setMemberEmailByGroup((current) => ({ ...current, [group.id]: '' }))
      setStatus(`${email} added to ${group.name}.`)
      logFrontendEvent({ category: 'notifications.group', message: 'message_group_member_added', data: { groupId: group.id, memberEmail: email } })
      await loadNotifications(page, filter, deletedView)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not add group member.'
      setError(message)
      logFrontendEvent({ category: 'notifications.group', level: 'error', message: 'message_group_member_add_failed', data: { groupId: group.id, memberEmail: email, error: message } })
    }
  }

  async function handleRemoveMember(group: MessageGroup, email: string) {
    setError(null)
    setStatus(null)
    try {
      await removeMessageGroupMember(group.id, email)
      setStatus(`${email} removed from ${group.name}.`)
      logFrontendEvent({ category: 'notifications.group', message: 'message_group_member_removed', data: { groupId: group.id, memberEmail: email } })
      await loadNotifications(page, filter, deletedView)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not remove group member.'
      setError(message)
      logFrontendEvent({ category: 'notifications.group', level: 'error', message: 'message_group_member_remove_failed', data: { groupId: group.id, memberEmail: email, error: message } })
    }
  }

  async function handleSendGroupMessage(group: MessageGroup) {
    const body = String(messageBodyByGroup[group.id] || '').trim()
    if (!body) return
    setSendingGroupId(group.id)
    setError(null)
    setStatus(null)
    try {
      await sendMessageGroupMessage(group.id, body)
      setMessageBodyByGroup((current) => ({ ...current, [group.id]: '' }))
      setStatus(`Message sent to ${group.name}.`)
      logFrontendEvent({ category: 'notifications.group', message: 'message_group_message_sent', data: { groupId: group.id } })
      await loadNotifications(1, filter, deletedView)
      setPage(1)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send group message.'
      setError(message)
      logFrontendEvent({ category: 'notifications.group', level: 'error', message: 'message_group_message_send_failed', data: { groupId: group.id, error: message } })
    } finally {
      setSendingGroupId(null)
    }
  }

  return (
    <main className="page">
      <PageHero
        eyebrow="Golfer notifications"
        title="Notifications"
        subtitle="Messages, challenges, group conversations, and tournament updates in one inbox."
        actions={
          <Link
            className="btn btnLightGreen btnSmall"
            to="/profile"
            onClick={() => logFrontendEvent({ category: 'inbox.navigation', message: 'return_to_profile_clicked', data: { unreadCount: result?.unreadCount || 0, notificationCount: result?.total || 0 } })}
          >
            Return to Profile
          </Link>
        }
      />

      {error ? <div className="alert error" role="alert">{error}</div> : null}
      {status ? <div className="alert success" role="status">{status}</div> : null}

      <section className="card notificationToolbarCard" aria-label="Notification controls">
        <div className="notificationToolbar">
          <div className="notificationFilterRow" role="group" aria-label="Filter notifications">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`notificationFilterButton${!deletedView && filter === item.value ? ' active' : ''}`}
                onClick={() => applyFilter(item.value)}
              >
                {item.label}
                <span className="notificationFilterCount">{result?.categoryCounts?.[item.value] ?? 0}</span>
              </button>
            ))}
            <button type="button" className={`notificationFilterButton${deletedView ? ' active' : ''}`} onClick={applyDeletedView}>
              Deleted <span className="notificationFilterCount">{result?.categoryCounts?.deleted ?? 0}</span>
            </button>
          </div>
          <div className="notificationToolbarActions">
            <span className="notificationUnreadSummary">{result?.unreadCount || 0} unread</span>
            <button
              type="button"
              className="notificationGroupsLink"
              onClick={toggleGroups}
            >
              {groupsOpen ? 'Hide Groups' : 'Groups'}
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={() => {
                setComposeOpen((current) => !current)
                if (!composeOpen) logFrontendEvent({ category: 'inbox.message', message: 'send_message_button_opened' })
              }}
            >
              {composeOpen ? 'Close' : 'Send a Message'}
            </button>
          </div>
        </div>
      </section>

      {composeOpen ? (
        <section className="card notificationComposeCard">
          <h2>Send a golfer message</h2>
          <form className="notificationComposeForm inboxMessageComposeForm" onSubmit={handleDirectMessage}>
            <label>Golfer email<input type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} required /></label>
            <label>Message<textarea rows={3} maxLength={2000} value={composeBody} onChange={(event) => setComposeBody(event.target.value)} required /></label>
            <button className="button primary" type="submit" disabled={sending || !recipientEmail.trim() || !composeBody.trim()}>{sending ? 'Sending…' : 'Send message'}</button>
          </form>
        </section>
      ) : null}

      <section className="card notificationListCard">
        <div className="notificationSectionHeader">
          <div>
            <h2>{deletedView ? 'Deleted notifications' : 'Recent notifications'}</h2>
            <p>{expandedThread ? 'One conversation is open. Return to the list to view other notifications.' : `Showing up to ${PAGE_SIZE} conversations per page, newest activity first.`}</p>
          </div>
          {expandedThread ? <button type="button" className="button secondary small" onClick={() => { setExpandedThreadId(null); setReplyBody(''); setTournamentConversation(null); setCanMessageTournamentHost(false) }}>Back to notifications</button> : null}
        </div>

        {loading ? <p>Loading notifications…</p> : null}
        {!loading && displayedNotifications.length === 0 ? <p className="emptyState">No notifications match this view.</p> : null}

        <div className="notificationList">
          {displayedNotifications.map((thread) => {
            const expanded = expandedThreadId === thread.threadId
            const message = thread.displayMessage
            const groupState = message.groupId ? groups.find((group) => group.id === message.groupId) : null
            const isChallengeThread = thread.messageType === 'challenge_request' || thread.messageType === 'individual_challenge'
            const canReply = !deletedView && (
              thread.messageType === 'message' ||
              (thread.messageType === 'group_message' && Boolean(message.groupId) && Boolean(groupState?.viewerActive)) ||
              (thread.messageType === 'tournament_notification' && canMessageTournamentHost) ||
              (isChallengeThread && !challengeNotificationIsCompleted(thread))
            )
            return (
              <article key={thread.threadId} className={`notificationLineItem${thread.unreadCount > 0 ? ' unread' : ''}${expanded ? ' expanded' : ''}`}>
                <button type="button" className="notificationLineItemButton" onClick={() => void openThread(thread)} aria-expanded={expanded}>
                  <span className={`notificationTypeBadge notificationTypeBadge--${thread.category}`}>{notificationTypeLabel(thread)}</span>
                  <span className="notificationLineMain">
                    <span className="notificationLineTitle">
                      {thread.unreadCount > 0 ? <span className="notificationUnreadDot" aria-label={`${thread.unreadCount} unread`} /> : null}
                      <strong>{notificationSender(message)}</strong>
                    </span>
                  </span>
                  <span className="notificationLineMeta"><span>{notificationDate(thread)}</span></span>
                </button>

                {expanded ? (
                  <div className="notificationThreadPanel">
                    <div className="notificationThreadActions">
                      {thread.actionUrl ? <Link className="button primary small" to={thread.actionUrl}>{thread.category === 'challenges' ? 'View challenge' : 'View tournament'}</Link> : null}
                      <button type="button" className="button secondary small" onClick={() => void handleDeleteOrRestore(thread, !deletedView)}>{deletedView ? 'Restore' : 'Delete'}</button>
                    </div>

                    {thread.messageType === 'tournament_notification' && (tournamentConversation?.recipients.length || 0) > 1 ? (
                      <div className="notificationTournamentParticipantCount" role="status" aria-label={`${(tournamentConversation?.recipients.length || 0) + 1} people in this tournament message`}>
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="9" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.5"/><path d="M3.5 19c.5-3.4 2.5-5.2 5.5-5.2s5 1.8 5.5 5.2"/><path d="M14.2 14.4c2.8-.7 5.5.8 6.3 3.8"/></svg>
                        <span>{(tournamentConversation?.recipients.length || 0) + 1} people in this message</span>
                      </div>
                    ) : null}

                    <div className="notificationConversation" aria-label="Conversation thread">
                      {thread.messageType === 'tournament_notification' && tournamentConversationLoading ? <p className="small">Loading tournament dialogue…</p> : null}
                      {(thread.messageType === 'tournament_notification'
                        ? (tournamentConversation?.messages || thread.messages.slice(0, 1))
                        : thread.messages
                      ).map((threadMessage) => {
                        const fromMe = String(threadMessage.senderUserId || '') === String(user?.id || '') || String(threadMessage.senderEmail || '').trim().toLowerCase() === currentUserEmail
                        return (
                          <div key={threadMessage.id} className={`notificationConversationMessage${fromMe ? ' fromMe' : ''}`}>
                            <div className="notificationConversationMeta">
                              <strong>{fromMe ? 'You' : notificationSender(threadMessage)}</strong>
                              <span>{formatTimestamp(threadMessage.createdAt)}</span>
                            </div>
                            <p>{threadMessage.body}</p>
                          </div>
                        )
                      })}
                    </div>

                    {canReply ? (
                      <form className={`notificationReplyForm${isChallengeThread ? ' notificationChallengeReplyForm' : ''}`} onSubmit={(event) => void handleReply(event, thread)}>
                        <label>
                          {thread.messageType === 'tournament_notification'
                            ? (tournamentConversation ? `Reply to ${tournamentHostName}` : `Send a message to ${tournamentHostName}`)
                            : (thread.messageType === 'individual_challenge'
                              ? 'Say something to your challenge group'
                              : (thread.messageType === 'challenge_request' ? 'Reply to your Team Challenge' : 'Add to this conversation'))}
                          <textarea
                            rows={isChallengeThread ? 3 : 2}
                            maxLength={2000}
                            value={replyBody}
                            onChange={(event) => setReplyBody(event.target.value)}
                            placeholder={thread.messageType === 'individual_challenge' ? 'Smack talk your homiez' : (thread.messageType === 'challenge_request' ? 'Message your Team Challenge' : undefined)}
                            required
                          />
                        </label>
                        <button className="button primary small" type="submit" disabled={replySending || !replyBody.trim()}>{replySending ? 'Sending…' : 'Send'}</button>
                      </form>
                    ) : null}
                    {thread.messageType === 'tournament_notification' && !tournamentConversationLoading && !canMessageTournamentHost ? <p className="notificationReadOnlyNotice">The tournament host is not currently available for inbox messages.</p> : null}
                    {thread.messageType === 'group_message' && !groupState?.viewerActive ? <p className="notificationReadOnlyNotice">You were removed from this group. This conversation is preserved through your removal date, but you can no longer contribute.</p> : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>

        {!expandedThread && result && result.totalPages > 1 ? (
          <div className="notificationPagination" aria-label="Notification pages">
            <button type="button" className="button secondary small" disabled={result.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
            <span>Page {result.page} of {result.totalPages}</span>
            <button type="button" className="button secondary small" disabled={result.page >= result.totalPages} onClick={() => setPage((current) => current + 1)}>Next</button>
          </div>
        ) : null}
      </section>

      {groupsOpen ? (
      <section ref={groupsSectionRef} id="message-groups" tabIndex={-1} className="card notificationGroupsCard">
        <div className="notificationSectionHeader">
          <div><h2>Message groups</h2><p>Create a group once, then keep one continuous conversation for that group.</p></div>
        </div>
        <form className="messageGroupCreateForm" onSubmit={handleCreateGroup}>
          <label>Group name<input value={groupName} maxLength={120} onChange={(event) => setGroupName(event.target.value)} required /></label>
          <label>Member emails<textarea rows={2} value={groupMemberEmails} onChange={(event) => setGroupMemberEmails(event.target.value)} placeholder="golfer1@example.com, golfer2@example.com" /></label>
          <button className="button primary" type="submit" disabled={groupSaving || !groupName.trim()}>{groupSaving ? 'Creating…' : 'Create group'}</button>
        </form>

        <div className="messageGroupList">
          {groups.length === 0 ? <p className="emptyState">You do not have any message groups yet.</p> : null}
          {groups.map((group) => (
            <div className="messageGroupItem" key={group.id}>
              <div className="messageGroupHeader"><strong>{group.name}</strong><span>{group.members.filter((member) => member.active).length} active members</span></div>
              <div className="messageGroupMembers">
                {group.members.map((member) => (
                  <span className={`messageGroupMember${member.active ? '' : ' removed'}`} key={`${group.id}:${member.email}`}>
                    {member.name || member.email}{!member.active ? ' · removed' : ''}
                    {group.canManage && member.active && member.email.toLowerCase() !== group.createdByEmail.toLowerCase() ? <button type="button" onClick={() => void handleRemoveMember(group, member.email)}>Remove</button> : null}
                  </span>
                ))}
              </div>
              {group.canManage ? (
                <div className="messageGroupAddMember">
                  <input type="email" aria-label={`Add member to ${group.name}`} placeholder="golfer@example.com" value={memberEmailByGroup[group.id] || ''} onChange={(event) => setMemberEmailByGroup((current) => ({ ...current, [group.id]: event.target.value }))} />
                  <button type="button" className="button secondary small" onClick={() => void handleAddMember(group)} disabled={!String(memberEmailByGroup[group.id] || '').trim()}>Add member</button>
                </div>
              ) : null}
              {group.viewerActive ? (
                <div className="messageGroupSendMessage">
                  <textarea rows={2} maxLength={2000} aria-label={`Message ${group.name}`} placeholder={`Message ${group.name}`} value={messageBodyByGroup[group.id] || ''} onChange={(event) => setMessageBodyByGroup((current) => ({ ...current, [group.id]: event.target.value }))} />
                  <button type="button" className="button primary small" onClick={() => void handleSendGroupMessage(group)} disabled={sendingGroupId === group.id || !String(messageBodyByGroup[group.id] || '').trim()}>{sendingGroupId === group.id ? 'Sending…' : 'Send to group'}</button>
                </div>
              ) : <div className="small">Conversation access ended when you were removed from this group.</div>}
            </div>
          ))}
        </div>
      </section>
      ) : null}
    </main>
  )
}
