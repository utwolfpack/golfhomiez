import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  mapSupportTicket,
  normalizeSupportMessageInput,
  normalizeSupportTicketInput,
  addRequesterSupportMessage,
  SUPPORT_TICKET_STATUS,
} from '../server/lib/support-tickets.js'
import { getTournamentMessageUnreadSummary } from '../server/lib/notification-service.js'

const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('support ticket input requires a subject/message and preserves normalized content', () => {
  assert.deepEqual(normalizeSupportTicketInput({ subject: '  Login problem  ', message: 'Line one\r\nLine two  ' }), {
    subject: 'Login problem',
    message: 'Line one\nLine two',
  })
  assert.equal(normalizeSupportMessageInput({ message: '  More detail  ' }), 'More detail')
  assert.throws(() => normalizeSupportTicketInput({ subject: '', message: 'test' }), /Subject is required/)
  assert.throws(() => normalizeSupportMessageInput({ message: '  ' }), /Support message is required/)
})

test('support ticket mapper exposes user/admin unread flags and close state', () => {
  const mapped = mapSupportTicket({
    id: 'ticket-1',
    account_type: 'golf_user',
    account_id: 'user-1',
    requester_email: 'golfer@example.com',
    requester_name: 'Golfer',
    subject: 'Need help',
    status: 'closed',
    user_unread: 1,
    admin_unread: 0,
    message_count: 3,
    metadata_json: '{"source":"profile"}',
  })
  assert.equal(mapped.status, SUPPORT_TICKET_STATUS.CLOSED)
  assert.equal(mapped.userUnread, true)
  assert.equal(mapped.adminUnread, false)
  assert.equal(mapped.messageCount, 3)
  assert.deepEqual(mapped.metadata, { source: 'profile' })
})

test('requester replies are rejected once a support ticket is closed', async () => {
  const db = {
    async execute(sql) {
      if (/SELECT id, status FROM support_tickets/.test(sql)) return [[{ id: 'ticket-1', status: 'closed' }]]
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }
  await assert.rejects(
    () => addRequesterSupportMessage(db, {
      requester: { accountType: 'golf_user', accountId: 'user-1', email: 'golfer@example.com' },
      ticketId: 'ticket-1',
      message: 'Can I add more?',
    }),
    (error) => error?.statusCode === 409 && /read-only/i.test(error.message),
  )
})

test('support ticket migration creates persistent ticket/message queues with unread tracking', () => {
  const sql = read('migration_scripts/20260916_090_support_ticket_management.sql')
  const migrations = read('server/migrations/index.js')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS support_tickets/i)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS support_ticket_messages/i)
  assert.match(sql, /user_unread TINYINT\(1\)/i)
  assert.match(sql, /admin_unread TINYINT\(1\)/i)
  assert.match(sql, /closed_at TIMESTAMP/i)
  assert.match(sql, /idx_support_tickets_requester_status/i)
  assert.match(sql, /idx_support_tickets_admin_queue/i)
  assert.match(migrations, /version: '20260916_090'/)
  assert.match(migrations, /20260916_090_support_ticket_management\.sql/)
})

