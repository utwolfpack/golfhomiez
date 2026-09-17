import { randomUUID } from 'node:crypto'

export const SUPPORT_TICKET_STATUS = Object.freeze({
  OPEN: 'open',
  CLOSED: 'closed',
})

export const SUPPORT_SENDER_TYPE = Object.freeze({
  USER: 'user',
  ADMIN: 'admin',
})

const MAX_SUBJECT_LENGTH = 160
const MAX_MESSAGE_LENGTH = 5000

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, maxLength)
}

function normalizeTimestamp(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString()
}

function parseMetadata(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return null
  }
}

export function normalizeSupportTicketInput(input = {}) {
  const subject = cleanText(input.subject, MAX_SUBJECT_LENGTH)
  const message = cleanText(input.message, MAX_MESSAGE_LENGTH)
  if (!subject) throw new Error('Subject is required.')
  if (!message) throw new Error('Support message is required.')
  return { subject, message }
}

export function normalizeSupportMessageInput(input = {}) {
  const message = cleanText(input.message, MAX_MESSAGE_LENGTH)
  if (!message) throw new Error('Support message is required.')
  return message
}

export function mapSupportTicket(row) {
  if (!row) return null
  return {
    id: String(row.id),
    accountType: String(row.account_type || ''),
    accountId: row.account_id == null ? null : String(row.account_id),
    requesterEmail: String(row.requester_email || ''),
    requesterName: String(row.requester_name || ''),
    subject: String(row.subject || ''),
    status: String(row.status || SUPPORT_TICKET_STATUS.OPEN),
    userUnread: Boolean(row.user_unread),
    adminUnread: Boolean(row.admin_unread),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    lastMessageAt: normalizeTimestamp(row.last_message_at),
    closedAt: normalizeTimestamp(row.closed_at),
    closedByAdminId: row.closed_by_admin_id == null ? null : String(row.closed_by_admin_id),
    correlationId: row.correlation_id == null ? null : String(row.correlation_id),
    metadata: parseMetadata(row.metadata_json),
    messageCount: row.message_count == null ? undefined : Number(row.message_count || 0),
  }
}

export function mapSupportMessage(row) {
  if (!row) return null
  return {
    id: String(row.id),
    ticketId: String(row.ticket_id),
    senderType: String(row.sender_type || ''),
    senderAccountId: row.sender_account_id == null ? null : String(row.sender_account_id),
    senderEmail: String(row.sender_email || ''),
    message: String(row.message || ''),
    createdAt: normalizeTimestamp(row.created_at),
    correlationId: row.correlation_id == null ? null : String(row.correlation_id),
  }
}

function requesterTicketWhere(requester) {
  return {
    sql: 'account_type = ? AND account_id = ?',
    params: [String(requester.accountType || ''), String(requester.accountId || '')],
  }
}

