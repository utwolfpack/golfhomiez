import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  extractTournamentCandidatesFromHtml,
  extractTournamentLinks,
  fuzzyTextMatch,
  nextGetTournamentsRun,
  normalizeTournamentSearchFilters,
  parseRobotsTxt,
  robotsAllows,
  runGetTournaments,
  runRetryFailedTournamentWebsites,
  searchGolfCourseTournaments,
} from '../server/lib/tournament-discovery.js'
import { cancelScheduledJob, runScheduledJob, SCHEDULED_JOB_DEFINITIONS } from '../server/lib/scheduled-jobs.js'
import { nextRunForSchedule } from '../server/lib/scheduled-job-schedule.js'
import { normalizeTournamentScrubValues, runScrubTournaments } from '../server/lib/tournament-scrub.js'
import { APP_MIGRATIONS } from '../server/migrations/index.js'

test('getTournaments extracts required and optional tournament fields from golf-course HTML', () => {
  const html = `
    <html>
      <head><title>Mountain View Golf Club Events</title></head>
      <body>
        <h2>Mountain View Charity Golf Tournament</h2>
        <p>Join us August 22, 2026 for our annual tournament.</p>
        <a href="/events/charity-tournament">Tournament details</a>
      </body>
    </html>`
  const candidates = extractTournamentCandidatesFromHtml(html, {
    courseId: 'course-1',
    golfCourseName: 'Mountain View Golf Club',
    state: 'UT',
    city: 'West Jordan',
    zipCode: '84088',
    sourceUrl: 'https://example.com/events',
    now: new Date('2026-07-29T12:00:00Z'),
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].golfCourseName, 'Mountain View Golf Club')
  assert.equal(candidates[0].state, 'UT')
  assert.equal(candidates[0].city, 'West Jordan')
  assert.equal(candidates[0].zipCode, '84088')
  assert.equal(candidates[0].tournamentDate, '2026-08-22')
  assert.equal(candidates[0].tournamentWebsite, 'https://example.com/events')
  assert.match(candidates[0].tournamentName, /Charity Golf Tournament/i)
})

test('getTournaments only stores tournaments from today through six calendar months', async () => {
  const storedDates = []
  const now = new Date('2026-07-29T12:00:00Z')
  const db = {
    async execute(sql, params = []) {
      if (/TRUNCATE TABLE golf_course_tournaments/i.test(sql)) return [{ affectedRows: 0 }]
      if (/SELECT gc\.id, gc\.name/i.test(sql)) {
        return [[{
          id: 'course-six-month-window',
          name: 'Six Month Golf Club',
          state_code: 'UT',
          city: 'Salt Lake City',
          postal_code: '84101',
          golf_course_website: 'https://93.184.216.34/events',
        }]]
      }
      if (/INSERT INTO golf_course_tournaments/i.test(sql)) {
        storedDates.push(params[8])
        return [{ affectedRows: 1 }]
      }
      return [{ affectedRows: 1 }]
    },
  }
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/robots.txt')) {
      return new Response('User-agent: *\nDisallow:\n', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    return new Response(`
      <html><body>
        <h2>Today Tournament</h2><p>July 29, 2026</p>
        <h2>Boundary Tournament</h2><p>January 29, 2027</p>
        <h2>Too Far Tournament</h2><p>January 30, 2027</p>
        <h2>Past Tournament</h2><p>July 28, 2026</p>
      </body></html>`, { status: 200, headers: { 'content-type': 'text/html' } })
  }

  const result = await runGetTournaments(db, {
    correlationId: 'six-month-window-test',
    triggeredBy: 'manual',
    fetchImpl,
    now,
  })

  assert.deepEqual(storedDates.sort(), ['2026-07-29', '2027-01-29'])
  assert.equal(result.dateRangeStart, '2026-07-29')
  assert.equal(result.dateRangeEnd, '2027-01-29')
  assert.equal(result.tournamentsStored, 2)
})

test('tournament crawler only follows tournament-related internal links', () => {
  const html = `
    <a href="/events/tournaments">Tournaments</a>
    <a href="/contact">Contact</a>
    <a href="https://other.example/tournaments">Other course tournament</a>
    <a href="/golf-outings">Golf Outings</a>`
  assert.deepEqual(extractTournamentLinks(html, 'https://course.example/', 5), [
    'https://course.example/events/tournaments',
    'https://course.example/golf-outings',
  ])
})

