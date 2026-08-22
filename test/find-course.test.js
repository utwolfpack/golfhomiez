import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  distanceMilesToBounds,
  normalizeGolfCourseSearchFilters,
  searchGolfHomiezCourses,
} from '../server/lib/golf-course-search.js'
import { normalizeUsPhoneForDisplay } from '../server/lib/us-phone.js'


test('golf course phone display only accepts structurally valid in-service U.S. geographic numbers', () => {
  assert.equal(normalizeUsPhoneForDisplay('801 555 0101'), '801 555 0101')
  assert.equal(normalizeUsPhoneForDisplay('(801) 555-0101'), '801 555 0101')
  assert.equal(normalizeUsPhoneForDisplay('+1 801-555-0101'), '801 555 0101')
  assert.equal(normalizeUsPhoneForDisplay('416 555 0101'), null, 'Canadian area codes must not display')
  assert.equal(normalizeUsPhoneForDisplay('242 555 0101'), null, 'Caribbean NANP area codes must not display')
  assert.equal(normalizeUsPhoneForDisplay('340 555 0101'), null, 'U.S. territory area codes are outside the requested 50-state/DC display rule')
  assert.equal(normalizeUsPhoneForDisplay('801 155 0101'), null, 'invalid NANP exchange must not display')
  assert.equal(normalizeUsPhoneForDisplay('801--555--0101'), null, 'malformed phone formatting must not display')
  assert.equal(normalizeUsPhoneForDisplay('+44 20 7946 0958'), null, 'non-U.S. international numbers must not display')
})

function searchRows() {
  return [
    {
      page_id: 'page-1', golf_course_id: 'course-1', slug: 'murrayparkwayut', golf_course_name: 'Murray Parkway Golf Course',
      city: 'Murray', state_code: 'UT', postal_code: '84123', phone: '801 555 0101', website_url: 'https://murray.example', latitude: 40.66, longitude: -111.89,
      hosted_tournament_count: 2,
    },
    {
      page_id: 'page-2', golf_course_id: 'course-2', slug: 'lakeviewut', golf_course_name: 'Lake View Golf Course',
      city: 'Brigham City', state_code: 'UT', postal_code: '84302', phone: '801 555 0102', website_url: 'https://lakeview.example', latitude: 41.5, longitude: -111.9,
      hosted_tournament_count: 1,
    },
    {
      page_id: 'page-3', golf_course_id: 'course-3', slug: 'farawayut', golf_course_name: 'Far Away Golf Course',
      city: 'Logan', state_code: 'UT', postal_code: '84341', phone: '801 555 0103', website_url: 'https://far.example', latitude: 43.0, longitude: -111.9,
      hosted_tournament_count: 3,
    },
    {
      page_id: null, golf_course_id: 'course-4', slug: null, golf_course_name: 'Nearby Public Golf Course',
      city: 'Sandy', state_code: 'UT', postal_code: '84124', phone: '801 555 0104', website_url: 'https://nearby.example', latitude: 40.7, longitude: -111.9,
      hosted_tournament_count: 0,
    },
    {
      page_id: null, golf_course_id: 'course-5', slug: null, golf_course_name: 'Sixty Mile Golf Course',
      city: 'North City', state_code: 'UT', postal_code: '84001', phone: null, website_url: 'https://sixty.example', latitude: 41.75, longitude: -111.9,
      hosted_tournament_count: 0,
    },
  ]
}