export async function createSupportTicket(db, { requester, subject, message, correlationId = null }) {
  const normalized = normalizeSupportTicketInput({ subject, message })
  if (!requester?.accountType || !requester?.accountId) throw new Error('A signed-in account is required to create a support ticket.')

  const ticketId = randomUUID()
  const messageId = randomUUID()
  const metadataJson = requester.metadata && Object.keys(requester.metadata).length ? JSON.stringify(requester.metadata) : null
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    await connection.execute(
      `INSERT INTO support_tickets (
         id, account_type, account_id, requester_email, requester_name, subject, status,
         user_unread, admin_unread, metadata_json, correlation_id,
         created_at, updated_at, last_message_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'open', 0, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        ticketId,
        requester.accountType,
        requester.accountId,
        requester.email || '',
        requester.name || requester.email || '',
        normalized.subject,
        metadataJson,
        correlationId,
      ],
    )
    await connection.execute(
      `INSERT INTO support_ticket_messages (
         id, ticket_id, sender_type, sender_account_id, sender_email, message, correlation_id, created_at
       ) VALUES (?, ?, 'user', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [messageId, ticketId, requester.accountId, requester.email || '', normalized.message, correlationId],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  return getSupportTicketForRequester(db, requester, ticketId, { markRead: false })
}

export async function listSupportTicketsForRequester(db, requester) {
  if (!requester?.accountType || !requester?.accountId) return []
  const where = requesterTicketWhere(requester)
  const [rows] = await db.execute(
    `SELECT t.*,
            (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM support_tickets t
      WHERE ${where.sql}
      ORDER BY CASE WHEN t.status = 'open' THEN 0 ELSE 1 END,
               COALESCE(t.last_message_at, t.updated_at, t.created_at) DESC,
               t.created_at DESC`,
    where.params,
  )
  return (rows || []).map(mapSupportTicket)
}

export async function getSupportTicketForRequester(db, requester, ticketId, { markRead = true } = {}) {
  if (!requester?.accountType || !requester?.accountId) return null
  const where = requesterTicketWhere(requester)
  const [rows] = await db.execute(
    `SELECT t.*,
            (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM support_tickets t
      WHERE t.id = ? AND ${where.sql}
      LIMIT 1`,
    [ticketId, ...where.params],
  )
  const ticket = mapSupportTicket(rows?.[0])
  if (!ticket) return null

  if (markRead && ticket.userUnread) {
    await db.execute('UPDATE support_tickets SET user_unread = 0, updated_at = updated_at WHERE id = ?', [ticketId])
    ticket.userUnread = false
  }

  const [messageRows] = await db.execute(
    `SELECT id, ticket_id, sender_type, sender_account_id, sender_email, message, correlation_id, created_at
       FROM support_ticket_messages
      WHERE ticket_id = ?
      ORDER BY created_at ASC, id ASC`,
    [ticketId],
  )
  return { ...ticket, messages: (messageRows || []).map(mapSupportMessage) }
}

export async function addRequesterSupportMessage(db, { requester, ticketId, message, correlationId = null }) {
  const normalizedMessage = normalizeSupportMessageInput({ message })
  const where = requesterTicketWhere(requester)
  const [rows] = await db.execute(
    `SELECT id, status FROM support_tickets WHERE id = ? AND ${where.sql} LIMIT 1`,
    [ticketId, ...where.params],
  )
  const ticket = rows?.[0]
  if (!ticket) return null
  if (String(ticket.status || '').toLowerCase() !== SUPPORT_TICKET_STATUS.OPEN) {
    const error = new Error('Closed support tickets are read-only.')
    error.statusCode = 409
    throw error
  }

  const messageId = randomUUID()
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    await connection.execute(
      `INSERT INTO support_ticket_messages (
         id, ticket_id, sender_type, sender_account_id, sender_email, message, correlation_id, created_at
       ) VALUES (?, ?, 'user', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [messageId, ticketId, requester.accountId, requester.email || '', normalizedMessage, correlationId],
    )
    await connection.execute(
      `UPDATE support_tickets
          SET admin_unread = 1,
              last_message_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP,
              correlation_id = ?
        WHERE id = ?`,
      [correlationId, ticketId],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
  return getSupportTicketForRequester(db, requester, ticketId, { markRead: false })
}

export async function listSupportTicketsForAdmin(db) {
  const [rows] = await db.execute(
    `SELECT t.*,
            (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM support_tickets t
      ORDER BY CASE WHEN t.status = 'open' THEN 0 ELSE 1 END,
               t.admin_unread DESC,
               COALESCE(t.last_message_at, t.updated_at, t.created_at) DESC,
               t.created_at DESC`,
  )
  return (rows || []).map(mapSupportTicket)
}

export async function getSupportTicketForAdmin(db, ticketId, { markRead = true } = {}) {
  const [rows] = await db.execute(
    `SELECT t.*,
            (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM support_tickets t
      WHERE t.id = ?
      LIMIT 1`,
    [ticketId],
  )
  const ticket = mapSupportTicket(rows?.[0])
  if (!ticket) return null

  if (markRead && ticket.adminUnread) {
    await db.execute('UPDATE support_tickets SET admin_unread = 0, updated_at = updated_at WHERE id = ?', [ticketId])
    ticket.adminUnread = false
  }

  const [messageRows] = await db.execute(
    `SELECT id, ticket_id, sender_type, sender_account_id, sender_email, message, correlation_id, created_at
       FROM support_ticket_messages
      WHERE ticket_id = ?
      ORDER BY created_at ASC, id ASC`,
    [ticketId],
  )
  return { ...ticket, messages: (messageRows || []).map(mapSupportMessage) }
}

export async function addAdminSupportMessage(db, { ticketId, adminUser, message, correlationId = null }) {
  const normalizedMessage = normalizeSupportMessageInput({ message })
  const [rows] = await db.execute('SELECT id, status FROM support_tickets WHERE id = ? LIMIT 1', [ticketId])
  const ticket = rows?.[0]
  if (!ticket) return null
  if (String(ticket.status || '').toLowerCase() !== SUPPORT_TICKET_STATUS.OPEN) {
    const error = new Error('Closed support tickets are read-only.')
    error.statusCode = 409
    throw error
  }

  const messageId = randomUUID()
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    await connection.execute(
      `INSERT INTO support_ticket_messages (
         id, ticket_id, sender_type, sender_account_id, sender_email, message, correlation_id, created_at
       ) VALUES (?, ?, 'admin', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [messageId, ticketId, adminUser?.id || null, adminUser?.email || '', normalizedMessage, correlationId],
    )
    await connection.execute(
      `UPDATE support_tickets
          SET user_unread = 1,
              admin_unread = 0,
              last_message_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP,
              correlation_id = ?
        WHERE id = ?`,
      [correlationId, ticketId],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
  return getSupportTicketForAdmin(db, ticketId, { markRead: false })
}

export async function closeSupportTicket(db, { ticketId, adminUser, correlationId = null }) {
  const [result] = await db.execute(
    `UPDATE support_tickets
        SET status = 'closed',
            admin_unread = 0,
            closed_at = CURRENT_TIMESTAMP,
            closed_by_admin_id = ?,
            correlation_id = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'open'`,
    [adminUser?.id || null, correlationId, ticketId],
  )
  if (!Number(result?.affectedRows || 0)) {
    const [rows] = await db.execute('SELECT id FROM support_tickets WHERE id = ? LIMIT 1', [ticketId])
    return rows?.[0] ? getSupportTicketForAdmin(db, ticketId, { markRead: false }) : null
  }
  return getSupportTicketForAdmin(db, ticketId, { markRead: false })
}
