import { api } from './api'

export type SupportMessageInput = {
  subject: string
  message: string
}

export type SupportTicketMessage = {
  id: string
  ticketId: string
  senderType: 'user' | 'admin'
  senderAccountId?: string | null
  senderEmail?: string | null
  message: string
  createdAt?: string | null
  correlationId?: string | null
}

export type SupportTicket = {
  id: string
  accountType: 'golf_user' | 'host' | 'organizer' | string
  accountId?: string | null
  requesterEmail?: string | null
  requesterName?: string | null
  subject: string
  status: 'open' | 'closed' | string
  userUnread: boolean
  adminUnread: boolean
  createdAt?: string | null
  updatedAt?: string | null
  lastMessageAt?: string | null
  closedAt?: string | null
  closedByAdminId?: string | null
  correlationId?: string | null
  messageCount?: number
  messages?: SupportTicketMessage[]
}

export type SupportMessageResult = {
  ok: boolean
  ticket: SupportTicket
}

export function sendSupportMessage(input: SupportMessageInput) {
  return api<SupportMessageResult>('/api/support/messages', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function fetchSupportTickets() {
  return api<{ tickets: SupportTicket[] }>('/api/support/tickets')
}

export function fetchSupportTicket(ticketId: string) {
  return api<{ ticket: SupportTicket }>(`/api/support/tickets/${encodeURIComponent(ticketId)}`)
}

export function replyToSupportTicket(ticketId: string, message: string) {
  return api<{ ticket: SupportTicket }>(`/api/support/tickets/${encodeURIComponent(ticketId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
}
