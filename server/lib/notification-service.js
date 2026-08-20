import { v4 as uuidv4 } from 'uuid'
import { normalizeEmail } from './team-utils.js'

const NOTIFICATION_FILTERS = new Set(['all', 'messages', 'challenges', 'tournaments'])
const CHALLENGE_TYPES = new Set(['challenge_request', 'individual_challenge'])
const TOURNAMENT_TYPES = new Set(['tournament_notification'])
const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 50
const MAX_GROUP_NAME_LENGTH = 120
const MAX_MESSAGE_LENGTH = 2000

export function notificationCategoryForMessageType(messageType) {
  const type = String(messageType || '').trim().toLowerCase()
  if (CHALLENGE_TYPES.has(type)) return 'challenges'
  if (TOURNAMENT_TYPES.has(type)) return 'tournaments'
  return 'messages'
}

export function normalizeNotificationFilter(value) {
  const normalized = String(value || 'all').trim().toLowerCase()
  return NOTIFICATION_FILTERS.has(normalized) ? normalized : 'all'
}

export function normalizeNotificationPage(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1
}

export function normalizeNotificationPageSize(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE
  return Math.min(Math.trunc(parsed), MAX_PAGE_SIZE)
}

export function validateNotificationMessageBody(value) {
  const body = String(value || '').trim()
  if (!body) throw new Error('Message is required.')
  if (body.length > MAX_MESSAGE_LENGTH) throw new Error(`Message must be ${MAX_MESSAGE_LENGTH} characters or less.`)
  return body
}

export function validateMessageGroupName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim()
  if (!name) throw new Error('Group name is required.')
  if (name.length > MAX_GROUP_NAME_LENGTH) throw new Error(`Group name must be ${MAX_GROUP_NAME_LENGTH} characters or less.`)
  return name
}

export function notificationUserKey(user) {
  return `${String(user?.id || '').trim()}|${normalizeEmail(user?.email)}`.slice(0, 384)
}

