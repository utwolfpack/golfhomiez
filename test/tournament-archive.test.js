import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { setTournamentArchiveState, isTournamentArchived } from '../server/lib/tournament-archive.js'

test('setTournamentArchiveState soft archives a tournament without deleting it', async () => {
  const calls = []
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params })
      return [{ affectedRows: 1 }]
    },
  }

  const result = await setTournamentArchiveState(db, 'tourney-1', true)
  assert.deepEqual(result, { tournamentId: 'tourney-1', archived: true, changed: true })
  assert.match(calls[0].sql, /SET archived_at = UTC_TIMESTAMP\(\)/)
  assert.match(calls[0].sql, /archived_at IS NULL/)
  assert.deepEqual(calls[0].params, ['tourney-1'])
})

test('setTournamentArchiveState restores an archived tournament', async () => {
  const calls = []
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params })
      return [{ affectedRows: 1 }]
    },
  }

  const result = await setTournamentArchiveState(db, 'tourney-2', false)
  assert.deepEqual(result, { tournamentId: 'tourney-2', archived: false, changed: true })
  assert.match(calls[0].sql, /SET archived_at = NULL/)
  assert.match(calls[0].sql, /archived_at IS NOT NULL/)
})

test('isTournamentArchived supports database and API row naming', () => {
  assert.equal(isTournamentArchived({ archived_at: '2026-08-10 20:00:00' }), true)
  assert.equal(isTournamentArchived({ archivedAt: '2026-08-10T20:00:00.000Z' }), true)
  assert.equal(isTournamentArchived({ archived_at: null }), false)
})

test('archive migration is registered and cancelled cleanup preserves archived tournaments', () => {
  const migrations = fs.readFileSync(new URL('../server/migrations/index.js', import.meta.url), 'utf8')
  const cleanup = fs.readFileSync(new URL('../server/lib/cancelled-tournament-cleanup.js', import.meta.url), 'utf8')
  assert.match(migrations, /20260810_070/)
  assert.match(migrations, /archived_at/)
  assert.match(cleanup, /archived_at IS NULL/)
})

test('host and organizer portals expose archive, restore, compact line-item management, and hide portal profile update cards', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const accounts = fs.readFileSync(new URL('../src/lib/accounts.ts', import.meta.url), 'utf8')
  const hostPage = fs.readFileSync(new URL('../src/pages/HostPortal.tsx', import.meta.url), 'utf8')
  const organizerPage = fs.readFileSync(new URL('../src/pages/OrganizerTournaments.tsx', import.meta.url), 'utf8')
  const lineItem = fs.readFileSync(new URL('../src/components/TournamentManagementLineItem.tsx', import.meta.url), 'utf8')
  const publicPages = fs.readFileSync(new URL('../server/lib/golf-course-public-pages.js', import.meta.url), 'utf8')
  const discovery = fs.readFileSync(new URL('../server/lib/tournament-discovery.js', import.meta.url), 'utf8')

  assert.match(server, /\/api\/host\/tournaments\/:id\/archive/)
  assert.match(server, /\/api\/host\/tournaments\/:id\/restore/)
  assert.match(server, /\/api\/organizer\/tournaments\/:id\/archive/)
  assert.match(server, /\/api\/organizer\/tournaments\/:id\/restore/)
  assert.match(server, /host_tournament_archived/)
  assert.match(server, /organizer_tournament_restored/)
  assert.match(accounts, /archiveHostTournamentRecord/)
  assert.match(accounts, /restoreOrganizerTournamentRecord/)

  assert.doesNotMatch(hostPage, /Update host profile/)
  assert.doesNotMatch(organizerPage, /Update organizer profile/)
  assert.match(hostPage, /View archived tournaments/)
  assert.match(organizerPage, /View archived tournaments/)
  assert.doesNotMatch(hostPage, /Other tournament line items are hidden while this tournament is being modified/)
  assert.doesNotMatch(organizerPage, /Other tournament line items are hidden while this tournament is being modified/)

  assert.match(lineItem, /Tournament Date/)
  assert.match(lineItem, /Status/)
  assert.match(lineItem, /Organizer/)
  assert.match(lineItem, /Golfer Registration URL/)
  assert.match(lineItem, /Teams Registered/)
  assert.match(lineItem, /Team Slots Open/)
  assert.match(lineItem, /Restore to active/)
  assert.match(lineItem, /onKeyDown/)

  assert.match(publicPages, /archived_at IS NULL/)
  assert.match(discovery, /&& !tournament\.archived_at/)
  assert.match(server, /portal\.tournament\.archivedAt \|\| !\['published', 'completed'\]\.includes\(portalStatus\)/)
})
