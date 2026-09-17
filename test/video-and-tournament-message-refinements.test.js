import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_MIGRATIONS } from '../server/migrations/index.js'
import { getTournamentMessageUnreadSummary, listTournamentUnreadMessageItems, markTournamentMessageRead, markTournamentMessageThreadRead } from '../server/lib/notification-service.js'

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('marketing video libraries use compact two-column cards and top quick links before the page description', () => {
  const page = read('src/pages/MarketingVideos.tsx')
  const css = read('src/index.css')

  assert.match(page, /className="marketingVideoQuickLinks"/)
  assert.match(page, /helper_video_quick_link_clicked/)
  assert.match(page, /section\.relativeLink/)
  const quickLinksPosition = page.indexOf('className="marketingVideoQuickLinks"')
  const descriptionPosition = page.indexOf('<p>{description}</p>')
  assert.ok(quickLinksPosition >= 0 && descriptionPosition > quickLinksPosition, 'quick links should appear above the page statement')
  assert.match(css, /\.marketingVideoLibraryStack\{[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(css, /@media \(max-width:640px\)[\s\S]*\.marketingVideoLibraryStack\{[\s\S]*grid-template-columns:1fr/)
  assert.match(css, /\.marketingVideoLibraryFrameWrap--short\{[\s\S]*width:min\(100%,280px\)/)
})

test('host and organizer tournament message threads are collapsed, single-expand, newest-first, and expose unread badges', () => {
  const panel = read('src/components/TournamentMessagingPanel.tsx')
  const accounts = read('src/lib/accounts.ts')
  const server = read('server/index.js')
  const service = read('server/lib/notification-service.js')
  const css = read('src/index.css')

  assert.match(panel, /const \[expandedThreadId, setExpandedThreadId\] = useState<string \| null>\(null\)/)
  assert.match(panel, /expandedThreadId === thread\.id/)
  assert.match(panel, /setExpandedThreadId\(opening \? thread\.id : null\)/)
  assert.match(panel, /tournamentMessageThreadSummaryDate/)
  assert.match(panel, /tournamentMessageThreadSummaryAttendees/)
  assert.match(panel, /!expanded && unreadCount > 0/)
  assert.match(panel, /tournamentMessageThreadUnread/)
  assert.match(panel, /markHostTournamentMessageThreadRead/)
  assert.match(panel, /markOrganizerTournamentMessageThreadRead/)
  assert.match(panel, /timestampMs\(b\.createdAt\) - timestampMs\(a\.createdAt\)/)
  assert.match(service, /ORDER BY created_at DESC, id DESC/)
  assert.match(service, /role === 'host' \|\| role === 'organizer'/)
  assert.match(accounts, /message-threads\/\$\{encodeURIComponent\(threadId\)\}\/read/)
  assert.match(server, /host_tournament_message_thread_marked_read/)
  assert.match(server, /organizer_tournament_message_thread_marked_read/)
  assert.match(css, /\.tournamentMessageThreadSummary\{/)
  assert.match(css, /\.tournamentMessageThreadUnread\{/)
})

test('thread read-state migration is registered and keeps npm install migration flow intact', () => {
  const migration = APP_MIGRATIONS.find((entry) => entry.version === '20260917_092')
  const sql = read('migration_scripts/20260917_092_tournament_message_thread_read_state.sql')
  const packageJson = JSON.parse(read('package.json'))

  assert.ok(migration)
  assert.equal(migration.name, 'tournament_message_thread_read_state')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tournament_message_thread_portal_state/i)
  assert.match(sql, /PRIMARY KEY \(viewer_key, thread_id\)/i)
  assert.match(sql, /FOREIGN KEY \(thread_id\) REFERENCES tournament_message_threads\(id\) ON DELETE CASCADE/i)
  assert.match(packageJson.scripts.postinstall, /db:migrate/)
})


test('host and organizer tournament work areas show tournament context and opening messages also expands compose', () => {
  const hostPortal = read('src/pages/HostPortal.tsx')
  const organizerPortal = read('src/pages/OrganizerTournaments.tsx')
  const panel = read('src/components/TournamentMessagingPanel.tsx')
  const css = read('src/index.css')

  assert.match(hostPortal, /className="tournamentWorkingContext"[\s\S]*tournament\.name[\s\S]*formatFriendlyDate\(tournament\.startDate\)[\s\S]*Teams signed up/)
  assert.match(organizerPortal, /className="tournamentWorkingContext"[\s\S]*tournament\.name[\s\S]*formatFriendlyDate\(tournament\.startDate\)[\s\S]*Teams signed up/)
  assert.match(panel, /async function openMessages\(targetThreadId: string \| null = null, targetMessageId: string \| null = null\) \{[\s\S]*setComposeOpen\(true\)[\s\S]*setMessagesOpen\(true\)/)
  assert.match(panel, /autoOpenThreadId\?: string \| null/)
  assert.match(panel, /setExpandedThreadId\(targetThread\.id\)/)
  assert.doesNotMatch(panel, /<p>\{tournament\.name\}<\/p>/)
  assert.match(css, /\.tournamentWorkingContext\{/)
})

test('host top-level unread control opens a message modal and selecting a row opens the exact thread', () => {
  const portal = read('src/pages/HostPortal.tsx')
  const accounts = read('src/lib/accounts.ts')
  const server = read('server/index.js')
  const styles = read('src/index.css')

  assert.match(portal, /setUnreadTournamentMessagesOpen\(true\)/)
  assert.match(portal, /Unread tournament messages/)
  assert.match(portal, /Message date/)
  assert.match(portal, /Tournament date/)
  assert.match(portal, /markHostTournamentMessageRead\(item\.tournamentId, item\.threadId, item\.messageId\)/)
  assert.match(portal, /startEditing\(tournament, \{ openMessages: true, openThreadId: item\.threadId, openMessageId: item\.messageId \}\)/)
  assert.match(portal, /autoOpenMessageId=\{autoOpenTournamentMessagesId === tournament\.id \? autoOpenTournamentMessageId : null\}/)
  assert.doesNotMatch(portal, /showUnreadTournamentMessagesOnly/)
  assert.match(accounts, /unreadMessages: HostTournamentUnreadMessage\[\]/)
  assert.match(server, /listTournamentUnreadMessageItems/)
  assert.match(server, /unreadMessages/)
  assert.match(styles, /\.hostTournamentUnreadModal\{/)
  assert.match(styles, /\.hostTournamentUnreadMessageLine\{/)
})

test('unread message item query returns each unread golfer message newest-first with thread identity', async () => {
  const calls = []
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params })
      return [[
        {
          message_id: 'message-2',
          thread_id: 'thread-9',
          tournament_id: 'tournament-1',
          sender_email: 'Golfer@Example.com',
          sender_name: 'Golfer Two',
          message_body: 'Can you confirm my tee time?',
          created_at: '2026-09-17T15:30:00.000Z',
        },
      ]]
    },
  }

  const items = await listTournamentUnreadMessageItems(
    db,
    ['tournament-1'],
    { role: 'host', id: 'host-1', email: 'host@example.com' },
  )

  assert.equal(items.length, 1)
  assert.equal(items[0].messageId, 'message-2')
  assert.equal(items[0].threadId, 'thread-9')
  assert.equal(items[0].tournamentId, 'tournament-1')
  assert.equal(items[0].senderEmail, 'golfer@example.com')
  assert.equal(items[0].messagePreview, 'Can you confirm my tee time?')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].params[0], 'host|host-1|host@example.com')
  assert.equal(calls[0].params[1], 'host|host-1|host@example.com')
  assert.equal(calls[0].params[2], 'host|host-1|host@example.com')
  assert.match(calls[0].sql, /LOWER\(COALESCE\(e\.sender_role, ''\)\) = 'user'/)
  assert.match(calls[0].sql, /tournament_message_thread_portal_state/)
  assert.match(calls[0].sql, /tournament_message_entry_portal_state/)
  assert.match(calls[0].sql, /es\.message_id IS NULL/)
  assert.match(calls[0].sql, /ORDER BY e\.created_at DESC, e\.id DESC/)
})

test('organizer unread summary counts golfer replies and thread read state can be persisted independently', async () => {
  const summaryCalls = []
  const summaryDb = {
    async execute(sql, params) {
      summaryCalls.push({ sql, params })
      return [[{ tournament_id: 'tournament-1', unread_count: 2 }]]
    },
  }
  const summary = await getTournamentMessageUnreadSummary(
    summaryDb,
    ['tournament-1'],
    { role: 'organizer', id: 'organizer-1', email: 'organizer@example.com' },
  )
  assert.equal(summary.totalUnread, 2)
  assert.equal(summary.byTournament['tournament-1'], 2)
  assert.equal(summaryCalls[0].params[0], 'organizer|organizer-1|organizer@example.com')
  assert.equal(summaryCalls[0].params[1], 'organizer|organizer-1|organizer@example.com')
  assert.equal(summaryCalls[0].params[2], 'organizer|organizer-1|organizer@example.com')

  const threadCalls = []
  const threadDb = {
    async execute(sql, params) {
      threadCalls.push({ sql, params })
      if (/SELECT id FROM tournament_message_threads/.test(sql)) return [[{ id: 'thread-1' }]]
      if (/INSERT INTO tournament_message_thread_portal_state/.test(sql)) return [{ affectedRows: 1 }]
      if (/DELETE FROM tournament_message_entry_portal_state/.test(sql)) return [{ affectedRows: 0 }]
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }
  const state = await markTournamentMessageThreadRead(
    threadDb,
    'tournament-1',
    'thread-1',
    { role: 'host', id: 'host-1', email: 'host@example.com' },
  )
  assert.equal(state.tournamentId, 'tournament-1')
  assert.equal(state.threadId, 'thread-1')
  assert.equal(threadCalls.length, 3)
  assert.equal(threadCalls[1].params[0], 'host|host-1|host@example.com')
  assert.deepEqual(threadCalls[2].params, ['host|host-1|host@example.com', 'thread-1'])
})


test('per-message read-state migration and host API keep unread messages independent', () => {
  const migration = APP_MIGRATIONS.find((entry) => entry.version === '20260917_093')
  const sql = read('migration_scripts/20260917_093_tournament_message_entry_read_state.sql')
  const server = read('server/index.js')
  const accounts = read('src/lib/accounts.ts')
  const portal = read('src/pages/HostPortal.tsx')
  const panel = read('src/components/TournamentMessagingPanel.tsx')

  assert.ok(migration)
  assert.equal(migration.name, 'tournament_message_entry_read_state')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tournament_message_entry_portal_state/i)
  assert.match(sql, /PRIMARY KEY \(viewer_key, message_id\)/i)
  assert.match(sql, /FOREIGN KEY \(message_id\) REFERENCES tournament_message_entries\(id\) ON DELETE CASCADE/i)
  assert.match(server, /message-threads\/:threadId\/messages\/:messageId\/read/)
  assert.match(server, /host_tournament_message_marked_read/)
  assert.match(accounts, /markHostTournamentMessageRead/)
  assert.match(portal, /candidate\.messageId !== item\.messageId/)
  assert.match(portal, /readState\.remainingUnread/)
  assert.match(server, /remainingUnread/)
  assert.doesNotMatch(portal, /unreadInThread/)
  assert.match(panel, /autoOpenMessageId\?: string \| null/)
  assert.match(panel, /if \(!targetMessageId && Number\(targetThread\.unreadCount \|\| 0\) > 0\)/)
})

test('marking one tournament message read writes only that message state', async () => {
  const calls = []
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params })
      if (/SELECT e\.id/.test(sql)) return [[{ id: 'message-2' }]]
      if (/INSERT INTO tournament_message_entry_portal_state/.test(sql)) return [{ affectedRows: 1 }]
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }

  const state = await markTournamentMessageRead(
    db,
    'tournament-1',
    'thread-9',
    'message-2',
    { role: 'host', id: 'host-1', email: 'host@example.com' },
  )

  assert.equal(state.tournamentId, 'tournament-1')
  assert.equal(state.threadId, 'thread-9')
  assert.equal(state.messageId, 'message-2')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].params, ['message-2', 'thread-9', 'tournament-1'])
  assert.deepEqual(calls[1].params, ['host|host-1|host@example.com', 'tournament-1', 'thread-9', 'message-2'])
})
