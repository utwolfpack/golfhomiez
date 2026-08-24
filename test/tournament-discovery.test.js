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
  syncGolfHomiezTournamentSearchRecord,
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
  const afterSixPmMountain = new Date('2026-08-25T00:30:00.000Z')
  assert.doesNotThrow(() => normalizeTournamentSearchFilters({ fromDate: '2026-08-24', toDate: '2026-08-25', timeZone: 'America/Denver' }, afterSixPmMountain))
  assert.throws(() => normalizeTournamentSearchFilters({ fromDate: '2026-08-24', toDate: '2026-08-25' }, afterSixPmMountain), /before today/i)
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
    golf_course_phone: '801 555 0140',
    golf_course_website: 'https://course.example',
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
  const result = await searchGolfCourseTournaments(db, filters, { now, page: 2, viewerUserId: 'user-1', viewerEmail: 'golfer@example.com' })
  assert.equal(capturedQueries.length, 1)
  assert.match(capturedQueries[0].sql, /state_code = \?/)
  assert.doesNotMatch(capturedQueries[0].sql, /ESCAPE/i)
  assert.doesNotMatch(capturedQueries[0].sql, /city\s+LIKE/i)
  assert.doesNotMatch(capturedQueries[0].sql, /golf_course_name\s+LIKE/i)
  assert.deepEqual(capturedQueries[0].params, ['user-1', 'user-1', 'golfer@example.com', 'golfer@example.com', '2026-08-01', '2027-01-29', 'UT'])
  assert.match(capturedQueries[0].sql, /ORDER BY CASE WHEN gct\.source_type = 'golfhomiez' THEN 0 ELSE 1 END/i)
  assert.match(capturedQueries[0].sql, /FROM tournament_registrations tr/i)
  assert.match(capturedQueries[0].sql, /BINARY tr\.tournament_id = BINARY gct\.golfhomiez_tournament_id/i)
  assert.match(capturedQueries[0].sql, /LEFT JOIN tournaments t ON BINARY t\.id = BINARY gct\.golfhomiez_tournament_id/i)
  assert.match(capturedQueries[0].sql, /LEFT JOIN golf_courses gc_search/i)
  assert.match(capturedQueries[0].sql, /gcpp_search\.contact_phone/i)
  assert.match(capturedQueries[0].sql, /gc_search\.phone/i)
  assert.match(capturedQueries[0].sql, /gc_search\.website/i)
  assert.deepEqual(result.pagination, { page: 2, pageSize: 20, totalResults: 25, totalPages: 2 })
  assert.equal(result.tournaments.length, 5)
  assert.equal(result.tournaments[0].tournamentDate, '2026-08-22')
  assert.equal(result.tournaments[0].golfCoursePhone, '801 555 0140')
  assert.equal(result.tournaments[0].golfCourseWebsiteUrl, 'https://course.example')
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
  const golfHomiezSql = await readFile(new URL('../migration_scripts/20260806_067_golfhomiez_tournament_search_records.sql', import.meta.url), 'utf8')
  const golfHomiezMigration = APP_MIGRATIONS.find((entry) => entry.version === '20260806_067')

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
  assert.match(findTournament, /resolvedOptions\(\)\.timeZone/)
  assert.match(findTournament, /timeZone: userTimeZone/)
  assert.match(server, /timeZone: req\.query\.timeZone/)
  assert.match(findTournament, /type="date" min=\{dateBounds\.min\} max=\{dateBounds\.max\}/)
  assert.match(findTournament, /type="date" min=\{searchFilters\.fromDate \|\| dateBounds\.min\} max=\{dateBounds\.max\}/)
  assert.match(findTournament, /Golf Course Name/)
  assert.match(findTournament, /tournamentSearchCourseName/)
  assert.match(findTournament, /pagination\.totalResults/)
  assert.match(findTournament, /Page \{pagination\.page\} of \{pagination\.totalPages\}/)
  assert.doesNotMatch(findTournament, /<strong>Course:<\/strong>/)
  assert.ok(golfHomiezMigration)
  assert.equal(golfHomiezMigration.name, 'golfhomiez_tournament_search_records')
  assert.match(golfHomiezSql, /source_type/)
  assert.match(golfHomiezSql, /golfhomiez_tournament_id/)
  assert.match(golfHomiezSql, /WHERE LOWER\(TRIM\(COALESCE\(t\.status, ''\)\)\) = 'published'/)
  assert.match(findTournament, /Registered/)
  assert.match(findTournament, /tournamentSearchResultClickable/)
  assert.match(findTournament, /golfCoursePagePath/)
  assert.match(findTournament, /golfCoursePhone/)
  assert.match(findTournament, /golfCourseWebsiteUrl/)
  assert.match(findTournament, /absoluteCourseWebsiteUrl/)
  assert.match(findTournament, /window\.location\.origin/)
  assert.match(findTournament, /Phone:/)
  assert.match(findTournament, /formatValidUsPhoneForDisplay\(tournament\.golfCoursePhone\)/)
  assert.match(findTournament, /displayPhone \? <span><strong>Phone:/)
  assert.doesNotMatch(findTournament, /golfCoursePhone \|\| 'Not listed'/)
  assert.match(findTournament, /Website:/)
  assert.doesNotMatch(findTournament, /Course Info & Tournaments/)
  assert.doesNotMatch(findTournament, /Source:/)
  assert.doesNotMatch(findTournament, /Select row/)
  assert.doesNotMatch(findTournament, /GolfHomiez hosted/)
  assert.doesNotMatch(findTournament, /Tournament website/)
  assert.doesNotMatch(findTournament, /Golf Homiez Tournament/)
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

  assert.match(executedSql[0], /^DELETE FROM golf_course_tournaments/i)
  assert.match(executedSql[0], /source_type/i)
  assert.match(executedSql[0], /<> \?/i)
  assert.doesNotMatch(executedSql[0], /TRUNCATE/i)
  assert.match(selectedCourseSql, /NULLIF\(TRIM\(gc\.website\), ''\)/i)
  assert.match(selectedCourseSql, /LEFT JOIN golf_course_tournament_crawl_state crawl/i)
  assert.match(selectedCourseSql, /crawl\.last_status AS crawl_state_last_status/i)
  assert.doesNotMatch(selectedCourseSql, /\bLIMIT\b/i)
  assert.doesNotMatch(selectedCourseSql, /next_crawl_after/i)
  assert.doesNotMatch(selectedCourseSql, /gc\.active\s*=\s*1/i)
})

