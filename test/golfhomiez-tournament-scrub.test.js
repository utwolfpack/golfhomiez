import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runScrubGolfHomiezTournaments } from '../server/lib/golfhomiez-tournament-scrub.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

test('Scrub Golf Homiez Tournaments deletes only tournament ids that are not local to this database', async () => {
  const calls = []
  const db = {
    async execute(sql, params = []) {
      calls.push({ sql, params })
      if (/^\s*SELECT/i.test(sql)) {
        return [[
          { id: 'keep-1', golfhomiez_tournament_id: 'local-1', tournament_name: 'Local Event', source_type: 'golfhomiez', local_tournament_exists: 1 },
          { id: 'remove-1', golfhomiez_tournament_id: 'foreign-1', tournament_name: 'Imported One', source_type: 'golfhomiez', local_tournament_exists: 0 },
          { id: 'remove-2', golfhomiez_tournament_id: 'foreign-2', tournament_name: 'Imported Two', source_type: 'imported', local_tournament_exists: 0 },
        ]]
      }
      assert.match(sql, /DELETE FROM golf_course_tournaments WHERE id IN \(\?, \?\)/)
      assert.deepEqual(params, ['remove-1', 'remove-2'])
      return [{ affectedRows: 2 }]
    },
  }
  const apiEvents = []
  const scheduledEvents = []
  const summary = await runScrubGolfHomiezTournaments(db, {
    correlationId: 'corr-123',
    triggeredBy: 'manual',
    logApi: (event, data) => apiEvents.push({ event, data }),
    logScheduledJob: (event, data) => scheduledEvents.push({ event, data }),
  })

  assert.equal(summary.recordsReviewed, 3)
  assert.equal(summary.localGolfHomiezRecordsKept, 1)
  assert.equal(summary.importedGolfHomiezRecordsDeleted, 2)
  assert.equal(summary.deleteBatches, 1)
  assert.equal(calls.length, 2)
  assert.match(calls[0].sql, /LEFT JOIN tournaments t/)
  assert.match(calls[0].sql, /BINARY t\.id = BINARY gct\.golfhomiez_tournament_id/)
  assert.ok(apiEvents.some(({ event }) => event === 'scrub_golfhomiez_tournaments_completed'))
  assert.ok(scheduledEvents.some(({ event }) => event === 'scrub_golfhomiez_tournaments_completed'))
})

test('scheduled job registry and responsive admin UI expose Scrub Golf Homiez Tournaments without horizontal scrolling', () => {
  const jobs = read('server/lib/scheduled-jobs.js')
  const page = read('src/pages/AdminScheduledJobs.tsx')
  const css = read('src/index.css')

  assert.match(jobs, /id: 'scrubGolfHomiezTournaments'/)
  assert.match(jobs, /name: 'Scrub Golf Homiez Tournaments'/)
  assert.match(jobs, /runScrubGolfHomiezTournaments/)
  assert.match(page, /scheduledJobsTableWrap/)
  assert.match(page, /scheduledJobsActions/)
  assert.doesNotMatch(page, /overflowX:\s*'auto'/)
  assert.match(css, /\.scheduledJobsTableWrap\{[\s\S]*?overflow-x:hidden/)
  assert.match(css, /@media \(max-width:1000px\)[\s\S]*?\.scheduledJobsTable thead\{[\s\S]*?display:none/)
  assert.match(css, /\.scheduledJobsTable td::before\{[\s\S]*?content:attr\(data-label\)/)
})
