import { api } from './api'
import type { InboxMessage } from './inbox'

export type NotificationFilter = 'all' | 'messages' | 'challenges' | 'tournaments'

export type NotificationCategoryCounts = {
  all: number
  messages: number
  challenges: number
  tournaments: number
  deleted: number
}

export type NotificationThread = {
  threadId: string
  category: Exclude<NotificationFilter, 'all'>
  messageType: InboxMessage['messageType']
  displayMessage: InboxMessage
  messages: InboxMessage[]
  unreadCount: number
  deletedAt?: string | null
  lastReadAt?: string | null
  actionUrl?: string | null
  latestActivityAt?: string | null
}

export type NotificationsResponse = {
  notifications: NotificationThread[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  unreadCount: number
  categoryCounts: NotificationCategoryCounts
}

export type NotificationSummary = {
  unreadCount: number
  categoryCounts: NotificationCategoryCounts
}

export type MessageGroupMember = {
  userId?: string | null
  email: string
  name?: string | null
  joinedAt?: string | null
  leftAt?: string | null
  active: boolean
}

export type MessageGroup = {
  id: string
  name: string
  createdByUserId?: string | null
  createdByEmail: string
  createdByName?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  viewerActive: boolean
  viewerJoinedAt?: string | null
  viewerLeftAt?: string | null
  canManage: boolean
  members: MessageGroupMember[]
}

export type TournamentConversationMessage = {
  id: string
  threadId: string
  senderUserId?: string | null
  senderEmail?: string | null
  senderName?: string | null
  senderRole?: string | null
  body: string
  correlationId?: string | null
  createdAt?: string | null
}

export type TournamentConversation = {
  id: string
  tournamentId: string
  tournamentName: string
  eventDate?: string | null
  actionUrl?: string | null
  hostName?: string | null
  recipients: Array<{ userId?: string | null; email: string; name?: string | null }>
  messages: TournamentConversationMessage[]
}

export type TournamentConversationResponse = {
  conversation: TournamentConversation | null
  canMessageHost: boolean
  hostName: string
}

export const NOTIFICATIONS_CHANGED_EVENT = 'golfhomiez:notifications-changed'

export function notifyNotificationsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT))
}

export async function fetchNotifications(options: { filter?: NotificationFilter; deleted?: boolean; page?: number; pageSize?: number } = {}): Promise<NotificationsResponse> {
  const params = new URLSearchParams()
  params.set('filter', options.filter || 'all')
  params.set('deleted', String(Boolean(options.deleted)))
  params.set('page', String(options.page || 1))
  params.set('pageSize', String(options.pageSize || 10))
  return api<NotificationsResponse>(`/api/notifications?${params.toString()}`)
}

export async function fetchNotificationSummary(): Promise<NotificationSummary> {
  return api<NotificationSummary>('/api/notifications/summary')
}

export async function setNotificationThreadState(threadId: string, state: { markRead?: boolean; deleted?: boolean }): Promise<{ threadId: string; lastReadAt?: string | null; deletedAt?: string | null }> {
  const result = await api<{ threadId: string; lastReadAt?: string | null; deletedAt?: string | null }>(`/api/notifications/threads/${encodeURIComponent(threadId)}/state`, {
    method: 'PATCH',
    body: JSON.stringify(state),
  })
  notifyNotificationsChanged()
  return result
}

export async function fetchMessageGroups(): Promise<{ groups: MessageGroup[] }> {
  return api<{ groups: MessageGroup[] }>('/api/message-groups')
}

export async function createMessageGroup(input: { name: string; memberEmails: string[] }): Promise<{ group: MessageGroup | null }> {
  const result = await api<{ group: MessageGroup | null }>('/api/message-groups', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  notifyNotificationsChanged()
  return result
}

export async function addMessageGroupMember(groupId: string, email: string): Promise<{ group: MessageGroup | null }> {
  const result = await api<{ group: MessageGroup | null }>(`/api/message-groups/${encodeURIComponent(groupId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
  notifyNotificationsChanged()
  return result
}

export async function removeMessageGroupMember(groupId: string, email: string): Promise<{ removed: boolean; group: MessageGroup | null }> {
  const result = await api<{ removed: boolean; group: MessageGroup | null }>(`/api/message-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(email)}`, {
    method: 'DELETE',
  })
  notifyNotificationsChanged()
  return result
}

export async function sendMessageGroupMessage(groupId: string, body: string): Promise<{ ok: boolean; messageId: string; threadId: string }> {
  const result = await api<{ ok: boolean; messageId: string; threadId: string }>(`/api/message-groups/${encodeURIComponent(groupId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
  notifyNotificationsChanged()
  return result
}

export async function fetchTournamentConversation(messageId: string): Promise<TournamentConversationResponse> {
  return api<TournamentConversationResponse>(`/api/notifications/tournament-messages/${encodeURIComponent(messageId)}`)
}

export async function sendTournamentConversationMessage(messageId: string, body: string): Promise<{ ok: boolean; conversation: TournamentConversation }> {
  const result = await api<{ ok: boolean; conversation: TournamentConversation }>(`/api/notifications/tournament-messages/${encodeURIComponent(messageId)}`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
  notifyNotificationsChanged()
  return result
}
