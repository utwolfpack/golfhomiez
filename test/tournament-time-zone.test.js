import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { getTodayInTimeZone } from '../server/lib/date-utils.js'
import { normalizeTournamentScheduleDate } from '../server/lib/tournament-schedule-conflicts.js'
import { DEFAULT_USER_TIME_ZONE, resolveUserTimeZone } from '../server/lib/time-zone.js'

test('timezone resolution uses the supplied user timezone and defaults to Mountain Time', () => {
  assert.equal(resolveUserTimeZone('America/New_York'), 'America/New_York')
  assert.equal(resolveUserTimeZone(undefined), DEFAULT_USER_TIME_ZONE)
  assert.equal(resolveUserTimeZone('Not/A_Timezone'), DEFAULT_USER_TIME_ZONE)
  assert.equal(DEFAULT_USER_TIME_ZONE, 'America/Denver')
  assert.match(getTodayInTimeZone(undefined), /^\d{4}-\d{2}-\d{2}$/)
})

test('tournament calendar dates remain the selected calendar day without UTC/local day shifting', () => {
  assert.equal(normalizeTournamentScheduleDate('2026-10-24'), '2026-10-24')
  assert.equal(normalizeTournamentScheduleDate('2026-10-24T00:00:00.000Z'), '2026-10-24')
  assert.equal(normalizeTournamentScheduleDate(new Date('2026-10-24T00:00:00.000Z')), '2026-10-24')
})

test('database and tournament mappers preserve SQL DATE values as date-only strings', () => {
  const db = fs.readFileSync(new URL('../server/db.js', import.meta.url), 'utf8')
  const dbConfig = fs.readFileSync(new URL('../server/db-config.js', import.meta.url), 'utf8')
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const rbac = fs.readFileSync(new URL('../server/lib/rbac.js', import.meta.url), 'utf8')
  const publicPages = fs.readFileSync(new URL('../server/lib/golf-course-public-pages.js', import.meta.url), 'utf8')

  assert.match(db, /dateStrings: \['DATE'\]/)
  assert.match(dbConfig, /dateStrings: \['DATE'\]/)
  assert.match(server, /startDate: normalizeTournamentScheduleDate\(row\.start_date \|\| row\.starts_at\)/)
  assert.match(rbac, /startDate: normalizeTournamentScheduleDate\(row\.start_date \|\| row\.starts_at\)/)
  assert.match(publicPages, /startDate: normalizeTournamentScheduleDate\(row\.start_date \|\| row\.starts_at\)/)
})

test('host create and update transactions log requested/stored dates with the effective user timezone', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const portal = fs.readFileSync(new URL('../src/pages/HostPortal.tsx', import.meta.url), 'utf8')

  assert.match(server, /requestUserTimeZone\(req\)/)
  assert.match(server, /requestedStartDate:/)
  assert.match(server, /storedStartDate:/)
  assert.match(server, /userTimeZone/)
  assert.match(portal, /requestedStartDate: form\.startDate/)
  assert.match(portal, /storedStartDate: created\.tournament\.startDate/)
  assert.match(portal, /requestedStartDate: editForm\.startDate/)
  assert.match(portal, /storedStartDate: saved\.startDate/)
})
