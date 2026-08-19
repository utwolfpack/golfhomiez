import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  buildGolfCoursePageBaseSlug,
  createGolfCoursePublicPageForApprovedHost,
  extractGolfCourseWebsiteMetadata,
  getGolfCoursePublicPageByHostAccount,
  getGolfCoursePublicPageBySlug,
  isPrivateNetworkAddress,
  sanitizeUploadedBannerData,
  syncGolfCoursePublicPageCatalogDefaults,
  updateGolfCoursePublicPageForHost,
} from '../server/lib/golf-course-public-pages.js'

test('golf-course page slug uses course name plus two-letter state with no spaces', () => {
  assert.equal(buildGolfCoursePageBaseSlug('Murray Parkway Golf Course', 'UT'), 'murrayparkwaygolfcourseut')
  assert.equal(buildGolfCoursePageBaseSlug("O'Brien's Links", 'N.H.'), 'obrienslinksnh')
})

test('website metadata prefers Open Graph summary and banner image and resolves relative URLs', () => {
  const metadata = extractGolfCourseWebsiteMetadata(`
    <html>
      <head>
        <meta property="og:title" content="Murray Parkway" />
        <meta name="description" content="Fallback description" />
        <meta property="og:description" content="An approachable public golf course with mature trees and mountain views." />
        <meta property="og:image" content="/images/course-banner.jpg" />
      </head>
    </html>
  `, 'https://example.com/course/')

  assert.equal(metadata.title, 'Murray Parkway')
  assert.equal(metadata.summary, 'An approachable public golf course with mature trees and mountain views.')
  assert.equal(metadata.bannerImageUrl, 'https://example.com/images/course-banner.jpg')
})

test('website fetch safety rejects private and local network addresses', () => {
  assert.equal(isPrivateNetworkAddress('127.0.0.1'), true)
  assert.equal(isPrivateNetworkAddress('10.20.30.40'), true)
  assert.equal(isPrivateNetworkAddress('192.168.1.20'), true)
  assert.equal(isPrivateNetworkAddress('::1'), true)
  assert.equal(isPrivateNetworkAddress('93.184.216.34'), false)
})

