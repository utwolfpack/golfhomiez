import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeNotificationFilter,
  normalizeNotificationPageSize,
  notificationCategoryForMessageType,
  loadUserNotificationPage,
  paginateNotificationThreads,
  shouldIncludeChallengeNotificationCandidate,
  validateMessageGroupName,
  validateNotificationMessageBody,
} from '../server/lib/notification-service.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('notification categories support messages, challenges, groups, and tournaments', () => {
  assert.equal(notificationCategoryForMessageType('message'), 'messages')
  assert.equal(notificationCategoryForMessageType('group_message'), 'messages')
  assert.equal(notificationCategoryForMessageType('challenge_request'), 'challenges')
  assert.equal(notificationCategoryForMessageType('individual_challenge'), 'challenges')
  assert.equal(notificationCategoryForMessageType('tournament_notification'), 'tournaments')
  assert.equal(normalizeNotificationFilter('unknown'), 'all')
})

test('notification paging defaults to ten and respects filter/delete state', () => {
  const threads = Array.from({ length: 23 }, (_, index) => ({
    threadId: `thread-${index + 1}`,
    category: index % 2 === 0 ? 'messages' : 'challenges',
    deletedAt: index === 2 ? '2026-08-20T12:00:00.000Z' : null,
  }))
  const firstPage = paginateNotificationThreads(threads, { filter: 'all', page: 1 })
  assert.equal(firstPage.pageSize, 10)
  assert.equal(firstPage.notifications.length, 10)
  assert.equal(firstPage.total, 22)
  assert.equal(firstPage.totalPages, 3)

  const deleted = paginateNotificationThreads(threads, { deleted: true, page: 1 })
  assert.equal(deleted.total, 1)
  assert.equal(deleted.notifications[0].threadId, 'thread-3')

  const challenges = paginateNotificationThreads(threads, { filter: 'challenges', pageSize: 1000 })
  assert.equal(challenges.notifications.every((thread) => thread.category === 'challenges'), true)
  assert.equal(challenges.pageSize, 50)
  assert.equal(normalizeNotificationPageSize(undefined), 10)
})

test('challenge creator is excluded while other participants can receive the challenge notification', () => {
  const challenge = { messageType: 'challenge_request', senderUserId: 'creator-id', senderEmail: 'creator@example.com' }
  assert.equal(shouldIncludeChallengeNotificationCandidate(challenge, { id: 'creator-id', email: 'creator@example.com' }), false)
  assert.equal(shouldIncludeChallengeNotificationCandidate(challenge, { id: 'teammate-id', email: 'teammate@example.com' }), true)
})

test('a direct conversation remains visible when the current golfer sent the only message', async () => {
  const user = { id: 'sender-id', email: 'sender@example.com', name: 'Sender' }
  const sentMessage = {
    id: 'message-1',
    threadId: 'thread-1',
    messageType: 'message',
    senderUserId: user.id,
    senderEmail: user.email,
    senderName: user.name,
    recipientUserId: 'recipient-id',
    recipientEmail: 'recipient@example.com',
    recipientName: 'Recipient',
    body: 'First message in the conversation',
    readAt: null,
    createdAt: '2026-08-20T18:00:00.000Z',
  }
  const storage = {
    async listInboxMessagesForUser() { return [] },
    async listSentInboxMessagesForUser() { return [sentMessage] },
  }
  const db = {
    async execute(sql) {
      if (sql.includes('FROM inbox_thread_user_state')) return [[]]
      if (sql.includes('FROM inbox_messages im')) return [[]]
      throw new Error(`Unexpected SQL in notification test: ${sql}`)
    },
  }

  const result = await loadUserNotificationPage(db, storage, user, { filter: 'messages' })
  assert.equal(result.total, 1)
  assert.equal(result.notifications[0].threadId, 'thread-1')
  assert.equal(result.notifications[0].messages.length, 1)
  assert.equal(result.notifications[0].unreadCount, 0)
})

test('group and message validation rejects blank/oversized values', () => {
  assert.equal(validateMessageGroupName('  Weekend   Crew  '), 'Weekend Crew')
  assert.equal(validateNotificationMessageBody('  Tee time moved to 9.  '), 'Tee time moved to 9.')
  assert.throws(() => validateMessageGroupName(''), /required/i)
  assert.throws(() => validateNotificationMessageBody(''), /required/i)
  assert.throws(() => validateNotificationMessageBody('x'.repeat(2001)), /2000/)
})

test('notification and tournament dialogue migrations are registered and npm install continues to run migrations', () => {
  const notificationMigrationSql = read('migration_scripts/20260820_075_notifications_groups_and_tournament_messaging.sql')
  const dialogueMigrationSql = read('migration_scripts/20260820_076_tournament_message_dialogue.sql')
  const migrationRegistry = read('server/migrations/index.js')
  const packageJson = JSON.parse(read('package.json'))

  assert.match(notificationMigrationSql, /CREATE TABLE IF NOT EXISTS inbox_thread_user_state/i)
  assert.match(notificationMigrationSql, /CREATE TABLE IF NOT EXISTS message_groups/i)
  assert.match(notificationMigrationSql, /CREATE TABLE IF NOT EXISTS message_group_members/i)
  assert.match(dialogueMigrationSql, /tournament_conversation_id/i)
  assert.match(dialogueMigrationSql, /CREATE TABLE IF NOT EXISTS tournament_message_threads/i)
  assert.match(dialogueMigrationSql, /CREATE TABLE IF NOT EXISTS tournament_message_thread_members/i)
  assert.match(dialogueMigrationSql, /CREATE TABLE IF NOT EXISTS tournament_message_entries/i)
  assert.match(dialogueMigrationSql, /CREATE TABLE IF NOT EXISTS tournament_message_portal_state/i)
  assert.match(migrationRegistry, /20260820_075/)
  assert.match(migrationRegistry, /20260820_076/)
  assert.match(packageJson.scripts.postinstall, /db:migrate/)
})

