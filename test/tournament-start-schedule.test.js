import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSuggestedTournamentStartAssignments,
  normalizeTeeTimeIntervalMinutes,
  normalizeTournamentStartTime,
  replaceTournamentStartAssignments,
  sanitizeTournamentStartAssignments,
} from '../server/lib/tournament-start-schedule.js'

const __filename = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(__filename), '..')

const registrations = [
  { id: 'reg-1', teamId: 'team-1', teamName: 'Birdie Crew', registeredAt: '2026-08-06T10:00:00Z' },
  { id: 'reg-2', teamId: 'team-2', teamName: 'Fairway Friends', registeredAt: '2026-08-06T10:05:00Z' },
  { id: 'reg-3', teamName: 'Pin Seekers', registeredAt: '2026-08-06T10:10:00Z' },
]

test('auto-created shotgun schedules assign every registered team a time and starting hole', () => {
  const assignments = buildSuggestedTournamentStartAssignments(registrations, {
    tournamentId: 'tournament-1',
    startType: 'shotgun',
    firstStartTime: '08:30',
  })
  assert.equal(assignments.length, 3)
  assert.deepEqual(assignments.map((item) => item.startTime), ['08:30', '08:30', '08:30'])
  assert.deepEqual(assignments.map((item) => item.startingHole), ['1', '2', '3'])
  assert.deepEqual(assignments.map((item) => item.teamKey), ['team:team-1', 'team:team-2', 'name:pin seekers'])
})

test('shotgun schedules use A/B-style hole labels when more than 18 teams register', () => {
  const manyRegistrations = Array.from({ length: 20 }, (_, index) => ({
    id: `reg-${index + 1}`,
    teamId: `team-${index + 1}`,
    teamName: `Team ${index + 1}`,
    registeredAt: `2026-08-06T10:${String(index).padStart(2, '0')}:00Z`,
  }))
  const assignments = buildSuggestedTournamentStartAssignments(manyRegistrations, { startType: 'shotgun', firstStartTime: '09:00' })
  assert.equal(assignments[17].startingHole, '18')
  assert.equal(assignments[18].startingHole, '1B')
  assert.equal(assignments[19].startingHole, '2B')
})

test('auto-created tee-time schedules use the configured interval', () => {
  const assignments = buildSuggestedTournamentStartAssignments(registrations, {
    startType: 'tee-times',
    firstStartTime: '08:30',
    intervalMinutes: 12,
  })
  assert.deepEqual(assignments.map((item) => item.startTime), ['08:30', '08:42', '08:54'])
  assert.ok(assignments.every((item) => item.startingHole === '1'))
})

test('manual schedule validation only permits currently registered teams', () => {
  assert.throws(() => sanitizeTournamentStartAssignments([
    { teamKey: 'team:not-registered', teamName: 'Unknown', startType: 'shotgun', startTime: '08:30', startingHole: '1' },
  ], registrations), /no longer registered/i)

  assert.throws(() => sanitizeTournamentStartAssignments([
    { teamKey: 'team:team-1', teamName: 'Birdie Crew', startType: 'shotgun', startTime: '08:30', startingHole: '1' },
    { teamKey: 'team:team-1', teamName: 'Birdie Crew', startType: 'shotgun', startTime: '08:40', startingHole: '2' },
  ], registrations), /appears more than once/i)
})

test('time and interval normalization enforce scheduler limits', () => {
  assert.equal(normalizeTournamentStartTime('8:05'), '08:05')
  assert.equal(normalizeTournamentStartTime('25:00', '09:00'), '09:00')
  assert.equal(normalizeTeeTimeIntervalMinutes(3), 10)
  assert.equal(normalizeTeeTimeIntervalMinutes(15), 15)
  assert.equal(normalizeTeeTimeIntervalMinutes(90), 10)
})