test('approved host page creation appends a number when the base slug is already used', async () => {
  const inserted = { row: null }
  const db = {
    async execute(sql, params = []) {
      if (/FROM golf_course_public_pages WHERE host_account_id/i.test(sql)) return [[]]
      if (/SELECT golf_course_id FROM host_accounts WHERE id/i.test(sql)) return [[{ golf_course_id: 'course-1' }]]
      if (/FROM golf_course_public_pages WHERE golf_course_id/i.test(sql)) return [[]]
      if (/FROM golf_courses WHERE id = \?/i.test(sql)) {
        return [[{
          id: 'course-1',
          name: 'Murray Parkway',
          state_code: 'UT',
          city: 'Murray',
          address: '123 Parkway Drive',
          postal_code: '84123',
          phone: '801 555 1212',
          website: null,
          holes_count: 18,
          par_total: 72,
        }]]
      }
      if (/SELECT slug[\s\S]*FROM golf_course_public_pages/i.test(sql)) {
        return [[{ slug: 'murrayparkwayut' }]]
      }
      if (/INSERT INTO golf_course_public_pages/i.test(sql)) {
        inserted.row = {
          id: params[0],
          host_account_id: params[1],
          golf_course_id: params[2],
          slug: params[3],
          golf_course_name: params[4],
          summary: params[5],
          banner_image_url: params[6],
          banner_image_data: params[7],
          website_url: params[8],
          contact_phone: params[9],
          address_line1: params[10],
          city: params[11],
          state_code: params[12],
          postal_code: params[13],
          source_website_url: params[14],
          source_last_synced_at: params[15],
          is_published: 1,
          created_at: '2026-08-04 10:00:00',
          updated_at: '2026-08-04 10:00:00',
        }
        return [{ affectedRows: 1 }]
      }
      if (/UPDATE host_accounts SET golf_course_id/i.test(sql)) return [{ affectedRows: 1 }]
      if (/FROM golf_course_public_pages WHERE id = \?/i.test(sql)) return [[inserted.row]]
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }

  const page = await createGolfCoursePublicPageForApprovedHost(db, {
    hostAccountId: 'host-1',
    golfCourseId: 'course-1',
    golfCourseName: 'Murray Parkway',
    stateCode: 'UT',
    baseUrl: 'https://golfhomiez.com',
  })

  assert.equal(page.slug, 'murrayparkwayut2')
  assert.equal(page.url, 'https://golfhomiez.com/murrayparkwayut2')
  assert.equal(page.addressLine1, '123 Parkway Drive')
  assert.match(page.summary, /Murray Parkway is a golf destination in Murray, UT/i)
})

test('public golf-course page includes linked public tournaments for the relative course and a count', async () => {
  let tournamentQuery = null
  let tournamentParams = null
  const db = {
    async execute(sql, params = []) {
      if (/FROM golf_course_public_pages WHERE slug/i.test(sql)) {
        return [[{
          id: 'page-1',
          host_account_id: 'host-1',
          golf_course_id: 'course-1',
          slug: 'murrayparkwayut',
          golf_course_name: 'Murray Parkway',
          summary: 'Course summary',
          state_code: 'UT',
          is_published: 1,
        }]]
      }
      if (/FROM information_schema\.COLUMNS/i.test(sql)) {
        if (params[0] === 'tournaments') {
          return [[
            'id', 'tournament_identifier', 'name', 'title', 'start_date', 'status', 'template_data',
            'is_public', 'archived_at', 'host_account_id', 'golf_course_id', 'created_at',
          ].map((COLUMN_NAME) => ({ COLUMN_NAME }))]
        }
        if (params[0] === 'golf_course_tournaments') {
          return [[
            'id', 'golf_course_id', 'golf_course_name', 'state_code', 'golfhomiez_tournament_id', 'active',
          ].map((COLUMN_NAME) => ({ COLUMN_NAME }))]
        }
      }
      if (/FROM tournaments t/i.test(sql)) {
        tournamentQuery = sql
        tournamentParams = params
        return [[
          { id: 'tournament-1', tournament_identifier: 'summer-open-123', name: 'Summer Open', start_date: '2026-08-10', status: 'published', template_data: JSON.stringify({ startType: 'shotgun', teeTime: '08:00', contactPerson: 'Casey Host', contactPhone: '801 555 0101', contactEmail: 'casey@example.com' }) },
          { id: 'tournament-2', tournament_identifier: null, name: 'Fall Classic', start_date: '2026-09-12', status: 'completed', template_data: JSON.stringify({ startType: 'tee-times', teeTime: '08:30' }) },
        ]]
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }

  const page = await getGolfCoursePublicPageBySlug(db, 'murrayparkwayut', { baseUrl: 'https://golfhomiez.com' })
  assert.equal(page.tournamentCount, 2)
  assert.match(tournamentQuery, /t\.golf_course_id/)
  assert.match(tournamentQuery, /t\.host_account_id/)
  assert.match(tournamentQuery, /golf_course_tournaments gct/)
  assert.match(tournamentQuery, /LOWER\(TRIM\(COALESCE\(t\.status, ''\)\)\) IN \('published', 'completed'\)/)
  assert.match(tournamentQuery, /COALESCE\(t\.is_public, 0\) = 1/)
  assert.match(tournamentQuery, /ORDER BY CASE WHEN t\.start_date IS NULL THEN 1 ELSE 0 END,[\s\S]*t\.start_date DESC/)
  assert.deepEqual(tournamentParams, ['course-1', 'host-1', 'course-1', 'Murray Parkway', 'UT'])
  assert.equal(page.tournaments[0].portalPath, '/tournaments/summer-open-123')
  assert.equal(page.tournaments[1].portalPath, '/tournaments/tournament-2')
  assert.equal(page.tournaments[0].startType, 'shotgun')
  assert.equal(page.tournaments[0].startTime, '08:00')
  assert.equal(page.tournaments[0].golfCourseName, 'Murray Parkway')
  assert.equal(page.tournaments[0].contactPerson, 'Casey Host')
  assert.equal(page.tournaments[0].contactPhone, '801 555 0101')
  assert.equal(page.tournaments[0].contactEmail, 'casey@example.com')
  assert.equal(page.tournaments[1].status, 'completed')
  assert.equal(page.calendarAvailable, true)
  assert.equal(page.calendarPath, '/murrayparkwayut/calendar')
  assert.equal(page.calendarUrl, 'https://golfhomiez.com/murrayparkwayut/calendar')
})

test('golf-course calendar becomes available after the first tournament without exposing draft tournaments publicly', async () => {
  let availabilityQuery = null
  let publicQuery = null
  const db = {
    async execute(sql, params = []) {
      if (/FROM golf_course_public_pages WHERE slug/i.test(sql)) {
        return [[{
          id: 'page-1',
          host_account_id: 'host-1',
          golf_course_id: 'course-1',
          slug: 'golfhomiezlakeviewut',
          golf_course_name: 'Golf Homiez Lake View',
          state_code: 'UT',
          is_published: 1,
        }]]
      }
      if (/FROM information_schema\.COLUMNS/i.test(sql)) {
        if (params[0] === 'tournaments') {
          return [[
            'id', 'name', 'start_date', 'status', 'is_public', 'archived_at', 'golf_course_id', 'created_at',
          ].map((COLUMN_NAME) => ({ COLUMN_NAME }))]
        }
        if (params[0] === 'golf_course_tournaments') return [[]]
      }
      if (/SELECT t\.id\s+FROM tournaments t/i.test(sql)) {
        availabilityQuery = sql
        return [[{ id: 'draft-tournament' }]]
      }
      if (/SELECT t\.id,/i.test(sql) && /FROM tournaments t/i.test(sql)) {
        publicQuery = sql
        return [[]]
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }

  const page = await getGolfCoursePublicPageBySlug(db, 'golfhomiezlakeviewut')

  assert.equal(page.calendarAvailable, true)
  assert.equal(page.calendarPath, '/golfhomiezlakeviewut/calendar')
  assert.equal(page.tournamentCount, 0)
  assert.deepEqual(page.tournaments, [])
  assert.doesNotMatch(availabilityQuery, /status/)
  assert.doesNotMatch(availabilityQuery, /archived_at/)
  assert.doesNotMatch(availabilityQuery, /IN \('published', 'completed'\)/)
  assert.match(publicQuery, /IN \('published', 'completed'\)/)
  assert.match(publicQuery, /COALESCE\(t\.is_public, 0\) = 1/)
})

test('public golf-course page includes synced GolfHomiez tournaments when course id is missing but course name matches', async () => {
  let tournamentQuery = null
  let tournamentParams = null
  const db = {
    async execute(sql, params = []) {
      if (/FROM golf_course_public_pages WHERE slug/i.test(sql)) {
        return [[{
          id: 'page-1',
          host_account_id: 'host-1',
          golf_course_id: 'course-1',
          slug: 'golfhomiezlakeviewut',
          golf_course_name: 'Golf Homiez Lake View',
          summary: 'Course summary',
          state_code: 'UT',
          is_published: 1,
        }]]
      }
      if (/FROM information_schema\.COLUMNS/i.test(sql)) {
        if (params[0] === 'tournaments') {
          return [[
            'id', 'tournament_identifier', 'name', 'start_date', 'status', 'is_public', 'archived_at', 'created_at',
          ].map((COLUMN_NAME) => ({ COLUMN_NAME }))]
        }
        if (params[0] === 'golf_course_tournaments') {
          return [[
            'id', 'golf_course_id', 'golf_course_name', 'state_code', 'golfhomiez_tournament_id', 'active',
          ].map((COLUMN_NAME) => ({ COLUMN_NAME }))]
        }
      }
      if (/FROM tournaments t/i.test(sql)) {
        tournamentQuery = sql
        tournamentParams = params
        return [[{
          id: 'tournament-1',
          tournament_identifier: '71f75205-d8a0-4c0f-8504-4859d928',
          name: 'Founders Fairway Tournament 2026',
          start_date: '2026-12-20',
          status: 'published',
        }]]
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }

  const page = await getGolfCoursePublicPageBySlug(db, 'golfhomiezlakeviewut')

  assert.equal(page.tournamentCount, 1)
  assert.match(tournamentQuery, /gct\.golf_course_name/)
  assert.doesNotMatch(tournamentQuery, /COALESCE\(gct\.active, 1\) = 1/)
  assert.deepEqual(tournamentParams, ['course-1', 'Golf Homiez Lake View', 'UT'])
  assert.equal(page.tournaments[0].portalPath, '/tournaments/71f75205-d8a0-4c0f-8504-4859d928')
})

test('public golf-course page tournament rollup does not reference missing course columns', async () => {
  let tournamentQuery = null
  const db = {
    async execute(sql, params = []) {
      if (/FROM golf_course_public_pages WHERE slug/i.test(sql)) {
        return [[{
          id: 'page-1',
          host_account_id: 'host-1',
          golf_course_id: 'course-1',
          slug: 'golfhomiezlakeviewut',
          golf_course_name: 'Golf Homiez Lake View',
          summary: 'Course summary',
          state_code: 'UT',
          is_published: 1,
        }]]
      }
      if (/FROM information_schema\.COLUMNS/i.test(sql)) {
        if (params[0] === 'tournaments') {
          return [[
            'id', 'title', 'starts_at', 'status', 'is_public', 'archived_at', 'host_account_id', 'created_at',
          ].map((COLUMN_NAME) => ({ COLUMN_NAME }))]
        }
        if (params[0] === 'golf_course_tournaments') return [[]]
      }
      if (/FROM tournaments t/i.test(sql)) {
        tournamentQuery = sql
        return [[{ id: 'tournament-1', tournament_identifier: null, name: 'Lake View Open', start_date: '2026-09-12', status: 'published' }]]
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }

  const page = await getGolfCoursePublicPageBySlug(db, 'golfhomiezlakeviewut')
  assert.equal(page.tournamentCount, 1)
  assert.match(tournamentQuery, /t\.host_account_id/)
  assert.doesNotMatch(tournamentQuery, /t\.golf_course_id/)
  assert.match(tournamentQuery, /DATE\(t\.starts_at\) AS start_date/)
  assert.match(tournamentQuery, /t\.starts_at DESC/)
})



test('additional host accounts resolve the shared golf-course public page by golf course id', async () => {
  const sharedPage = {
    id: 'page-1',
    host_account_id: 'host-admin',
    golf_course_id: 'course-1',
    slug: 'murrayparkwayut',
    golf_course_name: 'Murray Parkway',
    summary: 'Shared course page',
    state_code: 'UT',
    is_published: 1,
  }
  const db = {
    async execute(sql) {
      if (/FROM golf_course_public_pages WHERE host_account_id/i.test(sql)) return [[]]
      if (/SELECT golf_course_id FROM host_accounts WHERE id/i.test(sql)) return [[{ golf_course_id: 'course-1' }]]
      if (/FROM golf_course_public_pages WHERE golf_course_id/i.test(sql)) return [[sharedPage]]
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }

  const page = await getGolfCoursePublicPageByHostAccount(db, 'host-additional')
  assert.equal(page.hostAccountId, 'host-admin')
  assert.equal(page.golfCourseId, 'course-1')
  assert.equal(page.slug, 'murrayparkwayut')
})

test('host public-page updates can clear optional website, banner, and contact fields', async () => {
  let updateParams = null
  const existing = {
    id: 'page-1',
    host_account_id: 'host-1',
    golf_course_id: 'course-1',
    slug: 'murrayparkwayut',
    golf_course_name: 'Murray Parkway',
    summary: 'Existing summary',
    banner_image_url: 'https://example.com/banner.jpg',
    banner_image_data: 'data:image/jpeg;base64,YWJj',
    website_url: 'https://example.com',
    contact_phone: '801-555-1212',
    address_line1: '123 Parkway Drive',
    city: 'Murray',
    state_code: 'UT',
    postal_code: '84123',
    is_published: 1,
  }
  const db = {
    async execute(sql, params = []) {
      if (/SELECT \* FROM golf_course_public_pages WHERE host_account_id/i.test(sql)) return [[existing]]
      if (/SELECT \* FROM golf_course_public_pages WHERE id = \?/i.test(sql)) return [[existing]]
      if (/UPDATE golf_course_public_pages/i.test(sql)) {
        updateParams = params
        Object.assign(existing, {
          golf_course_name: params[0],
          summary: params[1],
          banner_image_url: params[2],
          banner_image_data: params[3],
          website_url: params[4],
          contact_phone: params[5],
          address_line1: params[6],
          city: params[7],
          state_code: params[8],
          postal_code: params[9],
          is_published: params[10],
        })
        return [{ affectedRows: 1 }]
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }

  const page = await updateGolfCoursePublicPageForHost(db, 'host-1', {
    summary: 'Updated summary',
    bannerImageUrl: null,
    bannerImageData: null,
    websiteUrl: null,
    contactPhone: null,
    isPublished: false,
  })

  assert.equal(updateParams[2], null)
  assert.equal(updateParams[3], null)
  assert.equal(updateParams[4], null)
  assert.equal(updateParams[5], null)
  assert.equal(updateParams[10], 0)
  assert.equal(page.bannerImageUrl, null)
  assert.equal(page.bannerImageData, null)
  assert.equal(page.websiteUrl, null)
  assert.equal(page.isPublished, false)
})

test('host-uploaded banner data accepts safe image data URLs and rejects unsafe content', () => {
  assert.equal(sanitizeUploadedBannerData('data:image/jpeg;base64,YWJj'), 'data:image/jpeg;base64,YWJj')
  assert.equal(sanitizeUploadedBannerData(''), null)
  assert.throws(() => sanitizeUploadedBannerData('data:text/html;base64,PHNjcmlwdD4='), /uploaded JPG, PNG, or WebP/i)
})

test('catalog defaults populate missing public profile contact and address data without replacing host edits', async () => {
  const row = {
    id: 'page-1',
    host_account_id: 'host-1',
    golf_course_id: 'course-1',
    slug: 'murrayparkwayut',
    golf_course_name: 'Old course name',
    summary: 'Course summary',
    banner_image_data: null,
    website_url: 'https://host-edited.example.com',
    contact_phone: null,
    address_line1: null,
    city: null,
    state_code: 'UT',
    postal_code: null,
    is_published: 1,
    catalog_golf_course_name: 'Murray Parkway',
    catalog_phone: '801 555 1212',
    catalog_address_line1: '123 Parkway Drive',
    catalog_city: 'Murray',
    catalog_state_code: 'UT',
    catalog_postal_code: '84123',
    catalog_website_url: 'https://catalog.example.com',
  }
  const db = {
    async execute(sql, params = []) {
      if (/SELECT gcpp\.\*/i.test(sql)) return [[row]]
      if (/UPDATE golf_course_public_pages/i.test(sql)) {
        Object.assign(row, {
          golf_course_name: params[0],
          website_url: params[1],
          contact_phone: params[2],
          address_line1: params[3],
          city: params[4],
          state_code: params[5],
          postal_code: params[6],
        })
        return [{ affectedRows: 1 }]
      }
      if (/SELECT \* FROM golf_course_public_pages WHERE host_account_id/i.test(sql)) return [[row]]
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }

  const page = await syncGolfCoursePublicPageCatalogDefaults(db, 'host-1')
  assert.equal(page.golfCourseName, 'Murray Parkway')
  assert.equal(page.websiteUrl, 'https://host-edited.example.com')
  assert.equal(page.contactPhone, '801 555 1212')
  assert.equal(page.addressLine1, '123 Parkway Drive')
  assert.equal(page.postalCode, '84123')
})

test('migration, API route, host editor, frontend route, and correlated logging are wired', () => {
  const migration = fs.readFileSync(new URL('../migration_scripts/20260804_066_golf_course_public_pages.sql', import.meta.url), 'utf8')
  const bannerMigration = fs.readFileSync(new URL('../migration_scripts/20260806_068_host_course_profile_banner.sql', import.meta.url), 'utf8')
  const migrationIndex = fs.readFileSync(new URL('../server/migrations/index.js', import.meta.url), 'utf8')
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const adminPortal = fs.readFileSync(new URL('../server/lib/admin-portal.js', import.meta.url), 'utf8')
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const hostProfile = fs.readFileSync(new URL('../src/pages/HostProfile.tsx', import.meta.url), 'utf8')
  const adminPage = fs.readFileSync(new URL('../src/pages/AdminPortal.tsx', import.meta.url), 'utf8')

  assert.match(migration, /CREATE TABLE IF NOT EXISTS golf_course_public_pages/)
  assert.match(migration, /UNIQUE KEY uq_golf_course_public_pages_slug/)
  assert.match(migrationIndex, /version: '20260804_066'/)
  assert.match(bannerMigration, /banner_image_data MEDIUMTEXT/)
  assert.match(migrationIndex, /version: '20260806_068'/)
  assert.match(server, /app\.get\('\/api\/golf-course-pages\/:slug'/)
  assert.match(server, /golf_course_public_page_loaded/)
  assert.match(adminPortal, /createGolfCoursePublicPageForApprovedHost/)
  assert.match(app, /path="\/:golfCourseSlug\/calendar"/)
  assert.match(app, /path="\/:golfCourseSlug"/)
  const coursePage = fs.readFileSync(new URL('../src/pages/GolfCoursePage.tsx', import.meta.url), 'utf8')
  const calendarPage = fs.readFileSync(new URL('../src/pages/GolfCourseCalendarPage.tsx', import.meta.url), 'utf8')
  const courseNav = fs.readFileSync(new URL('../src/components/GolfCoursePublicNav.tsx', import.meta.url), 'utf8')
  assert.match(coursePage, /Tournament Calendar/)
  assert.match(coursePage, /golfCourseCalendarHappyLink/)
  assert.match(calendarPage, /golfCourseCalendarGrid/)
  assert.match(calendarPage, /Point of Contact/)
  assert.match(calendarPage, /Name of Course/)
  assert.match(calendarPage, /calendar_tournament_selected/)
  assert.match(courseNav, /Tournament Calendar/)
  assert.match(hostProfile, /Public golf-course page/)
  assert.match(hostProfile, /ImageUploadField/)
  assert.match(hostProfile, /defaultGolfCourseBanner/)
  assert.match(hostProfile, /readOnly aria-readonly="true"/)
  assert.match(hostProfile, /logFrontendEvent/)
  assert.match(adminPage, /host_account_approval_completed/)
})