function createSearchDb(rows = searchRows()) {
  const calls = []
  const courseRows = rows.map((row) => ({
    golf_course_id: row.golf_course_id,
    golf_course_name: row.golf_course_name,
    city: row.city,
    state_code: row.state_code,
    postal_code: row.postal_code,
    phone: row.phone,
    golf_course_website: row.website_url,
    catalog_website: row.website_url,
    latitude: row.latitude,
    longitude: row.longitude,
  }))
  const pageRows = rows.filter((row) => row.page_id).map((row) => ({
    page_id: row.page_id,
    golf_course_id: row.golf_course_id,
    slug: row.slug,
    golf_course_name: row.golf_course_name,
    city: row.city,
    state_code: row.state_code,
    postal_code: row.postal_code,
    contact_phone: row.phone,
    website_url: row.website_url,
  }))
  const hostRows = [
    { host_account_id: 'host-1', golf_course_id: 'course-1' },
    { host_account_id: 'host-3', golf_course_id: 'course-3' },
  ]
  const tournamentRows = [
    { host_account_id: 'host-1', status: 'published' },
    { host_account_id: 'host-1', status: 'completed' },
    { host_account_id: 'host-3', status: 'published' },
    { host_account_id: 'host-3', status: 'completed' },
    { host_account_id: 'host-3', status: 'published' },
    { host_account_id: 'host-3', status: 'draft' },
  ]
  const indexedRows = [
    { golf_course_id: 'course-1', golf_course_name: 'Murray Parkway Golf Course', state_code: 'UT', source_type: 'golfhomiez', active: 1 },
    { golf_course_id: 'course-2', golf_course_name: 'Lake View Golf Course', state_code: 'UT', source_type: 'golfhomiez', active: 1 },
    { golf_course_id: 'course-3', golf_course_name: 'Far Away Golf Course', state_code: 'UT', source_type: 'golfhomiez', active: 1 },
    { golf_course_id: 'course-4', golf_course_name: 'Nearby Public Golf Course', state_code: 'UT', source_type: 'external', active: 1 },
  ]
  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params })
      if (/FROM golf_courses\s+ORDER BY state_code/i.test(sql)) return [courseRows]
      if (/FROM golf_course_public_pages\s+WHERE is_published = 1/i.test(sql)) return [pageRows]
      if (/FROM host_accounts\s+WHERE golf_course_id IS NOT NULL/i.test(sql)) return [hostRows]
      if (/FROM tournaments\s+WHERE host_account_id IS NOT NULL/i.test(sql)) return [tournamentRows]
      if (/FROM golf_course_tournaments\s+WHERE active = 1/i.test(sql)) return [indexedRows]
      if (/SELECT latitude, longitude\s+FROM golf_courses/i.test(sql)) return [[]]
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }
}

function zipBoundsFetch() {
  return Promise.resolve({
    ok: true,
    async json() {
      return [{ lat: '40.70', lon: '-111.90', boundingbox: ['40.60', '40.80', '-112.00', '-111.80'] }]
    },
  })
}

test('golf-course search normalizes state and ZIP filters and validates short ZIP input', () => {
  assert.deepEqual(normalizeGolfCourseSearchFilters({ state: 'ut', city: '  Murray ', zipCode: '84123-1234', golfCourseName: '  Parkway  ' }), {
    state: 'UT', city: 'Murray', zipCode: '84123', golfCourseName: 'Parkway',
  })
  assert.throws(() => normalizeGolfCourseSearchFilters({ zipCode: '841' }), /valid 5-digit ZIP code/i)
})

test('ZIP distance is measured from the ZIP bounding area rather than always from its center', () => {
  const bounds = { south: 40.6, north: 40.8, west: -112.0, east: -111.8 }
  assert.equal(distanceMilesToBounds(40.7, -111.9, bounds), 0)
  const distance = distanceMilesToBounds(41.5, -111.9, bounds)
  assert.ok(distance > 40 && distance < 50)
})