test('tournament search enforces today through six months, fixes SQL filtering, and supports fuzzy city/course matching', async () => {
  const now = new Date('2026-07-29T12:00:00Z')
  const filters = normalizeTournamentSearchFilters({
    state: 'Utah',
    city: 'Sallt Lke',
    zipCode: '841',
    golfCourseName: 'Mountan Vew',
    fromDate: '2026-08-01',
    toDate: '2027-01-29',
  }, now)
  assert.deepEqual(filters, {
    state: 'UT',
    city: 'Sallt Lke',
    zipCode: '841',
    golfCourseName: 'Mountan Vew',
    fromDate: '2026-08-01',
    toDate: '2027-01-29',
  })
  assert.throws(() => normalizeTournamentSearchFilters({ fromDate: '2026-07-28' }, now), /before today/i)
  assert.throws(() => normalizeTournamentSearchFilters({ fromDate: '2027-01-30' }, now), /six months/i)
  assert.throws(() => normalizeTournamentSearchFilters({ toDate: '2027-01-30' }, now), /six months/i)
  assert.equal(fuzzyTextMatch('Salt Lake City', 'Sallt Lke'), true)
  assert.equal(fuzzyTextMatch('Mountain View Golf Club', 'Mountan Vew'), true)
  assert.equal(fuzzyTextMatch('Park City Municipal', 'Mountan Vew'), false)

  const capturedQueries = []
  const matchingRows = Array.from({ length: 25 }, (_, index) => ({
    id: `t-${index + 1}`,
    golf_course_id: `course-${index + 1}`,
    golf_course_name: `Mountain View Golf Club ${index + 1}`,
    tournament_name: 'Charity Scramble',
    state_code: 'UT',
    city: 'Salt Lake City',
    zip_code: index === 24 ? '84199-1234' : '84101',
    tournament_date: '2026-08-22',
    tournament_website: 'https://course.example/tournament',
    source_url: 'https://course.example/tournament',
    first_seen_at: null,
    last_seen_at: null,
  }))
  const db = {
    async execute(sql, params) {
      capturedQueries.push({ sql, params })
      return [matchingRows]
    },
  }
  const result = await searchGolfCourseTournaments(db, filters, { now, page: 2 })
  assert.equal(capturedQueries.length, 1)
  assert.match(capturedQueries[0].sql, /state_code = \?/)
  assert.doesNotMatch(capturedQueries[0].sql, /ESCAPE/i)
  assert.doesNotMatch(capturedQueries[0].sql, /city\s+LIKE/i)
  assert.doesNotMatch(capturedQueries[0].sql, /golf_course_name\s+LIKE/i)
  assert.deepEqual(capturedQueries[0].params, ['2026-08-01', '2027-01-29', 'UT'])
  assert.deepEqual(result.pagination, { page: 2, pageSize: 20, totalResults: 25, totalPages: 2 })
  assert.equal(result.tournaments.length, 5)
  assert.equal(result.tournaments[0].tournamentDate, '2026-08-22')
})

test('getTournaments is registered on the scheduled-jobs page model and runs daily in Mountain Time', () => {
  const definition = SCHEDULED_JOB_DEFINITIONS.find((job) => job.id === 'getTournaments')
  assert.ok(definition)
  assert.equal(definition.name, 'getTournaments')
  assert.equal(definition.scheduleLabel, 'Daily 02:00 MT')
  const next = nextGetTournamentsRun(new Date('2026-07-29T15:00:00Z'))
  assert.equal(next.toISOString(), '2026-07-30T08:00:00.000Z')
})