test('server exposes tournament dialogue, golfer-to-host replies, and correlated transaction logging', () => {
  const server = read('server/index.js')
  const service = read('server/lib/notification-service.js')
  assert.match(server, /\/api\/notifications/)
  assert.match(server, /\/api\/message-groups/)
  assert.match(server, /\/api\/host\/tournaments\/:id\/messages/)
  assert.match(server, /\/api\/organizer\/tournaments\/:id\/messages/)
  assert.match(server, /\/api\/notifications\/tournament-messages\/:messageId/)
  assert.match(server, /message-threads\/:threadId\/messages/)
  assert.match(server, /host_tournament_messages_sent/)
  assert.match(server, /golfer_tournament_message_sent_to_host/)
  assert.match(service, /createTournamentMessageThread/)
  assert.match(service, /appendTournamentPortalMessage/)
  assert.match(service, /startTournamentUserConversationFromNotification/)
  assert.match(server, /requestContext\(req\)/)
})

test('frontend uses selected-recipient tournament messages, dialogue modal, host replies, and collapsed Groups link', () => {
  const inbox = read('src/pages/Inbox.tsx')
  const nav = read('src/components/NavBar.tsx')
  const panel = read('src/components/TournamentMessagingPanel.tsx')

  assert.match(inbox, /Messages/)
  assert.match(inbox, /Challenges/)
  assert.match(inbox, /Tournaments/)
  assert.match(inbox, /Deleted notifications/)
  assert.match(inbox, /groupsOpen/)
  assert.match(inbox, /notificationGroupsLink/)
  assert.match(inbox, /'Groups'/)
  assert.match(inbox, /fetchTournamentConversation/)
  assert.match(inbox, /sendTournamentConversationMessage/)
  assert.match(inbox, /Send a message to/)
  assert.match(nav, /navNotificationBell/)
  assert.match(nav, /unreadNotificationCount/)
  assert.match(panel, /className="tournamentSectionToggleLink"/)
  assert.match(panel, /aria-expanded=\{composeOpen\}/)
  assert.match(panel, /const \[composeOpen, setComposeOpen\] = useState\(false\)/)
  assert.match(panel, /Tournament messages/)
  assert.match(panel, /tournamentMessagesNotification/)
  assert.match(panel, /Sent to \{thread\.recipients\.length\}/)
  assert.match(panel, /Reply to everyone included in this message/)
  assert.match(panel, /selectedEmails\.length === 0/)
  assert.match(panel, /messagesModalRef\.current/)
  assert.match(panel, /scrollTop = 0/)
  assert.match(panel, /focus\(\{ preventScroll: true \}\)/)
  assert.match(inbox, /groupsSectionRef\.current\?\.scrollIntoView/)
  assert.match(inbox, /groupsSectionRef\.current\?\.focus/)
  assert.match(inbox, /notificationTournamentParticipantCount/)
  assert.match(inbox, /people in this message/)
  assert.match(nav, /to="\/inbox"[\s\S]*Notifications/)
  assert.doesNotMatch(panel, /Send to selected/)
  assert.doesNotMatch(panel, /Send to all registered golfers/)
})

test('host and organizer tournament builders use collapsed Teams, Send a message, and Tournament Info disclosures', () => {
  const host = read('src/pages/HostPortal.tsx')
  const organizer = read('src/pages/OrganizerTournaments.tsx')
  const panel = read('src/components/TournamentMessagingPanel.tsx')

  assert.match(host, /const \[open, setOpen\] = useState\(false\)/)
  assert.match(host, /Teams signed up/)
  assert.match(host, /host-tournament-info-/)
  assert.match(host, /const \[tournamentInfoOpen, setTournamentInfoOpen\] = useState\(false\)/)
  assert.match(host, /!editingId \? \([\s\S]*Tournaments hosted here/)
  assert.match(organizer, /organizer-teams-signed-up-/)
  assert.match(organizer, /organizer-tournament-info-/)
  assert.match(organizer, /const \[tournamentInfoOpen, setTournamentInfoOpen\] = useState\(false\)/)
  assert.match(panel, /const \[composeOpen, setComposeOpen\] = useState\(false\)/)
  assert.match(panel, /tournament-message-compose-/)
})

test('existing logging keeps separate access, api, frontend and error files with correlation IDs', () => {
  const logger = read('server/lib/logger.js')
  assert.match(logger, /access\.log/)
  assert.match(logger, /api\.log/)
  assert.match(logger, /frontend\.log/)
  assert.match(logger, /error\.log/)
  assert.match(logger, /correlationId/)
})

test('challenge notifications support direct mobile-friendly replies without leaving Notifications', () => {
  const inbox = read('src/pages/Inbox.tsx')
  const css = read('src/index.css')

  assert.match(inbox, /challengeNotificationIsCompleted/)
  assert.match(inbox, /thread\.messageType === 'challenge_request' \|\| thread\.messageType === 'individual_challenge'/)
  assert.match(inbox, /replyToMessageId: thread\.displayMessage\.id/)
  assert.match(inbox, /notification_challenge_reply_started/)
  assert.match(inbox, /notification_challenge_reply_succeeded/)
  assert.match(inbox, /Say something to your challenge group/)
  assert.match(inbox, /Reply to your Team Challenge/)
  assert.match(inbox, /Smack talk your homiez/)
  assert.match(inbox, /notificationChallengeReplyForm/)
  assert.match(css, /\.notificationChallengeReplyForm\{/)
  assert.match(css, /\.notificationChallengeReplyForm \.button\{[\s\S]*width:100%/)
})