function toIso(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

function parseJsonArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (Buffer.isBuffer(value)) value = value.toString('utf8')
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function mapNotificationRow(row) {
  return {
    id: row.id,
    threadId: row.thread_id || row.id,
    parentMessageId: row.parent_message_id || null,
    messageType: row.message_type || 'message',
    senderUserId: row.sender_user_id || null,
    senderEmail: row.sender_email || '',
    senderName: row.sender_name || null,
    senderRole: row.sender_role || null,
    recipientUserId: row.recipient_user_id || null,
    recipientEmail: row.recipient_email || '',
    proposerTeamId: row.proposer_team_id || null,
    proposerTeamName: row.proposer_team_name || null,
    challengedTeamId: row.challenged_team_id || null,
    challengedTeamName: row.challenged_team_name || null,
    challengeStatus: row.challenge_status || null,
    challengeDate: toIso(row.challenge_date)?.slice(0, 10) || null,
    challengeState: row.challenge_state || null,
    challengeCourse: row.challenge_course || null,
    challengeTeeColor: row.challenge_tee_color || 'white',
    challengeScoringType: row.challenge_scoring_type || 'stroke_play',
    challengePointsPerHole: row.challenge_points_per_hole ?? null,
    proposerTeamScore: row.proposer_team_score ?? null,
    challengedTeamScore: row.challenged_team_score ?? null,
    proposerTeamHoles: parseJsonArray(row.proposer_team_holes_json),
    challengedTeamHoles: parseJsonArray(row.challenged_team_holes_json),
    individualChallengeParticipants: parseJsonArray(row.individual_participants_json),
    groupId: row.group_id || null,
    groupName: row.group_name || null,
    tournamentId: row.tournament_id || null,
    tournamentConversationId: row.tournament_conversation_id || null,
    tournamentName: row.tournament_name || null,
    eventDate: toIso(row.event_date)?.slice(0, 10) || null,
    actionUrl: row.action_url || null,
    correlationId: row.correlation_id || null,
    body: row.message_body || '',
    readAt: toIso(row.read_at),
    createdAt: toIso(row.created_at),
  }
}

function messageTimestamp(message) {
  const parsed = Date.parse(String(message?.createdAt || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function isSentByUser(message, user) {
  const email = normalizeEmail(user?.email)
  return String(message?.senderUserId || '') === String(user?.id || '') || normalizeEmail(message?.senderEmail) === email
}

export function shouldIncludeChallengeNotificationCandidate(message, user) {
  return notificationCategoryForMessageType(message?.messageType) === 'challenges' && !isSentByUser(message, user)
}

function buildThreadActionUrl(message, threadId) {
  if (message?.actionUrl) return message.actionUrl
  if (notificationCategoryForMessageType(message?.messageType) === 'challenges') return `/challenges?thread=${encodeURIComponent(threadId)}`
  return null
}

function buildNotificationThreads({ candidateMessages, allMessages, stateByThread, user }) {
  const candidateThreadIds = new Set(candidateMessages.map((message) => String(message.threadId || message.id)))
  const grouped = new Map()
  allMessages.forEach((message) => {
    const threadId = String(message.threadId || message.id)
    if (!candidateThreadIds.has(threadId)) return
    const current = grouped.get(threadId) || []
    current.push(message)
    grouped.set(threadId, current)
  })

  return Array.from(grouped.entries()).map(([threadId, messages]) => {
    const sortedMessages = [...messages].sort((a, b) => messageTimestamp(a) - messageTimestamp(b))
    const latestMessage = sortedMessages[sortedMessages.length - 1]
    const firstMessage = sortedMessages[0] || latestMessage
    const state = stateByThread.get(threadId) || {}
    const lastReadAtMs = state.lastReadAt ? Date.parse(state.lastReadAt) : 0
    const incomingMessages = sortedMessages.filter((message) => !isSentByUser(message, user))
    const unreadCount = incomingMessages.filter((message) => {
      if (lastReadAtMs > 0) return messageTimestamp(message) > lastReadAtMs
      return !message.readAt
    }).length
    return {
      threadId,
      category: notificationCategoryForMessageType(firstMessage.messageType),
      messageType: firstMessage.messageType,
      displayMessage: latestMessage,
      messages: sortedMessages,
      unreadCount,
      deletedAt: state.deletedAt || null,
      lastReadAt: state.lastReadAt || null,
      actionUrl: buildThreadActionUrl(firstMessage, threadId),
      latestActivityAt: latestMessage?.createdAt || firstMessage?.createdAt || null,
    }
  }).sort((a, b) => Date.parse(String(b.latestActivityAt || 0)) - Date.parse(String(a.latestActivityAt || 0)))
}

export function paginateNotificationThreads(threads, options = {}) {
  const filter = normalizeNotificationFilter(options.filter)
  const deleted = options.deleted === true
  const page = normalizeNotificationPage(options.page)
  const pageSize = normalizeNotificationPageSize(options.pageSize)
  const filtered = threads.filter((thread) => {
    if (deleted !== Boolean(thread.deletedAt)) return false
    return filter === 'all' || thread.category === filter
  })
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  return {
    notifications: filtered.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  }
}

async function loadThreadStateMap(db, user) {
  const [rows] = await db.execute(
    'SELECT thread_id, last_read_at, deleted_at FROM inbox_thread_user_state WHERE user_key = ?',
    [notificationUserKey(user)],
  )
  return new Map(rows.map((row) => [String(row.thread_id), { lastReadAt: toIso(row.last_read_at), deletedAt: toIso(row.deleted_at) }]))
}

async function listGroupMessagesForUser(db, user) {
  const email = normalizeEmail(user?.email)
  if (!email) return []
  const [rows] = await db.execute(
    `SELECT im.*, mg.name AS group_name
       FROM inbox_messages im
       JOIN message_group_members mgm ON mgm.group_id = im.group_id
       JOIN message_groups mg ON mg.id = im.group_id
      WHERE im.message_type = 'group_message'
        AND LOWER(mgm.email) = ?
        AND im.created_at >= mgm.joined_at
        AND (mgm.left_at IS NULL OR im.created_at <= mgm.left_at)
      ORDER BY im.created_at DESC`,
    [email],
  )
  return rows.map(mapNotificationRow)
}

export async function loadUserNotificationPage(db, storage, user, options = {}) {
  const [receivedMessages, sentMessages, groupMessages, stateByThread] = await Promise.all([
    storage.listInboxMessagesForUser(user),
    storage.listSentInboxMessagesForUser(user),
    listGroupMessagesForUser(db, user),
    loadThreadStateMap(db, user),
  ])

  const receivedNotificationCandidates = receivedMessages.filter((message) => notificationCategoryForMessageType(message.messageType) !== 'challenges' || shouldIncludeChallengeNotificationCandidate(message, user))
  const sentDirectMessageCandidates = sentMessages.filter((message) => String(message?.messageType || '').trim().toLowerCase() === 'message')
  const participantChallengeCandidates = sentMessages.filter((message) => shouldIncludeChallengeNotificationCandidate(message, user))
  const candidateMessages = [...receivedNotificationCandidates, ...sentDirectMessageCandidates, ...participantChallengeCandidates, ...groupMessages]
  const allById = new Map()
  ;[...receivedMessages, ...sentMessages, ...groupMessages].forEach((message) => {
    if (message?.id) allById.set(String(message.id), message)
  })
  const threads = buildNotificationThreads({ candidateMessages, allMessages: Array.from(allById.values()), stateByThread, user })
  const page = paginateNotificationThreads(threads, options)
  const unreadCount = threads.filter((thread) => !thread.deletedAt).reduce((sum, thread) => sum + Number(thread.unreadCount || 0), 0)
  const categoryCounts = {
    all: threads.filter((thread) => !thread.deletedAt).length,
    messages: threads.filter((thread) => !thread.deletedAt && thread.category === 'messages').length,
    challenges: threads.filter((thread) => !thread.deletedAt && thread.category === 'challenges').length,
    tournaments: threads.filter((thread) => !thread.deletedAt && thread.category === 'tournaments').length,
    deleted: threads.filter((thread) => Boolean(thread.deletedAt)).length,
  }
  return { ...page, unreadCount, categoryCounts }
}

export async function getUserNotificationSummary(db, storage, user) {
  const result = await loadUserNotificationPage(db, storage, user, { page: 1, pageSize: 1 })
  return { unreadCount: result.unreadCount, categoryCounts: result.categoryCounts }
}

export async function setNotificationThreadState(db, user, threadId, state = {}) {
  const normalizedThreadId = String(threadId || '').trim()
  if (!normalizedThreadId) throw new Error('Notification thread is required.')
  const userKey = notificationUserKey(user)
  const markRead = state.markRead === true
  const hasDeleted = Object.prototype.hasOwnProperty.call(state, 'deleted')
  const deleted = state.deleted === true
  await db.execute(
    `INSERT INTO inbox_thread_user_state (user_key, thread_id, last_read_at, deleted_at, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       last_read_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_read_at END,
       deleted_at = CASE WHEN ? THEN ? ELSE deleted_at END,
       updated_at = CURRENT_TIMESTAMP`,
    [
      userKey,
      normalizedThreadId,
      markRead ? new Date() : null,
      hasDeleted && deleted ? new Date() : null,
      markRead ? 1 : 0,
      hasDeleted ? 1 : 0,
      hasDeleted && deleted ? new Date() : null,
    ],
  )
  if (hasDeleted && !deleted) {
    await db.execute('UPDATE inbox_thread_user_state SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_key = ? AND thread_id = ?', [userKey, normalizedThreadId])
  }
  const [[row] = []] = await db.execute('SELECT thread_id, last_read_at, deleted_at FROM inbox_thread_user_state WHERE user_key = ? AND thread_id = ? LIMIT 1', [userKey, normalizedThreadId])
  return { threadId: normalizedThreadId, lastReadAt: toIso(row?.last_read_at), deletedAt: toIso(row?.deleted_at) }
}

export async function listMessageGroups(db, user) {
  const email = normalizeEmail(user?.email)
  const [rows] = await db.execute(
    `SELECT mg.*,
            mgm.joined_at AS viewer_joined_at,
            mgm.left_at AS viewer_left_at
       FROM message_groups mg
       JOIN message_group_members mgm ON mgm.group_id = mg.id AND LOWER(mgm.email) = ?
      ORDER BY mg.updated_at DESC, mg.created_at DESC`,
    [email],
  )
  if (!rows.length) return []
  const groupIds = rows.map((row) => row.id)
  const placeholders = groupIds.map(() => '?').join(', ')
  const [members] = await db.execute(
    `SELECT group_id, user_id, email, name, joined_at, left_at
       FROM message_group_members
      WHERE group_id IN (${placeholders})
      ORDER BY joined_at ASC, email ASC`,
    groupIds,
  )
  const byGroup = new Map()
  members.forEach((member) => {
    const current = byGroup.get(String(member.group_id)) || []
    current.push({
      userId: member.user_id || null,
      email: member.email,
      name: member.name || null,
      joinedAt: toIso(member.joined_at),
      leftAt: toIso(member.left_at),
      active: !member.left_at,
    })
    byGroup.set(String(member.group_id), current)
  })
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdByUserId: row.created_by_user_id || null,
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    viewerActive: !row.viewer_left_at,
    viewerJoinedAt: toIso(row.viewer_joined_at),
    viewerLeftAt: toIso(row.viewer_left_at),
    canManage: String(row.created_by_user_id || '') === String(user?.id || '') || normalizeEmail(row.created_by_email) === email,
    members: byGroup.get(String(row.id)) || [],
  }))
}

export async function createMessageGroup(db, user, { name, members = [] }) {
  const groupName = validateMessageGroupName(name)
  const creatorEmail = normalizeEmail(user?.email)
  const id = uuidv4()
  await db.execute(
    `INSERT INTO message_groups (id, name, created_by_user_id, created_by_email, created_by_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, groupName, user?.id || null, creatorEmail, user?.name || null],
  )
  const normalizedMembers = new Map()
  normalizedMembers.set(creatorEmail, { id: user?.id || null, email: creatorEmail, name: user?.name || null })
  members.forEach((member) => {
    const email = normalizeEmail(member?.email)
    if (email) normalizedMembers.set(email, { id: member?.id || null, email, name: member?.name || null })
  })
  for (const member of normalizedMembers.values()) {
    await db.execute(
      `INSERT INTO message_group_members (group_id, user_id, email, name, joined_at, left_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(6), NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), name = VALUES(name), joined_at = CURRENT_TIMESTAMP(6), left_at = NULL, updated_at = CURRENT_TIMESTAMP`,
      [id, member.id || null, member.email, member.name || null],
    )
  }
  return id
}

async function requireManageableGroup(db, groupId, user) {
  const [[group] = []] = await db.execute('SELECT * FROM message_groups WHERE id = ? LIMIT 1', [String(groupId || '')])
  if (!group) return null
  const canManage = String(group.created_by_user_id || '') === String(user?.id || '') || normalizeEmail(group.created_by_email) === normalizeEmail(user?.email)
  return canManage ? group : null
}

export async function addMessageGroupMember(db, groupId, user, member) {
  const group = await requireManageableGroup(db, groupId, user)
  if (!group) return null
  const email = normalizeEmail(member?.email)
  if (!email) throw new Error('A valid member email is required.')
  await db.execute(
    `INSERT INTO message_group_members (group_id, user_id, email, name, joined_at, left_at, removed_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(6), NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), name = VALUES(name), joined_at = CURRENT_TIMESTAMP(6), left_at = NULL, removed_by_user_id = NULL, updated_at = CURRENT_TIMESTAMP`,
    [group.id, member?.id || null, email, member?.name || null],
  )
  await db.execute('UPDATE message_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [group.id])
  return group
}

async function insertGroupMessage(db, group, sender, body, correlationId = null) {
  const id = uuidv4()
  const threadId = `group:${group.id}`
  await db.execute(
    `INSERT INTO inbox_messages
      (id, thread_id, parent_message_id, message_type, sender_user_id, sender_email, sender_name, sender_role,
       recipient_user_id, recipient_email, group_id, message_body, correlation_id, created_at)
     VALUES (?, ?, NULL, 'group_message', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, CURRENT_TIMESTAMP(6))`,
    [id, threadId, sender?.id || null, normalizeEmail(sender?.email), sender?.name || null, sender?.role || 'user', group.id, body, correlationId || null],
  )
  await db.execute('UPDATE message_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [group.id])
  return { id, threadId }
}

export async function removeMessageGroupMember(db, groupId, user, memberEmail, correlationId = null) {
  const group = await requireManageableGroup(db, groupId, user)
  if (!group) return null
  const email = normalizeEmail(memberEmail)
  if (!email) throw new Error('Member email is required.')
  if (email === normalizeEmail(group.created_by_email)) throw new Error('The group creator cannot be removed from the group.')
  const [[member] = []] = await db.execute('SELECT * FROM message_group_members WHERE group_id = ? AND LOWER(email) = ? AND left_at IS NULL LIMIT 1', [group.id, email])
  if (!member) return { group, removed: false }
  const actorName = user?.name || normalizeEmail(user?.email) || 'Group owner'
  const memberLabel = member.name || member.email
  await insertGroupMessage(db, group, { ...user, role: 'system' }, `${memberLabel} was removed from ${group.name} by ${actorName}.`, correlationId)
  await db.execute(
    'UPDATE message_group_members SET left_at = CURRENT_TIMESTAMP(6), removed_by_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ? AND LOWER(email) = ?',
    [user?.id || null, group.id, email],
  )
  return { group, removed: true }
}

export async function sendMessageGroupMessage(db, groupId, user, body, correlationId = null) {
  const normalizedBody = validateNotificationMessageBody(body)
  const email = normalizeEmail(user?.email)
  const [[membership] = []] = await db.execute(
    `SELECT mg.*, mgm.left_at
       FROM message_groups mg
       JOIN message_group_members mgm ON mgm.group_id = mg.id
      WHERE mg.id = ? AND LOWER(mgm.email) = ?
      LIMIT 1`,
    [String(groupId || ''), email],
  )
  if (!membership) return { status: 404, message: 'Message group not found.' }
  if (membership.left_at) return { status: 403, message: 'You are no longer a member of this message group.' }
  const sent = await insertGroupMessage(db, membership, { ...user, role: 'user' }, normalizedBody, correlationId)
  return { status: 201, ...sent }
}

export async function createTournamentNotification(db, {
  sender,
  recipient,
  tournament,
  body,
  actionUrl,
  correlationId = null,
  senderRole = 'host',
  conversationId = null,
  threadId: providedThreadId = null,
  parentMessageId = null,
}) {
  const normalizedBody = validateNotificationMessageBody(body)
  const id = uuidv4()
  const recipientEmail = normalizeEmail(recipient?.email)
  const recipientKey = String(recipient?.id || recipientEmail).replace(/[^A-Za-z0-9._:-]/g, '_')
  const threadId = String(providedThreadId || `tournament:${tournament.id}:${recipientKey}`).slice(0, 191)
  await db.execute(
    `INSERT INTO inbox_messages
      (id, thread_id, parent_message_id, message_type, sender_user_id, sender_email, sender_name, sender_role,
       recipient_user_id, recipient_email, tournament_id, tournament_conversation_id, tournament_name, event_date, action_url, message_body, correlation_id, created_at)
     VALUES (?, ?, ?, 'tournament_notification', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))`,
    [
      id,
      threadId,
      parentMessageId || null,
      sender?.id || null,
      normalizeEmail(sender?.email),
      sender?.name || null,
      senderRole,
      recipient?.id || null,
      recipientEmail,
      tournament.id,
      conversationId || null,
      tournament.name || 'Tournament',
      tournament.startDate || tournament.start_date || null,
      actionUrl || null,
      normalizedBody,
      correlationId || null,
    ],
  )
  return { id, threadId, conversationId: conversationId || null }
}

function tournamentPortalViewerKey(viewer = {}) {
  const role = String(viewer.role || 'portal').trim().toLowerCase()
  return `${role}|${String(viewer.id || '').trim()}|${normalizeEmail(viewer.email)}`.slice(0, 384)
}

function mapTournamentMessageThreadRow(row) {
  if (!row) return null
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    tournamentName: row.tournament_name || 'Tournament',
    eventDate: toIso(row.event_date)?.slice(0, 10) || null,
    actionUrl: row.action_url || null,
    createdByUserId: row.created_by_user_id || null,
    createdByEmail: row.created_by_email || '',
    createdByName: row.created_by_name || null,
    createdByRole: row.created_by_role || 'host',
    hostUserId: row.host_user_id || null,
    hostEmail: row.host_email || '',
    hostName: row.host_name || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

function mapTournamentMessageMemberRow(row) {
  return {
    userId: row.user_id || null,
    email: row.email || '',
    name: row.name || null,
    inboxThreadId: row.inbox_thread_id || '',
    createdAt: toIso(row.created_at),
  }
}

function mapTournamentMessageEntryRow(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderUserId: row.sender_user_id || null,
    senderEmail: row.sender_email || '',
    senderName: row.sender_name || null,
    senderRole: row.sender_role || 'user',
    body: row.message_body || '',
    correlationId: row.correlation_id || null,
    createdAt: toIso(row.created_at),
  }
}

async function insertTournamentMessageEntry(db, threadId, sender, senderRole, body, correlationId = null) {
  const normalizedBody = validateNotificationMessageBody(body)
  const id = uuidv4()
  await db.execute(
    `INSERT INTO tournament_message_entries
      (id, thread_id, sender_user_id, sender_email, sender_name, sender_role, message_body, correlation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))`,
    [
      id,
      threadId,
      sender?.id || null,
      normalizeEmail(sender?.email),
      sender?.name || null,
      senderRole || 'user',
      normalizedBody,
      correlationId || null,
    ],
  )
  await db.execute('UPDATE tournament_message_threads SET updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [threadId])
  return id
}

async function loadTournamentMessageThreadDetail(db, threadId) {
  const [[threadRow] = []] = await db.execute('SELECT * FROM tournament_message_threads WHERE id = ? LIMIT 1', [String(threadId || '')])
  if (!threadRow) return null
  const [memberRows] = await db.execute(
    'SELECT * FROM tournament_message_thread_members WHERE thread_id = ? ORDER BY name ASC, email ASC',
    [threadRow.id],
  )
  const [entryRows] = await db.execute(
    'SELECT * FROM tournament_message_entries WHERE thread_id = ? ORDER BY created_at ASC, id ASC',
    [threadRow.id],
  )
  return {
    ...mapTournamentMessageThreadRow(threadRow),
    recipients: memberRows.map(mapTournamentMessageMemberRow),
    messages: entryRows.map(mapTournamentMessageEntryRow),
  }
}

export async function createTournamentMessageThread(db, {
  tournament,
  sender,
  senderRole = 'host',
  host,
  recipients = [],
  body,
  actionUrl = null,
  correlationId = null,
}) {
  const normalizedBody = validateNotificationMessageBody(body)
  const uniqueRecipients = new Map()
  for (const recipient of Array.isArray(recipients) ? recipients : []) {
    const email = normalizeEmail(recipient?.email)
    if (!email) continue
    uniqueRecipients.set(email, { id: recipient?.id || null, email, name: recipient?.name || null })
  }
  if (!uniqueRecipients.size) throw new Error('Select at least one registered golfer to receive the tournament message.')

  const threadId = uuidv4()
  await db.execute(
    `INSERT INTO tournament_message_threads
      (id, tournament_id, tournament_name, event_date, action_url,
       created_by_user_id, created_by_email, created_by_name, created_by_role,
       host_user_id, host_email, host_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))`,
    [
      threadId,
      tournament.id,
      tournament.name || 'Tournament',
      tournament.startDate || tournament.start_date || null,
      actionUrl || null,
      sender?.id || null,
      normalizeEmail(sender?.email),
      sender?.name || null,
      senderRole,
      host?.id || null,
      normalizeEmail(host?.email),
      host?.name || null,
    ],
  )
  await insertTournamentMessageEntry(db, threadId, sender, senderRole, normalizedBody, correlationId)

  const notificationRows = []
  for (const recipient of uniqueRecipients.values()) {
    const recipientKey = String(recipient.id || recipient.email).replace(/[^A-Za-z0-9._:-]/g, '_')
    const inboxThreadId = `tournament:${tournament.id}:${threadId}:${recipientKey}`.slice(0, 191)
    await db.execute(
      `INSERT INTO tournament_message_thread_members
        (thread_id, user_id, email, name, inbox_thread_id, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))`,
      [threadId, recipient.id || null, recipient.email, recipient.name || null, inboxThreadId],
    )
    notificationRows.push(await createTournamentNotification(db, {
      sender,
      recipient,
      tournament,
      body: normalizedBody,
      actionUrl,
      correlationId,
      senderRole,
      conversationId: threadId,
      threadId: inboxThreadId,
    }))
  }

  return {
    threadId,
    sentCount: uniqueRecipients.size,
    recipientEmails: [...uniqueRecipients.keys()],
    notifications: notificationRows,
    conversation: await loadTournamentMessageThreadDetail(db, threadId),
  }
}

export async function listTournamentMessageThreads(db, tournamentId, viewer = {}) {
  const [threadRows] = await db.execute(
    'SELECT * FROM tournament_message_threads WHERE tournament_id = ? ORDER BY updated_at DESC, created_at DESC',
    [String(tournamentId || '')],
  )
  const threads = []
  for (const row of threadRows) {
    const detail = await loadTournamentMessageThreadDetail(db, row.id)
    if (detail) threads.push(detail)
  }

  let lastReadAt = null
  const viewerKey = tournamentPortalViewerKey(viewer)
  if (viewerKey) {
    const [[state] = []] = await db.execute(
      'SELECT last_read_at FROM tournament_message_portal_state WHERE viewer_key = ? AND tournament_id = ? LIMIT 1',
      [viewerKey, String(tournamentId || '')],
    )
    lastReadAt = toIso(state?.last_read_at)
  }
  const lastReadMs = lastReadAt ? Date.parse(lastReadAt) : 0
  const isHostViewer = String(viewer?.role || '').toLowerCase() === 'host'
  const unreadCount = isHostViewer
    ? threads.reduce((total, thread) => total + thread.messages.filter((message) => {
        if (String(message.senderRole || '').toLowerCase() !== 'user') return false
        const createdMs = Date.parse(String(message.createdAt || ''))
        return Number.isFinite(createdMs) && (!lastReadMs || createdMs > lastReadMs)
      }).length, 0)
    : 0

  return {
    threads,
    unreadCount,
    totalThreads: threads.length,
    totalMessages: threads.reduce((total, thread) => total + thread.messages.length, 0),
    lastReadAt,
  }
}

export async function markTournamentMessagesRead(db, tournamentId, viewer = {}) {
  const viewerKey = tournamentPortalViewerKey(viewer)
  if (!viewerKey) throw new Error('Tournament message viewer is required.')
  await db.execute(
    `INSERT INTO tournament_message_portal_state (viewer_key, tournament_id, last_read_at, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))
     ON DUPLICATE KEY UPDATE last_read_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6)`,
    [viewerKey, String(tournamentId || '')],
  )
  return { tournamentId: String(tournamentId || ''), lastReadAt: new Date().toISOString() }
}

export async function appendTournamentPortalMessage(db, {
  tournamentId,
  threadId,
  sender,
  senderRole = 'host',
  body,
  correlationId = null,
}) {
  const conversation = await loadTournamentMessageThreadDetail(db, threadId)
  if (!conversation || String(conversation.tournamentId) !== String(tournamentId || '')) return null
  const normalizedBody = validateNotificationMessageBody(body)
  const entryId = await insertTournamentMessageEntry(db, conversation.id, sender, senderRole, normalizedBody, correlationId)

  for (const recipient of conversation.recipients) {
    await createTournamentNotification(db, {
      sender,
      recipient,
      tournament: {
        id: conversation.tournamentId,
        name: conversation.tournamentName,
        startDate: conversation.eventDate,
      },
      body: normalizedBody,
      actionUrl: conversation.actionUrl,
      correlationId,
      senderRole,
      conversationId: conversation.id,
      threadId: recipient.inboxThreadId,
      parentMessageId: entryId,
    })
  }
  return loadTournamentMessageThreadDetail(db, conversation.id)
}

export async function getTournamentMessageConversationForUser(db, conversationId, user) {
  const email = normalizeEmail(user?.email)
  if (!email || !conversationId) return null
  const [[membership] = []] = await db.execute(
    'SELECT thread_id FROM tournament_message_thread_members WHERE thread_id = ? AND LOWER(email) = ? LIMIT 1',
    [String(conversationId), email],
  )
  if (!membership) return null
  return loadTournamentMessageThreadDetail(db, conversationId)
}

export async function appendTournamentUserMessage(db, {
  conversationId,
  user,
  body,
  correlationId = null,
}) {
  const conversation = await getTournamentMessageConversationForUser(db, conversationId, user)
  if (!conversation) return null
  await insertTournamentMessageEntry(db, conversation.id, user, 'user', body, correlationId)
  return loadTournamentMessageThreadDetail(db, conversation.id)
}

export async function startTournamentUserConversationFromNotification(db, {
  notification,
  user,
  host,
  body,
  correlationId = null,
}) {
  if (!notification || notification.messageType !== 'tournament_notification') return null
  const userEmail = normalizeEmail(user?.email)
  if (!userEmail) throw new Error('A signed-in golfer email is required.')
  const hostEmail = normalizeEmail(host?.email)
  if (!hostEmail) throw new Error('The tournament host does not have an email address available for messages.')

  if (notification.tournamentConversationId) {
    return appendTournamentUserMessage(db, {
      conversationId: notification.tournamentConversationId,
      user,
      body,
      correlationId,
    })
  }

  const threadId = uuidv4()
  await db.execute(
    `INSERT INTO tournament_message_threads
      (id, tournament_id, tournament_name, event_date, action_url,
       created_by_user_id, created_by_email, created_by_name, created_by_role,
       host_user_id, host_email, host_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, ?, ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))`,
    [
      threadId,
      notification.tournamentId,
      notification.tournamentName || 'Tournament',
      notification.eventDate || null,
      notification.actionUrl || null,
      user?.id || null,
      userEmail,
      user?.name || null,
      host?.id || null,
      hostEmail,
      host?.name || null,
    ],
  )
  await db.execute(
    `INSERT INTO tournament_message_thread_members
      (thread_id, user_id, email, name, inbox_thread_id, created_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))`,
    [threadId, user?.id || null, userEmail, user?.name || null, notification.threadId || notification.id],
  )

  if (notification.body) {
    await insertTournamentMessageEntry(
      db,
      threadId,
      {
        id: notification.senderUserId || null,
        email: notification.senderEmail || '',
        name: notification.senderName || notification.tournamentName || 'GolfHomiez',
      },
      notification.senderRole || 'system',
      notification.body,
      notification.correlationId || correlationId,
    )
  }
  await db.execute(
    `UPDATE inbox_messages
        SET tournament_conversation_id = ?
      WHERE thread_id = ?
        AND tournament_id = ?
        AND (recipient_user_id = ? OR LOWER(recipient_email) = ?)`,
    [threadId, notification.threadId || notification.id, notification.tournamentId, user?.id || '', userEmail],
  )
  await insertTournamentMessageEntry(db, threadId, user, 'user', body, correlationId)
  return loadTournamentMessageThreadDetail(db, threadId)
}