test('Find a Golf Course searches the full golf_courses catalog, prioritizes GolfHomiez-hosted courses, and applies a 50-mile ZIP radius', async () => {
  const db = createSearchDb()
  const allResult = await searchGolfHomiezCourses(db, { state: 'UT' }, { fetchImpl: null })

  assert.equal(allResult.pagination.totalResults, 5)
  assert.ok(allResult.courses.slice(0, 3).every((course) => course.hostedTournamentCount > 0))
  assert.ok(allResult.courses.slice(3).every((course) => course.hostedTournamentCount === 0))
  assert.ok(allResult.courses.some((course) => course.golfCourseId === 'course-4' && course.golfCoursePagePath === null))
  assert.equal(allResult.courses.find((course) => course.golfCourseId === 'course-1')?.phone, '801 555 0101')

  const result = await searchGolfHomiezCourses(db, { state: 'UT', zipCode: '84123' }, { fetchImpl: zipBoundsFetch })
  assert.equal(result.pagination.totalResults, 3)
  assert.deepEqual(result.courses.map((course) => course.golfCourseId), ['course-1', 'course-2', 'course-4'])
  assert.equal(result.courses[0].distanceMiles, 0)
  assert.ok(result.courses[1].distanceMiles > 40 && result.courses[1].distanceMiles < 50)
  assert.equal(result.courses[2].distanceMiles, 0)
  assert.equal(result.courses[2].hostedTournamentCount, 0)
  assert.equal(result.zipSearch.radiusMiles, 50)
  assert.equal(result.zipSearch.radiusResolved, true)
  assert.equal(result.zipSearch.source, 'nominatim')

  assert.match(db.calls[0].sql, /FROM golf_courses/)
  assert.ok(db.calls.some((call) => /FROM golf_course_public_pages/.test(call.sql)))
  assert.ok(db.calls.some((call) => /FROM host_accounts/.test(call.sql)))
  assert.ok(db.calls.some((call) => /FROM tournaments/.test(call.sql)))
  assert.ok(db.calls.some((call) => /FROM golf_course_tournaments/.test(call.sql)))
  assert.ok(db.calls.every((call) => !/\bJOIN\b/i.test(call.sql)), 'search catalog queries should not depend on cross-table SQL joins')
  assert.ok(db.calls.every((call) => !/\bBINARY\b/i.test(call.sql)), 'search catalog queries should not depend on cross-collation BINARY equality')
  assert.equal(allResult.diagnostics.strategy, 'collation_independent_application_join')
})

test('Find a Golf Course supports typo-tolerant full fuzzy city and course-name matching', async () => {
  const db = createSearchDb()
  const cityResult = await searchGolfHomiezCourses(db, { state: 'UT', city: 'Murry' }, { fetchImpl: null })
  assert.deepEqual(cityResult.courses.map((course) => course.golfCourseId), ['course-1'])

  const courseResult = await searchGolfHomiezCourses(db, { state: 'UT', golfCourseName: 'Lake Vew' }, { fetchImpl: null })
  assert.deepEqual(courseResult.courses.map((course) => course.golfCourseId), ['course-2'])
})