test('tournament discovery migration and dedicated Find Tournament UI/API wiring are included for deployment', async () => {
  const migration = APP_MIGRATIONS.find((entry) => entry.version === '20260729_064')
  assert.ok(migration)
  assert.equal(migration.name, 'golf_course_tournament_search')

  const sql = await readFile(new URL('../migration_scripts/20260729_064_golf_course_tournament_search.sql', import.meta.url), 'utf8')
  const server = await readFile(new URL('../server/index.js', import.meta.url), 'utf8')
  const myTournaments = await readFile(new URL('../src/pages/MyTournaments.tsx', import.meta.url), 'utf8')
  const findTournament = await readFile(new URL('../src/pages/FindTournament.tsx', import.meta.url), 'utf8')
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

  assert.match(sql, /golf_course_website/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS golf_course_tournaments/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS golf_course_tournament_crawl_state/)
  assert.match(server, /app\.get\('\/api\/users\/tournament-search'/)
  assert.match(app, /path="\/find-tournament"/)
  assert.match(myTournaments, /title="My Tournaments"/)
  assert.match(myTournaments, /to="\/find-tournament"/)
  assert.doesNotMatch(myTournaments, /searchGolfCourseTournaments/)
  assert.doesNotMatch(findTournament, /title="Find Tournament"/)
  assert.doesNotMatch(findTournament, /Find a golf tournament/i)
  assert.match(findTournament, /className="btn btnLightGreen btnSmall"/)
  assert.match(findTournament, /fetchProfile\(\)/)
  assert.match(findTournament, /defaultTo\.setUTCDate\(defaultTo\.getUTCDate\(\) \+ 14\)/)
  assert.match(findTournament, /addUtcMonths\(start, 6\)/)
  assert.match(findTournament, /type="date" min=\{dateBounds\.min\} max=\{dateBounds\.max\}/)
  assert.match(findTournament, /type="date" min=\{searchFilters\.fromDate \|\| dateBounds\.min\} max=\{dateBounds\.max\}/)
  assert.match(findTournament, /Golf Course Name/)
  assert.match(findTournament, /tournamentSearchCourseName/)
  assert.match(findTournament, /pagination\.totalResults/)
  assert.match(findTournament, /Page \{pagination\.page\} of \{pagination\.totalPages\}/)
  assert.doesNotMatch(findTournament, /<strong>Course:<\/strong>/)
  assert.match(packageJson.scripts.postinstall, /db:migrate/)
})


test('robots.txt rules honor allow precedence and a root disallow skips a course without failing the crawl', async () => {
  const rules = parseRobotsTxt(`
    User-agent: *
    Disallow: /
    Allow: /events/
  `)
  assert.equal(robotsAllows('https://93.184.216.34/', rules), false)
  assert.equal(robotsAllows('https://93.184.216.34/events/', rules), true)

  let crawlStateParams = null
  let rootRequested = false
  const db = {
    async execute(sql, params = []) {
      if (/SELECT gc\.id, gc\.name/i.test(sql)) {
        return [[{
          id: 'course-robots',
          name: 'Robots Golf Club',
          state_code: 'UT',
          city: 'Salt Lake City',
          postal_code: '84101',
          golf_course_website: 'https://93.184.216.34/',
        }]]
      }
      if (/INSERT INTO golf_course_tournament_crawl_state/i.test(sql)) crawlStateParams = params
      return [{ affectedRows: 1 }]
    },
  }
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/robots.txt')) {
      return new Response('User-agent: *\nDisallow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    rootRequested = true
    throw new Error('Course root should not be fetched when robots.txt disallows it')
  }

  const result = await runGetTournaments(db, {
    triggeredBy: 'manual',
    correlationId: 'robots-test-correlation',
    fetchImpl,
  })

  assert.equal(rootRequested, false)
  assert.equal(result.coursesProcessed, 1)
  assert.equal(result.coursesSkipped, 1)
  assert.equal(result.coursesSkippedRobots, 1)
  assert.equal(result.coursesFailed, 0)
  assert.equal(crawlStateParams?.[5], 'skipped_robots')
})

test('a running getTournaments job can be cancelled and its in-flight website request is aborted', async () => {
  const originalFetch = globalThis.fetch
  let homeStartedResolve
  const homeStarted = new Promise((resolve) => { homeStartedResolve = resolve })
  const db = {
    async query() {
      return [[], []]
    },
    async execute(sql) {
      if (/SELECT gc\.id, gc\.name/i.test(sql)) {
        return [[{
          id: 'course-cancel',
          name: 'Cancellation Golf Club',
          state_code: 'UT',
          city: 'Salt Lake City',
          postal_code: '84101',
          golf_course_website: 'https://93.184.216.34/',
        }]]
      }
      return [{ affectedRows: 1 }]
    },
  }

  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/robots.txt')) {
      return new Response('User-agent: *\nDisallow:\n', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    homeStartedResolve()
    return new Promise((resolve, reject) => {
      const rejectForAbort = () => reject(options.signal?.reason || new Error('aborted'))
      if (options.signal?.aborted) rejectForAbort()
      else options.signal?.addEventListener('abort', rejectForAbort, { once: true })
    })
  }

  try {
    const runPromise = runScheduledJob(db, 'getTournaments', {
      triggeredBy: 'manual',
      correlationId: 'cancel-run-correlation',
    })
    await homeStarted
    const cancelResult = await cancelScheduledJob(db, 'getTournaments', {
      correlationId: 'cancel-request-correlation',
      adminUser: { id: 'admin-1', email: 'admin@example.com' },
    })
    const runResult = await runPromise

    assert.equal(cancelResult.status, 'cancel_requested')
    assert.equal(runResult.status, 'cancelled')
    assert.equal(runResult.output?.cancelled, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('getTournaments exhausts every populated website record and continues after per-course and crawl-state errors', async () => {
  let selectedCourseSql = ''
  const executedSql = []
  let crawlStateAttempts = 0
  let tournamentWrites = 0
  const tournamentDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const db = {
    async execute(sql) {
      executedSql.push(sql)
      if (/TRUNCATE TABLE golf_course_tournaments/i.test(sql)) return [{ affectedRows: 0 }]
      if (/SELECT gc\.id, gc\.name/i.test(sql)) {
        selectedCourseSql = sql
        return [[
          {
            id: 'course-broken',
            name: 'Broken Website Golf Club',
            state_code: 'UT',
            city: 'Salt Lake City',
            postal_code: '84101',
            golf_course_website: 'https://93.184.216.34/broken',
          },
          {
            id: 'course-empty',
            name: 'No Tournament Golf Club',
            state_code: 'UT',
            city: 'Sandy',
            postal_code: '84070',
            golf_course_website: 'https://93.184.216.35/no-events',
          },
          {
            id: 'course-tournament',
            name: 'Tournament Golf Club',
            state_code: 'UT',
            city: 'Draper',
            postal_code: '84020',
            golf_course_website: 'https://93.184.216.36/events',
          },
        ]]
      }
      if (/INSERT INTO golf_course_tournament_crawl_state/i.test(sql)) {
        crawlStateAttempts += 1
        // Prove a diagnostics/state-write error also does not terminate the website loop.
        if (crawlStateAttempts === 1) throw new Error('simulated crawl-state write failure')
        return [{ affectedRows: 1 }]
      }
      if (/INSERT INTO golf_course_tournaments/i.test(sql)) {
        tournamentWrites += 1
        return [{ affectedRows: 1 }]
      }
      return [{ affectedRows: 1 }]
    },
  }

  const fetchImpl = async (url) => {
    const value = String(url)
    if (value.endsWith('/robots.txt')) {
      return new Response('User-agent: *\nDisallow:\n', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    }
    if (value.includes('/broken')) throw new Error('simulated website failure')
    if (value.includes('/no-events')) {
      return new Response('<html><body><p>Welcome to our golf course.</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }
    if (value.includes('/events')) {
      return new Response(`<html><body><h1>Annual Golf Tournament</h1><p>${tournamentDate}</p></body></html>`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }
    throw new Error(`Unexpected URL ${value}`)
  }

  const loggedErrors = []
  const result = await runGetTournaments(db, {
    correlationId: 'exhaustive-course-test',
    triggeredBy: 'manual',
    fetchImpl,
    logError: (message, details) => loggedErrors.push({ message, details }),
  })

  assert.equal(result.candidateCourseCount, 3)
  assert.equal(result.coursesProcessed, 3)
  assert.equal(result.coursesFailed, 1)
  assert.equal(result.coursesSucceeded, 2)
  assert.equal(result.crawlStateWriteFailures, 1)
  assert.equal(tournamentWrites, 1)
  assert.equal(crawlStateAttempts, 3)
  assert.ok(result.failures.some((entry) => entry.golfCourseId === 'course-broken' && entry.phase === 'course_crawl'))
  assert.ok(result.failures.some((entry) => entry.golfCourseId === 'course-broken' && entry.phase === 'crawl_state'))
  assert.ok(loggedErrors.some((entry) => /continuing to next website/i.test(entry.message)))

  assert.match(executedSql[0], /^TRUNCATE TABLE golf_course_tournaments$/i)
  assert.match(selectedCourseSql, /NULLIF\(TRIM\(gc\.website\), ''\)/i)
  assert.doesNotMatch(selectedCourseSql, /golf_course_tournament_crawl_state/i)
  assert.doesNotMatch(selectedCourseSql, /crawl_state_last_status/i)
  assert.doesNotMatch(selectedCourseSql, /\bLIMIT\b/i)
  assert.doesNotMatch(selectedCourseSql, /next_crawl_after/i)
  assert.doesNotMatch(selectedCourseSql, /gc\.active\s*=\s*1/i)
})

test('getTournaments ignores prior failed crawl state and retries every populated course website', async () => {
  let fetchCalls = 0
  const crawlStatuses = []
  const apiEvents = []
  const db = {
    async execute(sql, params = []) {
      if (/TRUNCATE TABLE golf_course_tournaments/i.test(sql)) return [{ affectedRows: 0 }]
      if (/SELECT gc\.id, gc\.name/i.test(sql)) {
        assert.doesNotMatch(sql, /golf_course_tournament_crawl_state/i)
        assert.doesNotMatch(sql, /last_status/i)
        return [[{
          id: 'course-failed',
          name: 'Previously Failed Golf Club',
          state_code: 'UT',
          city: 'Provo',
          postal_code: '84601',
          golf_course_website: 'https://93.184.216.34/',
          crawl_state_website: 'https://93.184.216.34/',
          crawl_state_last_status: 'failed',
          crawl_state_last_error: 'Website returned HTTP 500',
        }]]
      }
      if (/INSERT INTO golf_course_tournament_crawl_state/i.test(sql)) crawlStatuses.push(params[5])
      return [{ affectedRows: 1 }]
    },
  }

  const result = await runGetTournaments(db, {
    correlationId: 'retry-prior-failure-test',
    fetchImpl: async (url) => {
      fetchCalls += 1
      if (String(url).endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow:\n', { status: 200, headers: { 'content-type': 'text/plain' } })
      }
      return new Response('<html><body><p>Golf course home page.</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    },
    logApi: (event, details) => apiEvents.push({ event, details }),
  })

  assert.equal(result.candidateCourseCount, 1)
  assert.equal(result.coursesProcessed, 1)
  assert.equal(result.coursesSkipped, 0)
  assert.equal(result.coursesSucceeded, 1)
  assert.equal(result.coursesFailed, 0)
  assert.ok(fetchCalls >= 2)
  assert.deepEqual(crawlStatuses, ['success'])
  assert.ok(apiEvents.some((entry) => entry.event === 'tournament_crawl_course_started'))
  assert.ok(!apiEvents.some((entry) => entry.event === 'tournament_crawl_course_skipped_previous_failure'))
})

test('getTournaments retries normally when the golf-course website changed after the recorded failure', async () => {
  let homeRequested = false
  const crawlStatuses = []
  const db = {
    async execute(sql, params = []) {
      if (/TRUNCATE TABLE golf_course_tournaments/i.test(sql)) return [{ affectedRows: 0 }]
      if (/SELECT gc\.id, gc\.name/i.test(sql)) {
        return [[{
          id: 'course-changed-site',
          name: 'Changed Website Golf Club',
          state_code: 'UT',
          city: 'Ogden',
          postal_code: '84401',
          golf_course_website: 'https://93.184.216.35/',
          crawl_state_website: 'https://93.184.216.34/',
          crawl_state_last_status: 'failed',
          crawl_state_last_error: 'Old website failed',
        }]]
      }
      if (/INSERT INTO golf_course_tournament_crawl_state/i.test(sql)) crawlStatuses.push(params[5])
      return [{ affectedRows: 1 }]
    },
  }
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/robots.txt')) {
      return new Response('User-agent: *\nDisallow:\n', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    homeRequested = true
    return new Response('<html><body><p>Golf course home page.</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } })
  }

  const result = await runGetTournaments(db, { correlationId: 'changed-site-test', fetchImpl })
  assert.equal(homeRequested, true)
  assert.equal(result.coursesSucceeded, 1)
  assert.deepEqual(crawlStatuses, ['success'])
})

test('retryFailedTournamentWebsites retries failed current websites and updates crawl state to success', async () => {
  let selectedSql = ''
  const crawlStatuses = []
  const db = {
    async execute(sql, params = []) {
      if (/FROM golf_course_tournament_crawl_state crawl/i.test(sql)) {
        selectedSql = sql
        return [[{
          id: 'course-retry',
          name: 'Retry Golf Club',
          state_code: 'UT',
          city: 'St. George',
          postal_code: '84770',
          golf_course_website: 'https://93.184.216.36/',
          crawl_state_website: 'https://93.184.216.36/',
          crawl_state_last_status: 'failed',
          crawl_state_last_error: 'Website returned HTTP 503',
        }]]
      }
      if (/INSERT INTO golf_course_tournament_crawl_state/i.test(sql)) crawlStatuses.push(params[5])
      return [{ affectedRows: 1 }]
    },
  }
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/robots.txt')) {
      return new Response('User-agent: *\nDisallow:\n', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    return new Response('<html><body><p>Golf course home page.</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } })
  }

  const result = await runRetryFailedTournamentWebsites(db, {
    correlationId: 'retry-failed-websites-test',
    triggeredBy: 'manual',
    fetchImpl,
  })

  assert.match(selectedSql, /last_status/i)
  assert.match(selectedSql, /= 'failed'/i)
  assert.match(selectedSql, /TRIM\(crawl\.website\).*TRIM\(COALESCE/i)
  assert.equal(result.candidateCourseCount, 1)
  assert.equal(result.coursesSucceeded, 1)
  assert.equal(result.coursesFailed, 0)
  assert.deepEqual(crawlStatuses, ['success'])
})


test('configurable scheduled-job calculations support Daily, Weekly, Monthly, and Manual modes', () => {
  const now = new Date('2026-07-29T15:00:00Z') // 09:00 in America/Denver
  assert.equal(nextRunForSchedule({ type: 'daily', time: '10:30' }, now, 'America/Denver').toISOString(), '2026-07-29T16:30:00.000Z')
  assert.equal(nextRunForSchedule({ type: 'weekly', time: '08:00', dayOfWeek: 5 }, now, 'America/Denver').toISOString(), '2026-07-31T14:00:00.000Z')
  assert.equal(nextRunForSchedule({ type: 'monthly', time: '07:15', dayOfMonth: 31 }, new Date('2026-08-31T14:00:00Z'), 'America/Denver').toISOString(), '2026-09-30T13:15:00.000Z')
  assert.equal(nextRunForSchedule({ type: 'manual' }, now, 'America/Denver'), null)
})

test('scrubTournaments deletes records whose tournament_name contains configured literal values', async () => {
  const seen = []
  const db = {
    async execute(sql, params) {
      seen.push({ sql, params })
      const pattern = params?.[0] || ''
      if (pattern.includes('test\\_event')) return [{ affectedRows: 2 }]
      if (pattern.includes('charity')) return [{ affectedRows: 1 }]
      return [{ affectedRows: 0 }]
    },
  }
  assert.deepEqual(normalizeTournamentScrubValues([' Charity ', 'charity', '', 'Test_Event']), ['Charity', 'Test_Event'])
  const result = await runScrubTournaments(db, {
    matchValues: ['Charity', 'Test_Event'],
    correlationId: 'scrub-test-correlation',
    triggeredBy: 'manual',
  })
  assert.equal(result.valuesProcessed, 2)
  assert.equal(result.deletedCount, 3)
  assert.equal(result.failures.length, 0)
  assert.match(seen[0].sql, /DELETE FROM golf_course_tournaments/)
  assert.match(seen[0].sql, /LOWER\(tournament_name\) LIKE \?/)
  assert.equal(seen[1].params[0], '%test\\_event%')
})

test('scrubTournaments is registered as a manual scheduled job', () => {
  const definition = SCHEDULED_JOB_DEFINITIONS.find((job) => job.id === 'scrubTournaments')
  assert.ok(definition)
  assert.equal(definition.name, 'scrubTournaments')
  assert.equal(definition.defaultSchedule.type, 'manual')
  assert.deepEqual(definition.defaultJobConfig, { matchValues: [] })
})

test('retryFailedTournamentWebsites is registered as a manual configurable scheduled job', () => {
  const definition = SCHEDULED_JOB_DEFINITIONS.find((job) => job.id === 'retryFailedTournamentWebsites')
  assert.ok(definition)
  assert.equal(definition.name, 'retryFailedTournamentWebsites')
  assert.equal(definition.defaultSchedule.type, 'manual')
})