test('server exposes authenticated user/admin support ticket lifecycle routes with correlated logging', () => {
  const source = read('server/index.js')
  assert.match(source, /app\.get\('\/api\/support\/tickets'/)
  assert.match(source, /app\.get\('\/api\/support\/tickets\/:ticketId'/)
  assert.match(source, /app\.post\('\/api\/support\/tickets\/:ticketId\/messages'/)
  assert.match(source, /app\.get\('\/api\/admin\/support\/tickets', adminMiddleware/)
  assert.match(source, /app\.post\('\/api\/admin\/support\/tickets\/:ticketId\/messages', adminMiddleware/)
  assert.match(source, /app\.post\('\/api\/admin\/support\/tickets\/:ticketId\/close', adminMiddleware/)
  assert.match(source, /support_ticket_created/)
  assert.match(source, /admin_support_ticket_reply_saved/)
  assert.match(source, /req\.correlationId \|\| null/)
})

test('support page shows only open tickets as active line items, unread admin alert, replies, and read-only closed history', () => {
  const source = read('src/pages/Support.tsx')
  assert.match(source, /tickets\.filter\(\(ticket\) => ticket\.status === 'open'\)/)
  assert.match(source, /supportTicketLineItem/)
  assert.match(source, /Unread message from GolfHomiez admin/)
  assert.match(source, /Add details or respond to GolfHomiez admin/)
  assert.match(source, /Closed support history/)
  assert.match(source, /This ticket is closed and is now read-only/)
  assert.match(source, /replyToSupportTicket/)
  assert.match(source, /support_ticket_reply_saved/)
})

test('admin portal includes Support tab with response and close capabilities', () => {
  const source = read('src/pages/AdminPortal.tsx')
  assert.match(source, /\{ id: 'support', label: 'Support' \}/)
  assert.match(source, /function SupportDashboardSection\(\)/)
  assert.match(source, /Respond to ticket/)
  assert.match(source, /Send response/)
  assert.match(source, /Close ticket/)
  assert.match(source, /closed and read-only/)
  assert.match(source, /fetchAdminSupportTickets/)
  assert.match(source, /replyToAdminSupportTicket/)
  assert.match(source, /closeAdminSupportTicket/)
})


test('host portal includes a support workspace below host account administration using the shared support ticket APIs', () => {
  const portal = read('src/pages/HostPortal.tsx')
  const hostSupport = read('src/components/HostSupportSection.tsx')
  assert.match(portal, /HostSupportSection/)
  assert.match(portal, /data-testid="host-accounts-accordion-section"/)
  assert.ok(portal.indexOf('<HostSupportSection') > portal.indexOf('data-testid="host-admin-section"'))
  assert.match(hostSupport, /data-testid="host-support-section"/)
  assert.match(hostSupport, /Open support requests/)
  assert.match(hostSupport, /Submit a new support request/)
  assert.match(hostSupport, /Closed support history/)
  assert.match(hostSupport, /fetchSupportTickets/)
  assert.match(hostSupport, /sendSupportMessage/)
  assert.match(hostSupport, /replyToSupportTicket/)
  assert.match(hostSupport, /host_support_ticket_created/)
  assert.match(hostSupport, /Unread message from GolfHomiez admin/)
})

test('admin support dashboard distinguishes ticket types, filters by type and opened date, and paginates lists at 20 tickets', () => {
  const source = read('src/pages/AdminPortal.tsx')
  const styles = read('src/index.css')
  assert.match(source, /SUPPORT_TICKETS_PER_PAGE = 20/)
  assert.match(source, /admin-support-type-filter/)
  assert.match(source, /All ticket types/)
  assert.match(source, /value="golf_user">Golf user/)
  assert.match(source, /value="host">Host/)
  assert.match(source, /admin-support-start-date/)
  assert.match(source, /admin-support-end-date/)
  assert.match(source, /SupportTicketPagination/)
  assert.match(source, /supportAccountTypeBadge--host/)
  assert.match(source, /Golf course:/)
  assert.match(source, /admin_support_ticket_filters_changed/)
  assert.match(styles, /\.supportAccountTypeBadge--golfUser/)
  assert.match(styles, /\.supportAccountTypeBadge--host/)
  assert.match(styles, /\.adminSupportTicketLine--host/)
})

test('npm install continues to run migrations and support feature adds no dependencies', () => {
  const packageJson = JSON.parse(read('package.json'))
  assert.match(packageJson.scripts.postinstall, /db:migrate/)
  assert.ok(packageJson.dependencies.mysql2)
  assert.ok(!packageJson.dependencies['support-ticket-client'])
})


test('host support is a collapsed top-level portal section and tournament unread messages are summarized for the host', () => {
  const portal = read('src/pages/HostPortal.tsx')
  const messaging = read('src/components/TournamentMessagingPanel.tsx')
  const lineItem = read('src/components/TournamentManagementLineItem.tsx')
  const accounts = read('src/lib/accounts.ts')
  const server = read('server/index.js')
  const notificationService = read('server/lib/notification-service.js')
  const styles = read('src/index.css')

  assert.match(portal, /type HostPortalSection = 'course-events' \| 'tournaments' \| 'host-accounts' \| 'support'/)
  assert.match(portal, /data-testid="host-support-accordion-section"/)
  assert.match(portal, /aria-expanded=\{openPortalSection === 'support'\}/)
  assert.match(portal, /openPortalSection === 'support' \? \(/)
  assert.match(portal, /hostTournamentUnreadButton/)
  assert.match(portal, /host_tournament_unread_summary_selected/)
  assert.match(portal, /host-unread-tournament-messages-title/)
  assert.match(portal, /hostTournamentUnreadMessageLine/)
  assert.match(portal, /markHostTournamentMessageRead/)
  assert.match(portal, /autoOpenMessages=\{autoOpenTournamentMessagesId === tournament\.id\}/)
  assert.match(messaging, /autoOpenMessages\?: boolean/)
  assert.match(messaging, /onUnreadCountChange\?\.\(0\)/)
  assert.match(lineItem, /tournament-management-line__unread-badge/)
  assert.match(accounts, /fetchHostTournamentUnreadSummary/)
  assert.match(server, /app\.get\('\/api\/host\/tournament-messages\/unread-summary', hostAuthMiddleware/)
  assert.match(server, /host_tournament_unread_summary_loaded/)
  assert.match(notificationService, /getTournamentMessageUnreadSummary/)
  assert.match(styles, /\.hostTournamentUnreadButton/)
  assert.match(styles, /\.hostTournamentUnreadModal/)
  assert.match(styles, /\.hostTournamentUnreadMessageLine/)
})

test('tournament unread summary counts only golfer messages newer than the host read marker', async () => {
  const calls = []
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params })
      return [[
        { tournament_id: 'tournament-1', unread_count: 3 },
        { tournament_id: 'tournament-2', unread_count: 1 },
      ]]
    },
  }

  const result = await getTournamentMessageUnreadSummary(
    db,
    ['tournament-1', 'tournament-2', 'tournament-3'],
    { role: 'host', id: 'host-1', email: 'HOST@example.com' },
  )

  assert.equal(result.totalUnread, 4)
  assert.deepEqual(result.byTournament, {
    'tournament-1': 3,
    'tournament-2': 1,
    'tournament-3': 0,
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].params[0], 'host|host-1|host@example.com')
  assert.equal(calls[0].params[1], 'host|host-1|host@example.com')
  assert.equal(calls[0].params[2], 'host|host-1|host@example.com')
  assert.match(calls[0].sql, /LOWER\(COALESCE\(e\.sender_role, ''\)\) = 'user'/)
  assert.match(calls[0].sql, /tournament_message_thread_portal_state/)
  assert.match(calls[0].sql, /tournament_message_entry_portal_state/)
  assert.match(calls[0].sql, /e\.created_at > GREATEST/)
})

test('organizer portal exposes the shared support page and admin support identifies organizer tickets', () => {
  const app = read('src/App.tsx')
  const nav = read('src/components/NavBar.tsx')
  const support = read('src/pages/Support.tsx')
  const admin = read('src/pages/AdminPortal.tsx')
  const server = read('server/index.js')

  assert.match(app, /path="\/organizer\/portal\/support"[\s\S]*<OrganizerProtectedRoute><Support \/><\/OrganizerProtectedRoute>/)
  assert.match(nav, /to="\/organizer\/portal\/support"[\s\S]*>Support<\/NavLink>/)
  assert.match(nav, /organizer_support_selected/)
  assert.match(support, /accountType: 'organizer'/)
  assert.match(support, /Organizer account/)
  assert.match(server, /accountType: 'organizer'/)
  assert.match(server, /organizationName: organizerAccount\.organizationName \|\| null/)
  assert.match(admin, /value="organizer">Organizer<\/option>/)
  assert.match(admin, /supportAccountTypeBadge--organizer/)
  assert.match(admin, /adminSupportOrganizerOrganization/)
  assert.match(admin, /Organizer: \{organizerOrganizationName\}/)
})