test('Find a Golf Course frontend route, profile-state default, navigation order, labels, host admin visibility, and tournament error duplication are wired', () => {
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const findCourse = fs.readFileSync(new URL('../src/pages/FindCourse.tsx', import.meta.url), 'utf8')
  const findTournament = fs.readFileSync(new URL('../src/pages/FindTournament.tsx', import.meta.url), 'utf8')
  const nav = fs.readFileSync(new URL('../src/components/NavBar.tsx', import.meta.url), 'utf8')
  const hostPortal = fs.readFileSync(new URL('../src/pages/HostPortal.tsx', import.meta.url), 'utf8')
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')

  assert.match(app, /path="\/find-course"/)
  assert.match(server, /app\.get\('\/api\/users\/golf-course-search'/)
  assert.match(server, /user_golf_course_search_started/)
  assert.match(server, /user_golf_course_search_completed/)
  assert.match(server, /golfHomiezHostedResultsOnPage/)
  assert.match(server, /golfHomiezPublicPageResultsOnPage/)
  assert.match(server, /phoneResultsOnPage/)
  assert.match(server, /searchStrategy: result\.diagnostics\?\.strategy/)
  assert.match(server, /user_golf_course_search_failed/)
  assert.match(server, /searchStage: error\?\.golfCourseSearchStage/)
  assert.match(findCourse, /Find a Golf Course/)
  assert.match(findCourse, /fetchProfile\(\)/)
  assert.match(findCourse, /const FALLBACK_STATE = 'UT'/)
  assert.doesNotMatch(findCourse, />All states<\/option>/)
  assert.match(findCourse, /profileStateCode\(profile\.primaryState\)/)
  assert.match(findCourse, /Golf Course Name/)
  assert.match(findCourse, /zipRadiusResolved/)
  assert.match(findCourse, /zipSearch\.radiusMiles}-mile ZIP radius/)
  assert.match(findCourse, /golf_course_search_started/)
  assert.match(findCourse, /golf_course_search_completed/)
  assert.match(findCourse, /<strong>Phone:<\/strong>/)
  assert.match(findCourse, /formatValidUsPhoneForDisplay\(course\.phone\)/)
  assert.match(findCourse, /displayPhone \? <span><strong>Phone:/)
  assert.doesNotMatch(findCourse, /course\.phone \|\| 'Not listed'/)
  assert.match(findCourse, /absoluteCourseWebsiteUrl/)
  assert.match(findCourse, /window\.location\.origin/)
  assert.match(findCourse, /<strong>Website:<\/strong>/)
  assert.doesNotMatch(findCourse, /GolfHomiez tournaments:/)
  assert.doesNotMatch(findCourse, /Course Info & Tournaments/)

  assert.match(findTournament, />Find a Tournament<\/h2>/)
  assert.match(findTournament, /searching \? 'Searching…' : 'Find a Tournament'/)

  const menuStart = nav.indexOf('{restrictedSession ? null : (')
  const menuEnd = nav.indexOf('<button type="button" className="navDropdownItem" onClick={() => void handleLogout()}>Logout</button>', menuStart)
  const golferMenu = nav.slice(menuStart, menuEnd)
  const orderedLabels = ['My Scores', 'My Tournaments', 'Challenges', 'Find a Tournament', 'Find a Golf Course', 'Notifications', 'Profile']
  let previousIndex = -1
  for (const label of orderedLabels) {
    const index = golferMenu.indexOf(`>${label}</NavLink>`)
    assert.ok(index > previousIndex, `${label} should follow the requested golfer navigation order`)
    previousIndex = index
  }
  assert.match(nav, /challenges_selected/)
  assert.match(nav, /find_tournament_selected/)
  assert.match(nav, /find_golf_course_selected/)
  assert.match(nav, /notifications_selected/)

  assert.match(hostPortal, /Golf-course host accounts/)
  assert.match(hostPortal, /Add host account/)
  assert.match(hostPortal, /!createTournamentOpen && !editingId/)
  assert.doesNotMatch(hostPortal, /SHOW_HOST_ADMIN_ACCOUNTS/)

  assert.match(hostPortal, /data-testid=\{testId\}/)
  const topError = hostPortal.indexOf('testId="host-portal-error-top"')
  const createBottomError = hostPortal.indexOf('testId="host-create-tournament-error-bottom"')
  const createButton = hostPortal.indexOf("'Create tournament'", createBottomError)
  const bottomError = hostPortal.indexOf('testId="host-tournament-error-bottom"')
  const saveButton = hostPortal.indexOf("'Save tournament changes'", bottomError)
  assert.ok(topError >= 0, 'host portal should keep errors at the top of the page')
  assert.ok(createBottomError >= 0 && createButton > createBottomError, 'tournament create errors should also appear above Create tournament')
  assert.ok(bottomError >= 0 && saveButton > bottomError, 'tournament edit errors should also appear above Save tournament changes')
  assert.match(hostPortal, /<HostPortalErrorMessage message=\{error\} location="page_top"/)
  assert.match(hostPortal, /message=\{error\}[\s\S]*location="above_create_tournament"/)
  assert.match(hostPortal, /message=\{error\}[\s\S]*location="above_save_tournament_changes"/)
  assert.doesNotMatch(hostPortal, /editDateConflictMessage/)
  assert.match(hostPortal, /message: 'host_portal_error_displayed'/)
  assert.match(hostPortal, /createTournamentOpen[\s\S]*above_create_tournament/)
  assert.match(hostPortal, /displayLocations: \['page_top', 'above_create_tournament'\]/)
  assert.match(hostPortal, /displayLocations: \['page_top', 'above_save_tournament_changes'\]/)
})
