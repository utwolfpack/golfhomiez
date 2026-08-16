/* global process */
import 'dotenv/config'
import { createHash, randomUUID } from 'node:crypto'
import { getPool, closeDb } from '../db.js'
import { logApi, logError, logInfo } from '../lib/logger.js'
import {
  DEMO_HOST_COURSE_HOLES,
  DEMO_HOST_GOLF_COURSE,
  DEMO_SEED_TAG,
  buildDemoDataPlan,
  buildHoleDetails,
  buildSkinsPushHoleDetails,
  displayNameFromEmail,
  normalizeDemoEmail,
  normalizePopulationType,
  stableDemoId,
  summarizeDemoPlan,
} from '../lib/demo-data-population-plan.js'

function printUsage() {
  console.log(`Manual GolfHomiez demo data population

Usage:
  npm run data:populate:all -- --dry-run
  npm run data:populate:all -- --confirm
  npm run data:populate:user -- --confirm
  npm run data:populate:host -- --confirm
  npm run data:populate:organizer -- --confirm

Options:
  --dry-run                       Build the plan, execute inside a transaction, and roll back.
  --confirm                       Required before demo data is committed.
  --user-email <email>            Override the golfer demo account email.
  --host-email <email>            Override the host demo account email.
  --organizer-email <email>       Override the organizer demo account email.
  --help                          Show this help text.

This script is intentionally manual-only. It is not wired into npm install or postinstall.
`)
}

function readValueArg(args, index, flag) {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
  return value
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const args = [...argv]
  const options = {
    scope: '',
    dryRun: false,
    confirm: false,
    help: false,
    userEmail: env.DEMO_USER_EMAIL || '',
    hostEmail: env.DEMO_HOST_EMAIL || '',
    organizerEmail: env.DEMO_ORGANIZER_EMAIL || '',
  }

  if (args[0] && !args[0].startsWith('--')) options.scope = args.shift()

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--confirm') options.confirm = true
    else if (arg === '--user-email') {
      options.userEmail = readValueArg(args, index, arg)
      index += 1
    } else if (arg === '--host-email') {
      options.hostEmail = readValueArg(args, index, arg)
      index += 1
    } else if (arg === '--organizer-email') {
      options.organizerEmail = readValueArg(args, index, arg)
      index += 1
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }

  options.scope = options.scope || env.DEMO_DATA_SCOPE || 'all'
  return options
}

export function assertSafeExecutionOptions(options) {
  if (options.help) return
  normalizePopulationType(options.scope)
  if (!options.dryRun && !options.confirm) {
    throw new Error('Refusing to populate demo data without --confirm. Run with --dry-run first to review the generated counts.')
  }
}

function quoteIdentifier(name) {
  const value = String(name || '')
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`Unsafe SQL identifier: ${name}`)
  return `\`${value}\``
}

async function tableExists(db, tableName) {
  const [rows] = await db.execute(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
    [tableName],
  )
  return rows.length > 0
}

async function columnsFor(db, tableName) {
  const [rows] = await db.execute(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [tableName],
  )
  return new Set(rows.map((row) => row.COLUMN_NAME))
}

function hasColumn(columns, column) {
  return columns.has(column)
}

function scopedPayload(payload, columns) {
  return Object.fromEntries(Object.entries(payload).filter(([column]) => hasColumn(columns, column)))
}

function buildInsertSql(tableName, columns, updateColumns) {
  if (!columns.length) throw new Error(`No insertable columns resolved for ${tableName}`)
  const names = columns.map(quoteIdentifier).join(', ')
  const values = columns.map(() => '?').join(', ')
  const updates = updateColumns.length
    ? updateColumns.map((column) => `${quoteIdentifier(column)} = VALUES(${quoteIdentifier(column)})`).join(', ')
    : `${quoteIdentifier(columns[0])} = ${quoteIdentifier(columns[0])}`
  return `INSERT INTO ${quoteIdentifier(tableName)} (${names}) VALUES (${values}) ON DUPLICATE KEY UPDATE ${updates}`
}

async function upsertRow(db, tableName, payload, preferredUpdates = []) {
  if (!(await tableExists(db, tableName))) return { skipped: true, table: tableName }
  const columns = await columnsFor(db, tableName)
  const row = scopedPayload(payload, columns)
  const insertColumns = Object.keys(row)
  if (!insertColumns.length) return { skipped: true, table: tableName }
  const updateColumns = preferredUpdates.filter((column) => insertColumns.includes(column))
  await db.execute(buildInsertSql(tableName, insertColumns, updateColumns), insertColumns.map((column) => row[column]))
  return { skipped: false, table: tableName }
}

async function insertRow(db, tableName, payload) {
  if (!(await tableExists(db, tableName))) return { skipped: true, table: tableName }
  const columns = await columnsFor(db, tableName)
  const row = scopedPayload(payload, columns)
  const insertColumns = Object.keys(row)
  if (!insertColumns.length) return { skipped: true, table: tableName }
  const names = insertColumns.map(quoteIdentifier).join(', ')
  const values = insertColumns.map(() => '?').join(', ')
  await db.execute(`INSERT INTO ${quoteIdentifier(tableName)} (${names}) VALUES (${values})`, insertColumns.map((column) => row[column]))
  return { skipped: false, table: tableName }
}


function cleanSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 191)
}

function cleanCompactSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 191)
}

function normalizeCourseName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function pickColumn(columns, candidates) {
  return candidates.find((column) => hasColumn(columns, column)) || null
}

function coerceNumberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function hashText(value) {
  return createHash('sha256').update(String(value || '')).digest('hex')
}


const TOURNAMENT_REGISTRATION_TEAM_NAMES = Object.freeze([
  'Cedar Ridge Crew', 'Lake View Low Scores', 'Copper Canyon Four', 'Wasatch Weekend Club',
  'Sunset Birdie Team', 'Back Nine Buddies', 'Tooele Tee Club', 'Mountain Cup Players',
  'Fairway Friends', 'Pin Seekers', 'Eagle Crest Group', 'Green Jacket Guests',
  'High Desert Hitters', 'Silver Lake Scramble', 'Oak Hollow Outing', 'Juniper Ridge Players',
  'Red Rock Rollers', 'Blue Tee Travelers', 'Valley Greens', 'Summit Ridge Strikers',
])

const TOURNAMENT_PLAYER_NAMES = Object.freeze([
  'Reese Carter', 'Jordan Mitchell', 'Avery Stone', 'Parker Brooks', 'Cameron Hayes',
  'Riley Morgan', 'Logan Bennett', 'Taylor Reed', 'Casey Monroe', 'Morgan Ellis',
  'Quinn Foster', 'Hayden Parker', 'Blake Sullivan', 'Sawyer Lane', 'Emerson Brooks',
  'Kai Jensen', 'Rowan Blake', 'Dakota Miller', 'Finley Hayes', 'Harper Collins',
  'Jamie Walker', 'Kendall Price', 'Skyler Hughes', 'Micah Grant', 'Dylan Porter',
])