test('saving a schedule replaces assignments transactionally and preserves diagnostic metadata', async () => {
  const transactionStatements = []
  const connection = {
    beginTransaction: async () => transactionStatements.push(['BEGIN']),
    execute: async (sql, params = []) => {
      transactionStatements.push([sql, params])
      return [{ affectedRows: 1 }]
    },
    commit: async () => transactionStatements.push(['COMMIT']),
    rollback: async () => transactionStatements.push(['ROLLBACK']),
    release: () => transactionStatements.push(['RELEASE']),
  }
  const pool = {
    getConnection: async () => connection,
    execute: async () => [[{
      id: 'saved-assignment',
      tournament_id: 'tournament-1',
      team_key: 'team:team-1',
      registration_id: 'reg-1',
      team_id: 'team-1',
      team_name: 'Birdie Crew',
      start_type: 'shotgun',
      start_time: '08:30:00',
      starting_hole: '1',
      sort_order: 0,
      notes: null,
      created_at: '2026-08-06T10:00:00Z',
      updated_at: '2026-08-06T10:00:00Z',
    }]],
  }

  const saved = await replaceTournamentStartAssignments(pool, {
    tournamentId: 'tournament-1',
    registrations,
    assignments: [{ teamKey: 'team:team-1', teamName: 'Birdie Crew', startType: 'shotgun', startTime: '08:30', startingHole: '1' }],
    updatedByAuthUserId: 'user-1',
    correlationId: 'correlation-1',
  })

  assert.equal(saved.length, 1)
  assert.match(transactionStatements[1][0], /DELETE FROM tournament_team_start_assignments/)
  assert.match(transactionStatements[2][0], /INSERT INTO tournament_team_start_assignments/)
  assert.equal(transactionStatements[2][1][11], 'user-1')
  assert.equal(transactionStatements[2][1][12], 'correlation-1')
  assert.deepEqual(transactionStatements.slice(-2).map((entry) => entry[0]), ['COMMIT', 'RELEASE'])
})

test('saving an empty assignment list clears the current schedule without inserting rows', async () => {
  const statements = []
  const connection = {
    beginTransaction: async () => undefined,
    execute: async (sql) => { statements.push(sql); return [{ affectedRows: 1 }] },
    commit: async () => undefined,
    rollback: async () => undefined,
    release: () => undefined,
  }
  const pool = {
    getConnection: async () => connection,
    execute: async () => [[]],
  }
  const saved = await replaceTournamentStartAssignments(pool, {
    tournamentId: 'tournament-1',
    registrations: [],
    assignments: [],
    updatedByAuthUserId: 'user-1',
    correlationId: 'correlation-1',
  })
  assert.deepEqual(saved, [])
  assert.equal(statements.length, 1)
  assert.match(statements[0], /DELETE FROM tournament_team_start_assignments/)
})

test('host, organizer, public flyer, migration, and default banner integrations are present', () => {
  const serverSource = fs.readFileSync(path.join(projectRoot, 'server', 'index.js'), 'utf8')
  const hostSource = fs.readFileSync(path.join(projectRoot, 'src', 'pages', 'HostPortal.tsx'), 'utf8')
  const organizerSource = fs.readFileSync(path.join(projectRoot, 'src', 'pages', 'OrganizerTournaments.tsx'), 'utf8')
  const publicPortalSource = fs.readFileSync(path.join(projectRoot, 'src', 'pages', 'TournamentPortal.tsx'), 'utf8')
  const templateSource = fs.readFileSync(path.join(projectRoot, 'src', 'lib', 'tournament-templates.ts'), 'utf8')
  const migrationSource = fs.readFileSync(path.join(projectRoot, 'migration_scripts', '20260806_069_tournament_team_start_assignments.sql'), 'utf8')

  assert.match(serverSource, /\/api\/host\/tournaments\/:id\/start-schedule\/auto/)
  assert.match(serverSource, /\/api\/organizer\/tournaments\/:id\/start-schedule/)
  assert.match(hostSource, /TournamentStartScheduleManager/)
  assert.match(organizerSource, /TournamentStartScheduleManager/)
  const scheduleManagerSource = fs.readFileSync(path.join(projectRoot, 'src', 'components', 'TournamentStartScheduleManager.tsx'), 'utf8')
  assert.match(scheduleManagerSource, /Clear schedule/)
  assert.match(publicPortalSource, /Team start assignments/)
  assert.ok(publicPortalSource.indexOf('<TournamentTeamStartSchedule') < publicPortalSource.indexOf('<TournamentPublicSlotSummary'))
  assert.match(templateSource, /tournamentTeamSize: 4/)
  assert.match(templateSource, /Team Stableford/)
  assert.match(migrationSource, /tournament_team_start_assignments/)
  assert.ok(fs.existsSync(path.join(projectRoot, 'public', 'DefaultGolfBanner.jpg')))
})