test('getTournaments skips an unchanged website when its matching crawl-state last status is failed', async () => {
  let fetchCalls = 0
  const crawlStatuses = []
  const apiEvents = []
  const scheduledEvents = []
  const db = {
    async execute(sql, params = []) {
      if (/TRUNCATE TABLE golf_course_tournaments/i.test(sql)) return [{ affectedRows: 0 }]
      if (/SELECT gc\.id, gc\.name/i.test(sql)) {
        assert.match(sql, /LEFT JOIN golf_course_tournament_crawl_state crawl/i)
        assert.match(sql, /crawl\.last_status AS crawl_state_last_status/i)
        return [[{
          id: 'course-failed',
          name: 'Previously Failed Golf Club',
          state_code: 'UT',
          city: 'Provo',
          postal_code: '84601',
          golf_course_website: 'https://93.184.216.34',
          crawl_state_website: 'https://93.184.216.34/',
          crawl_state_last_status: ' FAILED ',
          crawl_state_last_error: 'Website returned HTTP 500',
        }]]
      }
      if (/INSERT INTO golf_course_tournament_crawl_state/i.test(sql)) crawlStatuses.push(params[5])
      return [{ affectedRows: 1 }]
    },
  }

  const result = await runGetTournaments(db, {
    correlationId: 'skip-prior-failure-test',
    fetchImpl: async () => {
      fetchCalls += 1
      throw new Error('The failed current website must not be requested by getTournaments')
    },
    logApi: (event, details) => apiEvents.push({ event, details }),
    logScheduledJob: (event, details) => scheduledEvents.push({ event, details }),
  })

  assert.equal(result.candidateCourseCount, 1)
  assert.equal(result.coursesProcessed, 1)
  assert.equal(result.coursesSkipped, 1)
  assert.equal(result.coursesSkippedPreviousFailure, 1)
  assert.equal(result.coursesSucceeded, 0)
  assert.equal(result.coursesFailed, 0)
  assert.equal(fetchCalls, 0)
  assert.deepEqual(crawlStatuses, [])
  const apiSkip = apiEvents.find((entry) => entry.event === 'tournament_crawl_course_skipped_previous_failure')
  assert.equal(apiSkip?.details?.reason, 'previous_failed_crawl_for_current_website')
  assert.equal(apiSkip?.details?.previousError, 'Website returned HTTP 500')
  assert.equal(apiSkip?.details?.continuing, true)
  const scheduledSkip = scheduledEvents.find((entry) => entry.event === 'tournament_crawl_course_skipped_previous_failure')
  assert.equal(scheduledSkip?.details?.level, 'warn')
  assert.ok(!apiEvents.some((entry) => entry.event === 'tournament_crawl_course_started'))
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



test('published GolfHomiez tournament synchronization creates a persistent internal search record', async () => {
  const statements = []
  const db = {
    async execute(sql, params = []) {
      statements.push({ sql, params })
      if (/FROM tournaments t/i.test(sql)) {
        return [[{
          id: 'gh-tournament-1',
          name: 'GolfHomiez Summer Scramble',
          description: 'A friendly hosted tournament.',
          start_date: '2026-08-30',
          status: 'published',
          tournament_identifier: 'summer-scramble-abc123',
          host_account_id: 'host-1',
          golf_course_id: 'course-1',
          golf_course_name: 'Mountain View Golf Club',
          state_code: 'UT',
          city: 'West Jordan',
          postal_code: '84088',
        }]]
      }
      return [{ affectedRows: 1 }]
    },
  }

  const result = await syncGolfHomiezTournamentSearchRecord(db, 'gh-tournament-1', {
    correlationId: 'sync-correlation-1',
    tournamentUrl: 'https://golfhomiez.com/tournaments/summer-scramble-abc123',
  })

  assert.equal(result.action, 'upserted')
  assert.equal(result.active, true)
  assert.equal(result.tournamentPath, '/tournaments/summer-scramble-abc123')
  const lookup = statements.find((statement) => /FROM tournaments t/i.test(statement.sql))
  assert.ok(lookup)
  assert.match(lookup.sql, /gc_by_id\.id = BINARY COALESCE\(ha\.golf_course_id, gcpp\.golf_course_id\)/i)
  assert.match(lookup.sql, /LEFT JOIN golf_courses gc_by_name/i)
  const write = statements.find((statement) => /INSERT INTO golf_course_tournaments/i.test(statement.sql))
  assert.ok(write)
  assert.match(write.sql, /source_type, golfhomiez_tournament_id/i)
  assert.match(write.sql, /ON DUPLICATE KEY UPDATE/i)
  assert.match(write.sql, /golf_course_id = COALESCE\(VALUES\(golf_course_id\), golf_course_id\)/i)
  assert.equal(write.params.at(-2), 'golfhomiez')
  assert.equal(write.params.at(-1), 'gh-tournament-1')
  assert.ok(write.params.includes('2026-08-30'))
  assert.ok(write.params.includes('https://golfhomiez.com/tournaments/summer-scramble-abc123'))
})

test('completed GolfHomiez tournaments remain linked for public course pages while draft and archived tournaments deactivate', async () => {
  const statements = []
  const db = {
    async execute(sql, params = []) {
      statements.push({ sql, params })
      if (/FROM tournaments t/i.test(sql)) {
        return [[{
          id: 'gh-tournament-completed',
          name: 'Completed Lake View Classic',
          description: 'Completed scoring and leaderboard are visible on the course page.',
          start_date: '2026-06-10',
          status: 'completed',
          archived_at: null,
          tournament_identifier: 'completed-lake-view-classic',
          host_account_id: 'host-1',
          golf_course_id: 'course-1',
          golf_course_name: 'Golf Homiez Lake View',
          state_code: 'UT',
        }]]
      }
      return [{ affectedRows: 1 }]
    },
  }

  const result = await syncGolfHomiezTournamentSearchRecord(db, 'gh-tournament-completed', { correlationId: 'sync-completed' })

  assert.equal(result.action, 'upserted')
  assert.equal(result.active, true)
  const write = statements.find((statement) => /INSERT INTO golf_course_tournaments/i.test(statement.sql))
  assert.ok(write)
  assert.equal(write.params.at(-1), 'gh-tournament-completed')
})

test('unpublished GolfHomiez tournaments are deactivated instead of being returned by search', async () => {
  const statements = []
  const db = {
    async execute(sql, params = []) {
      statements.push({ sql, params })
      if (/FROM tournaments t/i.test(sql)) {
        return [[{
          id: 'gh-tournament-draft',
          name: 'Draft Tournament',
          start_date: '2026-09-10',
          status: 'draft',
          tournament_identifier: 'draft-tournament-123',
        }]]
      }
      return [{ affectedRows: 1 }]
    },
  }

  const result = await syncGolfHomiezTournamentSearchRecord(db, 'gh-tournament-draft', { correlationId: 'sync-correlation-2' })
  assert.equal(result.action, 'deactivated')
  const update = statements.find((statement) => /UPDATE golf_course_tournaments/i.test(statement.sql))
  assert.ok(update)
  assert.match(update.sql, /active = 0/)
  assert.deepEqual(update.params, ['sync-correlation-2', 'golfhomiez', 'gh-tournament-draft'])
})

test('archived published GolfHomiez tournaments are deactivated from Find Tournaments search', async () => {
  const statements = []
  const db = {
    async execute(sql, params = []) {
      statements.push({ sql, params })
      if (/FROM tournaments t/i.test(sql)) {
        return [[{
          id: 'gh-tournament-archived',
          name: 'Archived Published Tournament',
          start_date: '2026-09-12',
          status: 'published',
          archived_at: '2026-08-10 21:00:00',
          tournament_identifier: 'archived-published-123',
        }]]
      }
      return [{ affectedRows: 1 }]
    },
  }

  const result = await syncGolfHomiezTournamentSearchRecord(db, 'gh-tournament-archived', { correlationId: 'sync-correlation-archived' })
  assert.equal(result.action, 'deactivated')
  assert.equal(result.active, false)
  const update = statements.find((statement) => /UPDATE golf_course_tournaments/i.test(statement.sql))
  assert.ok(update)
  assert.match(update.sql, /active = 0/)
  assert.deepEqual(update.params, ['sync-correlation-archived', 'golfhomiez', 'gh-tournament-archived'])
})

test('GolfHomiez search results expose internal path and registration state before external records', async () => {
  const captured = []
  const db = {
    async execute(sql, params = []) {
      captured.push({ sql, params })
      return [[
        {
          id: 'internal-search-row',
          golf_course_id: 'course-1',
          golf_course_name: 'Mountain View Golf Club',
          tournament_name: 'GolfHomiez Summer Scramble',
          state_code: 'UT',
          city: 'West Jordan',
          zip_code: '84088',
          tournament_date: '2026-08-30',
          tournament_website: '/tournaments/summer-scramble-abc123',
          source_url: '/tournaments/summer-scramble-abc123',
          source_type: 'golfhomiez',
          golfhomiez_tournament_id: 'gh-tournament-1',
          golfhomiez_tournament_identifier: 'summer-scramble-abc123',
          is_registered: 1,
        },
        {
          id: 'external-search-row',
          golf_course_id: 'course-2',
          golf_course_name: 'Other Golf Club',
          tournament_name: 'External Scramble',
          state_code: 'UT',
          city: 'Sandy',
          zip_code: '84070',
          tournament_date: '2026-08-29',
          tournament_website: 'https://example.com/tournament',
          source_url: 'https://example.com/tournament',
          source_type: 'external',
          is_registered: 0,
        },
      ]]
    },
  }

  const result = await searchGolfCourseTournaments(db, {
    state: 'UT',
    fromDate: '2026-08-01',
    toDate: '2026-09-30',
  }, {
    now: new Date('2026-08-01T12:00:00Z'),
    viewerUserId: 'user-registered',
    viewerEmail: 'registered@example.com',
  })

  assert.equal(result.tournaments[0].isGolfHomiezTournament, true)
  assert.equal(result.tournaments[0].isRegistered, true)
  assert.equal(result.tournaments[0].tournamentPath, '/tournaments/summer-scramble-abc123')
  assert.equal(result.tournaments[1].isGolfHomiezTournament, false)
  assert.match(captured[0].sql, /ORDER BY CASE WHEN gct\.source_type = 'golfhomiez' THEN 0 ELSE 1 END/i)
  assert.deepEqual(captured[0].params.slice(0, 4), ['user-registered', 'user-registered', 'registered@example.com', 'registered@example.com'])
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