function normalizeGolfCourseRow(row, columns) {
  const idColumn = pickColumn(columns, ['id', 'course_id']) || 'id'
  const stateColumn = pickColumn(columns, ['state_code', 'state'])
  const stateNameColumn = pickColumn(columns, ['state_name'])
  const websiteColumn = pickColumn(columns, ['golf_course_website', 'website', 'website_url'])
  return {
    id: String(row[idColumn] || '').trim(),
    name: normalizeCourseName(row.name || row.course_name || row.golf_course_name),
    stateCode: String(stateColumn ? row[stateColumn] || '' : '').trim().toUpperCase(),
    stateName: String(stateNameColumn ? row[stateNameColumn] || '' : '').trim(),
    city: String(row.city || '').trim(),
    postalCode: String(row.postal_code || row.zip_code || '').trim(),
    website: String(websiteColumn ? row[websiteColumn] || '' : '').trim(),
    courseRating: coerceNumberOrNull(row.course_rating),
    slopeRating: coerceNumberOrNull(row.slope_rating),
    parTotal: coerceNumberOrNull(row.par_total),
    totalYardage: coerceNumberOrNull(row.total_yardage),
  }
}

async function loadCourseHoleMetadata(db, courseId) {
  if (!(await tableExists(db, 'golf_course_holes'))) return []
  const columns = await columnsFor(db, 'golf_course_holes')
  const courseIdColumn = pickColumn(columns, ['course_id', 'golf_course_id'])
  if (!courseIdColumn || !hasColumn(columns, 'hole_number')) return []
  const selectColumns = [
    'hole_number', 'tee_color', 'tee_name', 'par', 'yards', 'stroke_index',
    'front_latitude', 'front_longitude', 'center_latitude', 'center_longitude', 'back_latitude', 'back_longitude',
  ].filter((column) => hasColumn(columns, column))
  const activePredicate = hasColumn(columns, 'active') ? ' AND COALESCE(active, 1) = 1' : ''
  const orderColumns = ['tee_color', 'tee_name', 'hole_number']
    .filter((column) => hasColumn(columns, column))
    .map(quoteIdentifier)
    .join(', ')
  const [rows] = await db.execute(
    `SELECT ${selectColumns.map(quoteIdentifier).join(', ')}
       FROM golf_course_holes
      WHERE ${quoteIdentifier(courseIdColumn)} = ?${activePredicate}
      ORDER BY ${orderColumns}`,
    [courseId],
  )
  const groups = new Map()
  for (const row of rows) {
    const key = `${String(row.tee_color || 'default').toLowerCase()}|${String(row.tee_name || 'default').toLowerCase()}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  const preferred = [...groups.entries()]
    .map(([key, value]) => ({ key, value: value.slice().sort((a, b) => Number(a.hole_number) - Number(b.hole_number)) }))
    .filter((group) => group.value.length >= 18)
    .sort((a, b) => {
      const rank = (group) => (/white|blue|default/.test(group.key) ? 0 : 1)
      return rank(a) - rank(b) || a.key.localeCompare(b.key)
    })[0]
  if (!preferred) return []
  return preferred.value.slice(0, 18).map((hole) => ({
    hole: Number(hole.hole_number),
    par: coerceNumberOrNull(hole.par),
    yards: coerceNumberOrNull(hole.yards),
    strokeIndex: coerceNumberOrNull(hole.stroke_index),
    teeColor: String(hole.tee_color || 'white'),
    teeName: String(hole.tee_name || hole.tee_color || 'white'),
    frontLatitude: coerceNumberOrNull(hole.front_latitude),
    frontLongitude: coerceNumberOrNull(hole.front_longitude),
    centerLatitude: coerceNumberOrNull(hole.center_latitude),
    centerLongitude: coerceNumberOrNull(hole.center_longitude),
    backLatitude: coerceNumberOrNull(hole.back_latitude),
    backLongitude: coerceNumberOrNull(hole.back_longitude),
  })).filter((hole) => hole.hole >= 1 && hole.hole <= 18 && hole.par > 0 && hole.yards > 0)
}

async function loadAvailableGolfCoursesForUserDemo(db) {
  if (!(await tableExists(db, 'golf_courses'))) {
    throw new Error('Cannot populate golfer demo data because golf_courses does not exist. Import or create golf course data before running data:populate:user.')
  }
  const columns = await columnsFor(db, 'golf_courses')
  const idColumn = pickColumn(columns, ['id', 'course_id'])
  const nameColumn = pickColumn(columns, ['name', 'course_name', 'golf_course_name'])
  if (!idColumn || !nameColumn) throw new Error('Cannot populate golfer demo data because golf_courses is missing id/name columns.')
  const selectColumns = [
    idColumn, nameColumn, 'state_code', 'state', 'state_name', 'city', 'postal_code', 'zip_code',
    'golf_course_website', 'website', 'website_url', 'course_rating', 'slope_rating', 'par_total', 'total_yardage',
  ].filter((column, index, all) => hasColumn(columns, column) && all.indexOf(column) === index)
  const activePredicate = hasColumn(columns, 'active') ? ' WHERE COALESCE(active, 1) = 1' : ''
  const orderColumns = [pickColumn(columns, ['state_code', 'state']), nameColumn].filter(Boolean).map(quoteIdentifier).join(', ')
  const [rows] = await db.execute(
    `SELECT ${selectColumns.map(quoteIdentifier).join(', ')}
       FROM golf_courses${activePredicate}
      ORDER BY ${orderColumns}
      LIMIT 250`,
  )
  const courses = []
  for (const row of rows) {
    const course = normalizeGolfCourseRow(row, columns)
    if (!course.id || !course.name) continue
    const holes = await loadCourseHoleMetadata(db, course.id)
    if (holes.length < 18) continue
    courses.push({ ...course, holes, teeColor: holes[0]?.teeColor || 'white' })
    if (courses.length >= 40) break
  }
  if (!courses.length) {
    throw new Error('Cannot populate golfer demo data because no golf_courses rows with 18 holes of par and yardage metadata were found. Import golf_course_holes or run data:populate:host to create the Golf Homiez Lake View demo course first.')
  }
  return courses
}

function attachCourseToHoleScoreRecord(record, course, totalScore) {
  record.golfCourseId = course.id
  record.courseId = course.id
  record.state = course.stateCode
  record.course = course.name
  record.courseRating = course.courseRating
  record.slopeRating = course.slopeRating
  record.teeColor = course.teeColor || record.teeColor || 'white'
  record.holes = buildHoleDetails(totalScore, 18, course.holes, record.teeColor)
  return record
}

function applyGolfCourseCatalogToUserPlan(userPlan, courses) {
  const pick = (index) => courses[index % courses.length]
  userPlan.soloRounds.forEach((round, index) => attachCourseToHoleScoreRecord(round, pick(index), round.score))
  userPlan.teamChallenges.forEach((challenge, index) => {
    const course = pick(index + userPlan.soloRounds.length)
    challenge.golfCourseId = course.id
    challenge.courseId = course.id
    challenge.state = course.stateCode
    challenge.course = course.name
    challenge.courseRating = course.courseRating
    challenge.slopeRating = course.slopeRating
    challenge.teeColor = course.teeColor || challenge.teeColor || 'white'
    if (challenge.scoringType === 'skins_push') {
      challenge.proposerHoles = buildSkinsPushHoleDetails(challenge.proposerTotal, 18, course.holes, challenge.teeColor, 'proposer')
      challenge.challengedHoles = buildSkinsPushHoleDetails(challenge.challengedTotal, 18, course.holes, challenge.teeColor, 'challenged')
    } else {
      challenge.proposerHoles = buildHoleDetails(challenge.proposerTotal, 18, course.holes, challenge.teeColor)
      challenge.challengedHoles = buildHoleDetails(challenge.challengedTotal, 18, course.holes, challenge.teeColor)
    }
  })
  userPlan.individualChallenges.forEach((challenge, index) => {
    const course = pick(index + userPlan.soloRounds.length + userPlan.teamChallenges.length)
    challenge.golfCourseId = course.id
    challenge.courseId = course.id
    challenge.state = course.stateCode
    challenge.course = course.name
    challenge.courseRating = course.courseRating
    challenge.slopeRating = course.slopeRating
    challenge.teeColor = course.teeColor || challenge.teeColor || 'white'
    challenge.participants = challenge.participants.map((participant) => ({
      ...participant,
      holes: buildHoleDetails(participant.score, 18, course.holes, challenge.teeColor),
    }))
  })
  return userPlan
}

async function prepareUserDemoCourses(db, plan) {
  const courses = await loadAvailableGolfCoursesForUserDemo(db)
  applyGolfCourseCatalogToUserPlan(plan.user, courses)
  logApi('manual_demo_data_user_courses_resolved', {
    courseCount: courses.length,
    sampleCourseNames: courses.slice(0, 5).map((course) => course.name),
  })
  return courses
}

async function ensureDemoGolfCourse(db) {
  if (!(await tableExists(db, 'golf_courses'))) throw new Error('Cannot create the Golf Homiez Lake View demo course because golf_courses does not exist. Run database migrations before populating demo data.')
  if (!(await tableExists(db, 'golf_course_holes'))) throw new Error('Cannot create the Golf Homiez Lake View demo course because golf_course_holes does not exist. Run database migrations before populating demo data.')
  const courseId = stableDemoId('demo-golf-course', DEMO_HOST_GOLF_COURSE.name, DEMO_HOST_GOLF_COURSE.stateCode, DEMO_HOST_GOLF_COURSE.city)
  await upsertRow(db, 'golf_courses', {
    id: courseId,
    external_course_id: `manual-${cleanSlug(DEMO_HOST_GOLF_COURSE.name)}`,
    source: 'manual-population',
    name: DEMO_HOST_GOLF_COURSE.name,
    normalized_name: DEMO_HOST_GOLF_COURSE.normalizedName,
    state_code: DEMO_HOST_GOLF_COURSE.stateCode,
    state: DEMO_HOST_GOLF_COURSE.stateCode,
    state_name: DEMO_HOST_GOLF_COURSE.stateName,
    county: DEMO_HOST_GOLF_COURSE.county,
    city: DEMO_HOST_GOLF_COURSE.city,
    country: 'US',
    course_type: DEMO_HOST_GOLF_COURSE.courseType,
    holes_count: DEMO_HOST_GOLF_COURSE.holesCount,
    par_total: DEMO_HOST_GOLF_COURSE.parTotal,
    total_yardage: DEMO_HOST_GOLF_COURSE.totalYardage,
    course_rating: DEMO_HOST_GOLF_COURSE.courseRating,
    slope_rating: DEMO_HOST_GOLF_COURSE.slopeRating,
    address: DEMO_HOST_GOLF_COURSE.address,
    postal_code: DEMO_HOST_GOLF_COURSE.postalCode,
    phone: DEMO_HOST_GOLF_COURSE.phone,
    website: DEMO_HOST_GOLF_COURSE.websitePath,
    golf_course_website: DEMO_HOST_GOLF_COURSE.websitePath,
    latitude: DEMO_HOST_GOLF_COURSE.latitude,
    longitude: DEMO_HOST_GOLF_COURSE.longitude,
    is_manual: 1,
    active: 1,
    raw_list_payload: JSON.stringify({ source: 'manual-data-population', seedTag: DEMO_SEED_TAG }),
    raw_detail_payload: JSON.stringify({ source: 'manual-data-population', seedTag: DEMO_SEED_TAG }),
    imported_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  }, ['external_course_id', 'source', 'name', 'normalized_name', 'state_code', 'state', 'state_name', 'county', 'city', 'country', 'course_type', 'holes_count', 'par_total', 'total_yardage', 'course_rating', 'slope_rating', 'address', 'postal_code', 'phone', 'website', 'golf_course_website', 'latitude', 'longitude', 'is_manual', 'active', 'raw_list_payload', 'raw_detail_payload', 'imported_at', 'updated_at'])

  for (const hole of DEMO_HOST_COURSE_HOLES) {
    const latOffset = Number(hole.hole) * 0.00035
    await upsertRow(db, 'golf_course_holes', {
      id: stableDemoId('demo-golf-course-hole', courseId, hole.hole, 'white'),
      course_id: courseId,
      golf_course_id: courseId,
      source: 'manual-population',
      hole_number: hole.hole,
      tee_name: 'White',
      tee_color: 'white',
      par: hole.par,
      yards: hole.yards,
      stroke_index: hole.strokeIndex,
      front_latitude: DEMO_HOST_GOLF_COURSE.latitude + latOffset,
      front_longitude: DEMO_HOST_GOLF_COURSE.longitude - latOffset,
      center_latitude: DEMO_HOST_GOLF_COURSE.latitude + latOffset + 0.00015,
      center_longitude: DEMO_HOST_GOLF_COURSE.longitude - latOffset - 0.00015,
      back_latitude: DEMO_HOST_GOLF_COURSE.latitude + latOffset + 0.0003,
      back_longitude: DEMO_HOST_GOLF_COURSE.longitude - latOffset - 0.0003,
      active: 1,
      raw_payload: JSON.stringify({ source: 'manual-data-population', seedTag: DEMO_SEED_TAG }),
      created_at: new Date(),
      updated_at: new Date(),
    }, ['source', 'tee_name', 'tee_color', 'par', 'yards', 'stroke_index', 'front_latitude', 'front_longitude', 'center_latitude', 'center_longitude', 'back_latitude', 'back_longitude', 'active', 'raw_payload', 'updated_at'])
  }

  return {
    ...DEMO_HOST_GOLF_COURSE,
    id: courseId,
    holes: DEMO_HOST_COURSE_HOLES,
    teeColor: 'white',
  }
}

async function associateHostToDemoCourse(db, host, course) {
  const hostDisplayName = displayNameFromEmail(host.email, 'Host')
  const commonPayload = {
    auth_user_id: host.id,
    email: host.email,
    golf_course_id: course.id,
    golf_course_name: course.name,
    account_name: 'Golf Homiez Lake View Host Account',
    course_name: course.name,
    name: hostDisplayName,
    reset_email: host.email,
    contact_name: hostDisplayName,
    phone: course.phone || '801 555 0101',
    website_url: course.websitePath,
    city: course.city,
    state: course.stateCode,
    state_code: course.stateCode,
    postal_code: course.postalCode,
    notes: 'Host account associated with Golf Homiez Lake View.',
    is_validated: 1,
    validated_at: new Date(),
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }
  await upsertRow(db, 'host_accounts', { id: host.hostAccountId, ...commonPayload }, Object.keys(commonPayload).filter((column) => column !== 'created_at'))
  await upsertRow(db, 'host_role_accounts', { id: host.hostRoleAccountId, role_assignment_id: host.roleAssignmentId, ...commonPayload }, ['role_assignment_id', ...Object.keys(commonPayload).filter((column) => column !== 'created_at')])
}

async function ensureDemoGolfCoursePublicPage(db, host, course) {
  await upsertRow(db, 'golf_course_public_pages', {
    id: stableDemoId('demo-golf-course-public-page', host.accountId, course.id),
    host_account_id: host.accountId,
    golf_course_id: course.id,
    slug: course.publicPageSlug || cleanCompactSlug(`${course.name}${course.stateCode}`),
    golf_course_name: course.name,
    summary: `${course.name} is a public golf course in ${course.city}, ${course.stateName} with 18 holes, par ${course.parTotal}, and ${course.totalYardage} yards from the white tees. It gives golfers, leagues, and tournament hosts a clean place to discover upcoming events and course details.`,
    banner_image_url: '/tournament-templates/golf-course.jpg',
    banner_image_data: null,
    website_url: course.websitePath,
    contact_phone: course.phone,
    address_line1: course.address,
    city: course.city,
    state_code: course.stateCode,
    postal_code: course.postalCode,
    source_website_url: course.websitePath,
    source_last_synced_at: new Date(),
    is_published: 1,
    created_at: new Date(),
    updated_at: new Date(),
  }, ['golf_course_id', 'slug', 'golf_course_name', 'summary', 'banner_image_url', 'banner_image_data', 'website_url', 'contact_phone', 'address_line1', 'city', 'state_code', 'postal_code', 'source_website_url', 'source_last_synced_at', 'is_published', 'updated_at'])
}

async function syncDemoTournamentSearchRecord(db, tournament, course, correlationId) {
  const published = String(tournament.status || '').trim().toLowerCase() === 'published'
  await upsertRow(db, 'golf_course_tournaments', {
    id: stableDemoId('demo-golfhomiez-tournament-search', tournament.id),
    discovery_key: hashText(`golfhomiez:${tournament.id}`),
    golf_course_id: course.id,
    golf_course_name: course.name,
    tournament_name: tournament.name,
    state_code: course.stateCode,
    city: course.city,
    zip_code: course.postalCode,
    tournament_date: tournament.startDate,
    tournament_website: `/tournaments/${tournament.tournamentIdentifier || tournament.id}`,
    source_url: `/tournaments/${tournament.tournamentIdentifier || tournament.id}`,
    discovered_text: `${tournament.name} ${tournament.description || ''} ${course.name}`.trim(),
    active: published ? 1 : 0,
    first_seen_at: new Date(),
    last_seen_at: new Date(),
    correlation_id: correlationId,
    source_type: 'golfhomiez',
    golfhomiez_tournament_id: tournament.id,
  }, ['golf_course_id', 'golf_course_name', 'tournament_name', 'state_code', 'city', 'zip_code', 'tournament_date', 'tournament_website', 'source_url', 'discovered_text', 'active', 'last_seen_at', 'correlation_id', 'source_type', 'golfhomiez_tournament_id'])
}

async function findAuthUserId(db, email) {
  if (!(await tableExists(db, 'user'))) return null
  const columns = await columnsFor(db, 'user')
  if (!hasColumn(columns, 'email') || !hasColumn(columns, 'id')) return null
  const [rows] = await db.execute('SELECT id FROM `user` WHERE LOWER(email) = LOWER(?) LIMIT 1', [email])
  return rows[0]?.id || null
}

async function ensureAuthUser(db, email, name) {
  const normalizedEmail = normalizeDemoEmail(email)
  const existingId = await findAuthUserId(db, normalizedEmail)
  if (existingId) return { id: existingId, email: normalizedEmail, name }

  const id = stableDemoId('demo-auth-user', normalizedEmail)
  const now = new Date()
  await upsertRow(db, 'user', {
    id,
    name,
    email: normalizedEmail,
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
    username: normalizedEmail.split('@')[0].replace(/[^a-z0-9]+/gi, '-').slice(0, 64),
    displayUsername: normalizedEmail.split('@')[0].replace(/[^a-z0-9]+/gi, '-').slice(0, 64),
  }, ['name', 'email', 'emailVerified', 'image', 'updatedAt', 'username', 'displayUsername'])

  return { id, email: normalizedEmail, name }
}

async function ensureAppUser(db, targetUser) {
  await upsertRow(db, 'app_users', {
    id: stableDemoId('demo-app-user', targetUser.email),
    auth_user_id: targetUser.id,
    email: targetUser.email,
    name: targetUser.name,
    primary_city: 'Salt Lake City',
    primary_state: 'UT',
    primary_zip_code: '84101',
    profile_enriched_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  }, ['auth_user_id', 'email', 'name', 'primary_city', 'primary_state', 'primary_zip_code', 'profile_enriched_at', 'updated_at'])
}

async function ensureRoleAssignment(db, targetUser, roleKey) {
  const id = stableDemoId('demo-role-assignment', roleKey, targetUser.email)
  await upsertRow(db, 'user_role_assignments', {
    id,
    auth_user_id: targetUser.id,
    email: targetUser.email,
    role_key: roleKey,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }, ['auth_user_id', 'email', 'role_key', 'status', 'updated_at'])
  return id
}

async function findTeamIdByName(db, name) {
  if (!(await tableExists(db, 'teams'))) return null
  const columns = await columnsFor(db, 'teams')
  const idColumn = pickColumn(columns, ['id', 'team_id'])
  const nameColumn = pickColumn(columns, ['name', 'team_name'])
  if (!idColumn || !nameColumn) return null
  const [rows] = await db.execute(
    `SELECT ${quoteIdentifier(idColumn)} AS id
       FROM teams
      WHERE ${quoteIdentifier(nameColumn)} = ?
      LIMIT 1`,
    [name],
  )
  return rows.length ? String(rows[0].id) : null
}

async function findTeamIdsByNames(db, names) {
  const uniqueNames = [...new Set((names || []).filter(Boolean))]
  if (!uniqueNames.length || !(await tableExists(db, 'teams'))) return []
  const columns = await columnsFor(db, 'teams')
  const idColumn = pickColumn(columns, ['id', 'team_id'])
  const nameColumn = pickColumn(columns, ['name', 'team_name'])
  if (!idColumn || !nameColumn) return []
  const [rows] = await db.query(
    `SELECT ${quoteIdentifier(idColumn)} AS id
       FROM teams
      WHERE ${quoteIdentifier(nameColumn)} IN (${uniqueNames.map(() => '?').join(', ')})`,
    uniqueNames,
  )
  return rows.map((row) => String(row.id)).filter(Boolean)
}

async function ensureTeam(db, name, members) {
  const preferredId = stableDemoId('demo-team', name)
  let id = await findTeamIdByName(db, name)

  await upsertRow(db, 'teams', {
    id: id || preferredId,
    name,
    created_at: new Date(),
  }, ['name'])

  id = await findTeamIdByName(db, name) || id || preferredId

  if (await tableExists(db, 'team_members')) {
    await db.execute('DELETE FROM team_members WHERE team_id = ?', [id])
    for (const member of members) {
      await insertRow(db, 'team_members', {
        id: member.id || stableDemoId('demo-team-member', id, member.email),
        team_id: id,
        name: member.name,
        email: member.email,
        status: 'active',
        verified: 1,
      })
    }
  }
  return { id, name }
}

function demoTeamMembers(owner, seed, size = 4) {
  return Array.from({ length: size }, (_, index) => {
    if (index === 0) return { id: owner.id, name: owner.name, email: owner.email }
    return {
      id: stableDemoId('demo-auth-user', owner.email, seed, index),
      name: `Lake View Player ${seed}-${index}`,
      email: `utwolfpack+lakeview.teammate.${seed}.${index}@gmail.com`,
    }
  })
}

async function deletePriorUserDemoData(db, targetUser, plan) {
  const challengeIds = [...plan.teamChallenges, ...plan.individualChallenges].map((challenge) => challenge.id)
  const teamNames = [...new Set(plan.teamChallenges.flatMap((challenge) => [challenge.proposerTeamName, challenge.challengedTeamName]))]
  const deterministicTeamIds = teamNames.map((name) => stableDemoId('demo-team', name))
  const existingTeamIds = await findTeamIdsByNames(db, teamNames)
  const teamIds = [...new Set([...deterministicTeamIds, ...existingTeamIds])]

  if (await tableExists(db, 'inbox_challenge_user_state') && challengeIds.length) {
    await db.query(
      `DELETE FROM inbox_challenge_user_state WHERE thread_id IN (${challengeIds.map(() => '?').join(', ')})`,
      challengeIds,
    )
  }
  if (await tableExists(db, 'inbox_messages')) {
    await db.execute(
      `DELETE FROM inbox_messages
        WHERE sender_email = ?
           OR recipient_email = ?
           OR message_body LIKE ?`,
      [targetUser.email, targetUser.email, `%${DEMO_SEED_TAG}%`],
    )
  }
  const soloRoundIds = plan.soloRounds.map((round) => round.id)
  if (await tableExists(db, 'scorecard_hole_drafts')) {
    await db.execute('DELETE FROM scorecard_hole_drafts WHERE created_by_email = ? AND (course LIKE ? OR state IS NOT NULL)', [targetUser.email, `%${DEMO_SEED_TAG}%`])
  }
  if (await tableExists(db, 'scores')) {
    const predicates = ['(created_by_email = ? AND course LIKE ?)']
    const params = [targetUser.email, `%${DEMO_SEED_TAG}%`]
    if (soloRoundIds.length) {
      predicates.push(`id IN (${soloRoundIds.map(() => '?').join(', ')})`)
      params.push(...soloRoundIds)
    }
    await db.query(`DELETE FROM scores WHERE ${predicates.join(' OR ')}`, params)
  }
  if (await tableExists(db, 'team_members') && teamIds.length) {
    await db.query(`DELETE FROM team_members WHERE team_id IN (${teamIds.map(() => '?').join(', ')})`, teamIds)
  }
  if (await tableExists(db, 'teams') && teamIds.length) {
    await db.query(`DELETE FROM teams WHERE id IN (${teamIds.map(() => '?').join(', ')})`, teamIds)
  }
}

async function populateUserDemoData(db, plan) {
  const targetUser = await ensureAuthUser(db, plan.email, displayNameFromEmail(plan.email))
  await ensureAppUser(db, targetUser)
  await ensureRoleAssignment(db, targetUser, 'user')
  await deletePriorUserDemoData(db, targetUser, plan)

  const teamIdByName = new Map()
  const proposerTeamNames = [...new Set(plan.teamChallenges.map((challenge) => challenge.proposerTeamName).filter(Boolean))]
  for (let index = 0; index < proposerTeamNames.length; index += 1) {
    const team = await ensureTeam(db, proposerTeamNames[index], demoTeamMembers(targetUser, index + 1))
    teamIdByName.set(team.name, team.id)
  }

  for (const challenge of plan.teamChallenges) {
    const team = await ensureTeam(db, challenge.challengedTeamName, [
      { id: stableDemoId('demo-rival-owner', challenge.challengedTeamName), name: `${challenge.challengedTeamName} Captain`, email: `utwolfpack+${challenge.challengedTeamName.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.captain@gmail.com` },
      ...demoTeamMembers(targetUser, `rival-${challenge.id}`, 3).slice(1),
    ])
    teamIdByName.set(team.name, team.id)
  }

  if (await tableExists(db, 'scores')) {
    for (const round of plan.soloRounds) {
      await insertRow(db, 'scores', {
        id: round.id,
        mode: 'solo',
        date: round.date,
        state: round.state,
        course: round.course,
        golf_course_id: round.golfCourseId || round.courseId || null,
        course_rating: round.courseRating,
        slope_rating: round.slopeRating,
        round_score: round.score,
        tee_color: round.teeColor,
        holes_json: JSON.stringify(round.holes),
        created_by_user_id: targetUser.id,
        created_by_email: targetUser.email,
        created_at: new Date(`${round.date}T12:00:00Z`),
      })
    }
  }

  if (await tableExists(db, 'inbox_messages')) {
    for (const challenge of plan.teamChallenges) {
      const proposerTeam = { id: teamIdByName.get(challenge.proposerTeamName) || stableDemoId('demo-team', challenge.proposerTeamName), name: challenge.proposerTeamName }
      const challengedTeam = { id: teamIdByName.get(challenge.challengedTeamName) || stableDemoId('demo-team', challenge.challengedTeamName), name: challenge.challengedTeamName }
      await insertRow(db, 'inbox_messages', {
        id: challenge.id,
        thread_id: challenge.id,
        parent_message_id: null,
        message_type: 'challenge_request',
        sender_user_id: targetUser.id,
        sender_email: targetUser.email,
        sender_name: targetUser.name,
        recipient_user_id: null,
        recipient_email: `utwolfpack+${challenge.challengedTeamName.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.captain@gmail.com`,
        proposer_team_id: proposerTeam.id,
        proposer_team_name: proposerTeam.name,
        challenged_team_id: challengedTeam.id,
        challenged_team_name: challengedTeam.name,
        challenge_status: challenge.status,
        challenge_date: challenge.date,
        challenge_state: challenge.state,
        challenge_course: challenge.course,
        challenge_tee_color: challenge.teeColor,
        challenge_scoring_type: challenge.scoringType,
        challenge_points_per_hole: challenge.pointsPerHole,
        proposer_team_score: challenge.proposerTotal,
        challenged_team_score: challenge.challengedTotal,
        proposer_team_holes_json: JSON.stringify(challenge.proposerHoles),
        challenged_team_holes_json: JSON.stringify(challenge.challengedHoles),
        individual_participants_json: null,
        message_body: `Team challenge between ${proposerTeam.name} and ${challengedTeam.name}.`,
        created_at: new Date(`${challenge.date}T15:00:00Z`),
      })
    }

    for (const challenge of plan.individualChallenges) {
      await insertRow(db, 'inbox_messages', {
        id: challenge.id,
        thread_id: challenge.id,
        parent_message_id: null,
        message_type: 'individual_challenge',
        sender_user_id: targetUser.id,
        sender_email: targetUser.email,
        sender_name: targetUser.name,
        recipient_user_id: null,
        recipient_email: targetUser.email,
        proposer_team_id: null,
        proposer_team_name: null,
        challenged_team_id: null,
        challenged_team_name: null,
        challenge_status: challenge.status,
        challenge_date: challenge.date,
        challenge_state: challenge.state,
        challenge_course: challenge.course,
        challenge_tee_color: challenge.teeColor,
        challenge_scoring_type: 'stroke_play',
        challenge_points_per_hole: null,
        proposer_team_score: null,
        challenged_team_score: null,
        proposer_team_holes_json: null,
        challenged_team_holes_json: null,
        individual_participants_json: JSON.stringify(challenge.participants),
        message_body: `Individual golf challenge with ${challenge.participantCount} players.`,
        created_at: new Date(`${challenge.date}T16:00:00Z`),
      })
    }
  }

  return {
    authUserId: targetUser.id,
    soloRounds: plan.soloRounds.length,
    teamChallenges: plan.teamChallenges.length,
    individualChallenges: plan.individualChallenges.length,
  }
}

async function ensureHostAccounts(db, email) {
  const authUser = await ensureAuthUser(db, email, displayNameFromEmail(email, 'Host'))
  await ensureAppUser(db, authUser)
  const roleAssignmentId = await ensureRoleAssignment(db, authUser, 'host')
  const hostAccountId = stableDemoId('demo-host-account', email)
  const hostRoleAccountId = stableDemoId('demo-host-role-account', email)
  const hostDisplayName = displayNameFromEmail(email, 'Host')
  await upsertRow(db, 'host_accounts', {
    id: hostAccountId,
    auth_user_id: authUser.id,
    email,
    golf_course_name: DEMO_HOST_GOLF_COURSE.name,
    account_name: 'Golf Homiez Lake View Host Account',
    course_name: DEMO_HOST_GOLF_COURSE.name,
    name: hostDisplayName,
    reset_email: email,
    contact_name: hostDisplayName,
    phone: '801 555 0101',
    website_url: DEMO_HOST_GOLF_COURSE.websitePath,
    notes: 'Host account for Golf Homiez Lake View.',
    is_validated: 1,
    validated_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  }, ['auth_user_id', 'email', 'golf_course_name', 'account_name', 'course_name', 'name', 'reset_email', 'contact_name', 'phone', 'website_url', 'notes', 'is_validated', 'validated_at', 'updated_at'])

  await upsertRow(db, 'host_role_accounts', {
    id: hostRoleAccountId,
    role_assignment_id: roleAssignmentId,
    auth_user_id: authUser.id,
    email,
    golf_course_name: DEMO_HOST_GOLF_COURSE.name,
    account_name: 'Golf Homiez Lake View Host Account',
    course_name: DEMO_HOST_GOLF_COURSE.name,
    name: hostDisplayName,
    contact_name: hostDisplayName,
    phone: '801 555 0101',
    website_url: DEMO_HOST_GOLF_COURSE.websitePath,
    city: DEMO_HOST_GOLF_COURSE.city,
    state: DEMO_HOST_GOLF_COURSE.stateCode,
    postal_code: DEMO_HOST_GOLF_COURSE.postalCode,
    notes: 'Host role account for Golf Homiez Lake View.',
    is_validated: 1,
    validated_at: new Date(),
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }, ['role_assignment_id', 'auth_user_id', 'email', 'golf_course_name', 'account_name', 'course_name', 'name', 'contact_name', 'phone', 'website_url', 'city', 'state', 'postal_code', 'notes', 'is_validated', 'validated_at', 'status', 'updated_at'])

  return { ...authUser, roleAssignmentId, accountId: hostRoleAccountId, hostAccountId, hostRoleAccountId }
}

async function ensureOrganizerAccount(db, email) {
  const authUser = await ensureAuthUser(db, email, displayNameFromEmail(email, 'Organizer'))
  await ensureAppUser(db, authUser)
  const roleAssignmentId = await ensureRoleAssignment(db, authUser, 'organizer')
  const accountId = stableDemoId('demo-organizer-account', email)
  const organizerDisplayName = displayNameFromEmail(email, 'Organizer')
  await upsertRow(db, 'organizer_role_accounts', {
    id: accountId,
    role_assignment_id: roleAssignmentId,
    auth_user_id: authUser.id,
    email,
    organizer_name: 'Wasatch Tournament Partners',
    organization_name: 'Wasatch Tournament Partners',
    contact_name: organizerDisplayName,
    display_name: organizerDisplayName,
    name: organizerDisplayName,
    phone: '801 555 0102',
    website_url: null,
    notes: 'Tournament organizer account for Golf Homiez Lake View events.',
    reset_email: email,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }, ['role_assignment_id', 'auth_user_id', 'email', 'organizer_name', 'organization_name', 'contact_name', 'display_name', 'name', 'phone', 'website_url', 'notes', 'reset_email', 'status', 'updated_at'])
  return { ...authUser, accountId }
}

async function deleteTournamentRows(db, tournaments) {
  const ids = tournaments.map((tournament) => tournament.id)
  if (!ids.length) return
  const placeholders = ids.map(() => '?').join(', ')
  for (const [tableName, columns] of [
    ['tournament_team_start_assignments', ['tournament_id']],
    ['tournament_team_scores', ['tournament_id']],
    ['tournament_registrations', ['tournament_id']],
    ['organizer_tournament_invites', ['tournament_id']],
    ['golf_course_tournaments', ['golfhomiez_tournament_id', 'tournament_id']],
  ]) {
    if (!(await tableExists(db, tableName))) continue
    const tableColumns = await columnsFor(db, tableName)
    const matchedColumns = columns.filter((column) => hasColumn(tableColumns, column))
    const predicates = matchedColumns.map((column) => `${quoteIdentifier(column)} IN (${placeholders})`)
    const params = matchedColumns.flatMap(() => ids)
    if (predicates.length) await db.query(`DELETE FROM ${quoteIdentifier(tableName)} WHERE ${predicates.join(' OR ')}`, params)
  }
  if (await tableExists(db, 'tournaments')) {
    await db.query(`DELETE FROM tournaments WHERE id IN (${placeholders})`, ids)
  }
}


function tournamentTeamName(tournament, teamIndex) {
  const base = TOURNAMENT_REGISTRATION_TEAM_NAMES[teamIndex % TOURNAMENT_REGISTRATION_TEAM_NAMES.length]
  return `${base} ${String((teamIndex % 3) + 1)}`
}

function tournamentPlayerName(tournamentIndex, teamIndex, playerIndex) {
  return TOURNAMENT_PLAYER_NAMES[(tournamentIndex + teamIndex + playerIndex) % TOURNAMENT_PLAYER_NAMES.length]
}

function tournamentTeamKey(teamId) {
  return `team:${teamId}`
}

function buildTournamentRegistrationRows(tournament) {
  const tournamentIndex = Number(tournament.tournamentIndex) || 0
  const teamLimit = Number(tournament.teamSlotLimit) || 24
  const teamCount = Math.min(teamLimit, 12 + (tournamentIndex % 7))
  return Array.from({ length: teamCount }, (_, teamIndex) => {
    const teamId = stableDemoId('tournament-registered-team', tournament.id, teamIndex)
    const teamName = tournamentTeamName(tournament, teamIndex)
    const members = Array.from({ length: 4 }, (_, playerIndex) => {
      const playerName = tournamentPlayerName(tournamentIndex, teamIndex, playerIndex)
      const memberId = stableDemoId('tournament-player', tournament.id, teamIndex, playerIndex)
      const emailLocal = `${teamName}.${playerIndex + 1}`.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '')
      return {
        id: memberId,
        name: playerName,
        email: `utwolfpack+${emailLocal}.${String(tournamentIndex + 1).padStart(2, '0')}@gmail.com`,
        registered: true,
        verified: true,
        registrationAuthUserId: memberId,
      }
    })
    return {
      id: stableDemoId('tournament-registration', tournament.id, teamIndex),
      tournamentId: tournament.id,
      authUserId: stableDemoId('tournament-registration-auth', tournament.id, teamIndex),
      email: members[0].email,
      name: members[0].name,
      status: 'registered',
      teamId,
      teamName,
      teamMembers: members,
      teamKey: tournamentTeamKey(teamId),
      registeredAt: new Date(`${tournament.startDate}T13:00:00Z`),
    }
  })
}

function buildTournamentStartAssignmentRows(tournament, registrations) {
  const templateData = tournament.templateData || {}
  const startType = tournament.startType || templateData.startType || 'shotgun'
  const teeTime = String(templateData.teeTime || (startType === 'shotgun' ? '08:00' : '08:30')).slice(0, 5)
  const [hour, minute] = teeTime.split(':').map((part) => Number(part) || 0)
  const interval = Number(templateData.teeTimeIntervalMinutes) || 10
  return registrations.map((registration, index) => {
    const startDate = new Date(Date.UTC(2000, 0, 1, hour, minute + (startType === 'tee-times' ? index * interval : 0), 0))
    const startTime = startDate.toISOString().slice(11, 19)
    return {
      id: stableDemoId('tournament-start-assignment', tournament.id, registration.teamKey),
      tournament_id: tournament.id,
      team_key: registration.teamKey,
      registration_id: registration.id,
      team_id: registration.teamId,
      team_name: registration.teamName,
      start_type: startType,
      start_time: startTime,
      starting_hole: startType === 'shotgun' ? String((index % 18) + 1) : null,
      sort_order: index + 1,
      notes: startType === 'shotgun' ? 'Starting hole assigned by course staff.' : 'Scheduled tee time pairing.',
      correlation_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    }
  })
}

function buildTournamentScoreRows(tournament, registrations, course, correlationId) {
  if (String(tournament.status || '').trim().toLowerCase() !== 'completed') return []
  const tournamentIndex = Number(tournament.tournamentIndex) || 0
  return registrations.map((registration, index) => {
    const totalScore = 61 + ((tournamentIndex + index * 3) % 16)
    return {
      id: stableDemoId('tournament-team-score', tournament.id, registration.teamKey),
      tournament_id: tournament.id,
      team_key: registration.teamKey,
      team_id: registration.teamId,
      team_name: registration.teamName,
      total_score: totalScore,
      holes_json: JSON.stringify(buildHoleDetails(totalScore, 18, course?.holes || DEMO_HOST_COURSE_HOLES, 'white')),
      tee_color: 'white',
      updated_by_auth_user_id: null,
      correlation_id: correlationId,
      created_at: new Date(`${tournament.startDate}T20:00:00Z`),
      updated_at: new Date(),
    }
  })
}

async function populateTournamentRegistrationRows(db, tournament, registrations, correlationId) {
  for (const registration of registrations) {
    await upsertRow(db, 'tournament_registrations', {
      id: registration.id,
      tournament_id: registration.tournamentId,
      auth_user_id: registration.authUserId,
      email: registration.email,
      name: registration.name,
      status: registration.status,
      team_id: registration.teamId,
      team_name: registration.teamName,
      team_members_json: JSON.stringify(registration.teamMembers),
      correlation_id: correlationId,
      created_at: registration.registeredAt,
      updated_at: new Date(),
    }, ['auth_user_id', 'email', 'name', 'status', 'team_id', 'team_name', 'team_members_json', 'correlation_id', 'updated_at'])
  }
  return registrations.length
}

async function populateTournamentStartAssignmentRows(db, assignments, correlationId) {
  for (const assignment of assignments) {
    await upsertRow(db, 'tournament_team_start_assignments', {
      ...assignment,
      correlation_id: correlationId,
    }, ['registration_id', 'team_id', 'team_name', 'start_type', 'start_time', 'starting_hole', 'sort_order', 'notes', 'correlation_id', 'updated_at'])
  }
  return assignments.length
}

async function populateTournamentScoreRows(db, scores) {
  for (const score of scores) {
    await upsertRow(db, 'tournament_team_scores', score, ['team_id', 'team_name', 'total_score', 'holes_json', 'tee_color', 'updated_by_auth_user_id', 'correlation_id', 'updated_at'])
  }
  return scores.length
}

async function populateTournamentOperationalRows(db, tournament, course, correlationId) {
  const registrations = buildTournamentRegistrationRows(tournament)
  const assignments = buildTournamentStartAssignmentRows(tournament, registrations)
  const scores = buildTournamentScoreRows(tournament, registrations, course, correlationId)
  return {
    registrations: await populateTournamentRegistrationRows(db, tournament, registrations, correlationId),
    startAssignments: await populateTournamentStartAssignmentRows(db, assignments, correlationId),
    teamScores: await populateTournamentScoreRows(db, scores),
  }
}

async function insertTournament(db, tournament, owner) {
  await insertRow(db, 'tournaments', {
    id: tournament.id,
    tournament_identifier: tournament.tournamentIdentifier,
    portal_slug: tournament.portalSlug,
    name: tournament.name,
    title: tournament.title,
    description: tournament.description,
    start_date: tournament.startDate,
    starts_at: tournament.startDateTime,
    end_date: tournament.endDate,
    ends_at: tournament.startDateTime,
    status: tournament.status,
    is_public: tournament.isPublic ? 1 : 0,
    host_account_id: owner.hostAccountId,
    organizer_account_id: owner.organizerAccountId,
    organizer_email: owner.organizerEmail,
    golf_course_id: owner.course?.id || tournament.golfCourseId || null,
    golf_course_name: owner.course?.name || tournament.golfCourseName || null,
    course_name: owner.course?.name || tournament.golfCourseName || null,
    state: owner.course?.stateCode || tournament.golfCourseStateCode || null,
    state_code: owner.course?.stateCode || tournament.golfCourseStateCode || null,
    city: owner.course?.city || tournament.golfCourseCity || null,
    created_by_auth_user_id: owner.createdByAuthUserId,
    template_key: tournament.templateKey,
    template_background_image_url: tournament.templateBackgroundImageUrl,
    template_data: JSON.stringify(tournament.templateData),
    team_slot_limit: tournament.teamSlotLimit,
    archived_at: null,
    created_at: new Date(`${tournament.startDate}T10:00:00Z`),
    updated_at: new Date(),
  })
}

async function populateHostDemoData(db, plan, organizerPlan, correlationId) {
  const course = await ensureDemoGolfCourse(db)
  const host = await ensureHostAccounts(db, plan.email)
  await associateHostToDemoCourse(db, host, course)
  await ensureDemoGolfCoursePublicPage(db, host, course)
  const organizer = await ensureOrganizerAccount(db, organizerPlan.email)
  await deleteTournamentRows(db, plan.tournaments)

  for (let index = 0; index < plan.tournaments.length; index += 1) {
    const tournament = plan.tournaments[index]
    await insertTournament(db, tournament, {
      hostAccountId: host.accountId,
      organizerAccountId: index < plan.associatedOrganizerTournamentCount ? organizer.accountId : null,
      organizerEmail: index < plan.associatedOrganizerTournamentCount ? organizer.email : null,
      createdByAuthUserId: host.id,
      course,
    })
    await syncDemoTournamentSearchRecord(db, tournament, course, correlationId)
    await populateTournamentOperationalRows(db, tournament, course, correlationId)
  }

  return {
    authUserId: host.id,
    hostAccountId: host.accountId,
    demoGolfCourseId: course.id,
    demoGolfCourseName: course.name,
    associatedOrganizerAccountId: organizer.accountId,
    tournaments: plan.tournaments.length,
    organizerAssociations: plan.associatedOrganizerTournamentCount,
  }
}

async function populateOrganizerDemoData(db, plan, hostPlan, correlationId) {
  const course = await ensureDemoGolfCourse(db)
  const organizer = await ensureOrganizerAccount(db, plan.email)
  const host = await ensureHostAccounts(db, hostPlan.email)
  await associateHostToDemoCourse(db, host, course)
  await ensureDemoGolfCoursePublicPage(db, host, course)
  await deleteTournamentRows(db, plan.tournaments)

  for (const tournament of plan.tournaments) {
    await insertTournament(db, tournament, {
      hostAccountId: host.accountId,
      organizerAccountId: organizer.accountId,
      organizerEmail: organizer.email,
      createdByAuthUserId: organizer.id,
      course,
    })
    await syncDemoTournamentSearchRecord(db, tournament, course, correlationId)
    await populateTournamentOperationalRows(db, tournament, course, correlationId)
  }

  return {
    authUserId: organizer.id,
    organizerAccountId: organizer.accountId,
    demoGolfCourseId: course.id,
    demoGolfCourseName: course.name,
    associatedHostAccountId: host.accountId,
    tournaments: plan.tournaments.length,
    hostAssociations: plan.associatedHostTournamentCount,
  }
}

async function executePopulation(db, scope, plan, correlationId) {
  const results = {}
  if (scope === 'all') await ensureDemoGolfCourse(db)
  if (scope === 'all' || scope === 'user') {
    await prepareUserDemoCourses(db, plan)
    results.user = await populateUserDemoData(db, plan.user)
  }
  if (scope === 'all' || scope === 'host') results.host = await populateHostDemoData(db, plan.host, plan.organizer, correlationId)
  if (scope === 'all' || scope === 'organizer') results.organizer = await populateOrganizerDemoData(db, plan.organizer, plan.host, correlationId)
  return results
}

export async function executeDemoDataPopulation(options) {
  assertSafeExecutionOptions(options)
  const scope = normalizePopulationType(options.scope)
  const correlationId = randomUUID()
  const plan = buildDemoDataPlan({
    userEmail: options.userEmail,
    hostEmail: options.hostEmail,
    organizerEmail: options.organizerEmail,
  })
  const summary = summarizeDemoPlan(plan)
  const pool = getPool()
  const db = await pool.getConnection()

  logApi('manual_demo_data_population_started', {
    correlationId,
    scope,
    dryRun: options.dryRun,
    summary,
  })

  try {
    await db.beginTransaction()
    const results = await executePopulation(db, scope, plan, correlationId)
    if (options.dryRun) {
      await db.rollback()
      logApi('manual_demo_data_population_dry_run_rolled_back', { correlationId, scope, results })
      return { correlationId, dryRun: true, scope, summary, results, committed: false }
    }
    await db.commit()
    logApi('manual_demo_data_population_committed', { correlationId, scope, results })
    return { correlationId, dryRun: false, scope, summary, results, committed: true }
  } catch (error) {
    await db.rollback()
    logError('manual_demo_data_population_failed', { correlationId, scope, error })
    throw error
  } finally {
    db.release()
  }
}

function isDirectRun() {
  return process.argv[1] && process.argv[1].endsWith('populate-demo-data.js')
}

async function main() {
  let options
  try {
    options = parseArgs()
    if (options.help) {
      printUsage()
      return
    }
    assertSafeExecutionOptions(options)
    const result = await executeDemoDataPopulation(options)
    console.log(JSON.stringify(result, null, 2))
    logInfo('Manual demo data population finished', { correlationId: result.correlationId, scope: result.scope, committed: result.committed })
  } catch (error) {
    console.error('Manual demo data population failed:', error)
    process.exitCode = 1
  } finally {
    await closeDb()
  }
}

if (isDirectRun()) main()
