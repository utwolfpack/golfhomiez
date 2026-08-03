import { randomUUID } from 'node:crypto'
import { getPool } from '../db.js'
import { logApi } from './logger.js'
import { extractOpenGolfCourseHoleEndpointRows, extractOpenGolfCourseHoles, extractOpenGolfCourseTeeSummary, normalizeCourseName, normalizeOpenGolfCoursePayload } from './opengolfapi-client.js'
import { normalizeStateCode, stateNameForCode } from './us-states.js'

const DEFAULT_COURSE_LIMIT = 250
const MAX_COURSE_LIMIT = 1000
const EARTH_RADIUS_YARDS = 6_371_000 * 1.0936132983377

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function toNumber(value) {
  if (value == null || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toInteger(value) {
  const numeric = toNumber(value)
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null
}

function asJson(value) {
  if (value == null) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

let cachedHoleEndpointSchema = null

async function tableColumnExists(db, tableName, columnName) {
  const [rows] = await db.execute(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName],
  )
  return rows.length > 0
}

async function tableIndexExists(db, tableName, indexName) {
  const [rows] = await db.execute(
    `SELECT 1
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
      LIMIT 1`,
    [tableName, indexName],
  )
  return rows.length > 0
}

async function getHoleEndpointSchemaCapabilities(db = getPool(), { refresh = false } = {}) {
  if (cachedHoleEndpointSchema && !refresh) return cachedHoleEndpointSchema
  cachedHoleEndpointSchema = {
    hasTeeLatitude: await tableColumnExists(db, 'golf_course_holes', 'tee_latitude'),
    hasTeeLongitude: await tableColumnExists(db, 'golf_course_holes', 'tee_longitude'),
  }
  return cachedHoleEndpointSchema
}

export async function ensureOpenGolfCourseHoleEndpointSchema(db = getPool()) {
  const added = []
  if (!(await tableColumnExists(db, 'golf_course_holes', 'tee_latitude'))) {
    await db.execute('ALTER TABLE golf_course_holes ADD COLUMN tee_latitude DECIMAL(10,7) NULL AFTER stroke_index')
    added.push('tee_latitude')
  }
  if (!(await tableColumnExists(db, 'golf_course_holes', 'tee_longitude'))) {
    await db.execute('ALTER TABLE golf_course_holes ADD COLUMN tee_longitude DECIMAL(10,7) NULL AFTER tee_latitude')
    added.push('tee_longitude')
  }
  if (!(await tableIndexExists(db, 'golf_course_holes', 'idx_golf_course_holes_tee_coordinates'))) {
    await db.execute('CREATE INDEX idx_golf_course_holes_tee_coordinates ON golf_course_holes (tee_latitude, tee_longitude)')
    added.push('idx_golf_course_holes_tee_coordinates')
  }
  cachedHoleEndpointSchema = null
  const schema = await getHoleEndpointSchemaCapabilities(db, { refresh: true })
  if (added.length) logApi('opengolfapi_hole_endpoint_schema_ensured', { added })
  return { ...schema, added }
}
export function calculateDistanceYards(latitudeA, longitudeA, latitudeB, longitudeB) {
  const lat1 = toNumber(latitudeA)
  const lon1 = toNumber(longitudeA)
  const lat2 = toNumber(latitudeB)
  const lon2 = toNumber(longitudeB)
  if ([lat1, lon1, lat2, lon2].some((value) => value == null)) return null
  const toRadians = (degrees) => degrees * Math.PI / 180
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const startLat = toRadians(lat1)
  const endLat = toRadians(lat2)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(EARTH_RADIUS_YARDS * c)
}

function normalizeCourseRow(row = {}) {
  const stateCode = normalizeStateCode(row.state_code || row.state)
  const parTotal = toInteger(row.par_total ?? row.par)
  const holesCount = toInteger(row.holes_count ?? row.holes)
  return {
    id: normalizeText(row.id),
    externalCourseId: normalizeText(row.external_course_id || row.externalCourseId) || null,
    external_course_id: normalizeText(row.external_course_id || row.externalCourseId) || null,
    source: normalizeText(row.source) || 'manual',
    name: normalizeText(row.name || row.course_name || row.courseName),
    state: stateCode,
    state_code: stateCode,
    stateName: normalizeText(row.state_name || row.stateName) || stateNameForCode(stateCode),
    state_name: normalizeText(row.state_name || row.stateName) || stateNameForCode(stateCode),
    county: normalizeText(row.county) || null,
    city: normalizeText(row.city) || null,
    country: normalizeText(row.country) || 'US',
    courseType: normalizeText(row.course_type || row.courseType || row.type) || null,
    course_type: normalizeText(row.course_type || row.courseType || row.type) || null,
    holesCount,
    holes_count: holesCount,
    parTotal,
    par_total: parTotal,
    par: parTotal,
    totalYardage: toInteger(row.total_yardage || row.totalYardage),
    total_yardage: toInteger(row.total_yardage || row.totalYardage),
    courseRating: toNumber(row.course_rating || row.courseRating),
    course_rating: toNumber(row.course_rating || row.courseRating),
    slopeRating: toNumber(row.slope_rating || row.slopeRating),
    slope_rating: toNumber(row.slope_rating || row.slopeRating),
    address: normalizeText(row.address) || null,
    postalCode: normalizeText(row.postal_code || row.postalCode) || null,
    postal_code: normalizeText(row.postal_code || row.postalCode) || null,
    phone: normalizeText(row.phone) || null,
    website: normalizeText(row.golf_course_website || row.website) || null,
    golfCourseWebsite: normalizeText(row.golf_course_website || row.website) || null,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    isManual: Boolean(row.is_manual ?? row.isManual),
    is_manual: Boolean(row.is_manual ?? row.isManual) ? 1 : 0,
    label: [
      normalizeText(row.name || row.course_name || row.courseName),
      [normalizeText(row.city), stateCode].filter(Boolean).join(', '),
      parTotal ? `Par ${parTotal}` : '',
    ].filter(Boolean).join(' · '),
  }
}

function normalizeLimit(value) {
  const limit = Math.trunc(Number(value) || DEFAULT_COURSE_LIMIT)
  return Math.min(Math.max(limit, 1), MAX_COURSE_LIMIT)
}

function normalizeLikeSearch(value) {
  return `%${normalizeCourseName(value).replace(/[\\%_]/g, '\\$&')}%`
}

export async function listGolfCourseStates() {
  const [rows] = await getPool().execute(
    `SELECT state_code AS abbr,
            COALESCE(NULLIF(MAX(state_name), ''), state_code) AS name,
            COUNT(*) AS courseCount
       FROM golf_courses
      WHERE state_code IS NOT NULL
        AND TRIM(state_code) <> ''
      GROUP BY state_code
      ORDER BY name ASC, state_code ASC`,
  )
  return rows.map((row) => ({
    abbr: normalizeStateCode(row.abbr),
    name: normalizeText(row.name) || stateNameForCode(row.abbr),
    courseCount: Number(row.courseCount || 0),
  }))
}

export async function listGolfCoursesForState(state, options = {}) {
  const stateCode = normalizeStateCode(state)
  const query = normalizeText(options.query || options.q || '')
  const limit = normalizeLimit(options.limit)
  if (!stateCode) return []

  const params = [stateCode]
  let searchSql = ''
  let orderSql = 'name ASC, city ASC'
  if (query) {
    const normalizedQuery = normalizeCourseName(query)
    const like = normalizeLikeSearch(query)
    params.push(like, like, `%${query.replace(/[\\%_]/g, '\\$&')}%`, `%${query.replace(/[\\%_]/g, '\\$&')}%`)
    searchSql = `
        AND (
          normalized_name LIKE ? ESCAPE '\\\\'
          OR name LIKE ? ESCAPE '\\\\'
          OR city LIKE ? ESCAPE '\\\\'
          OR county LIKE ? ESCAPE '\\\\'
        )`
    params.push(normalizedQuery, `${normalizedQuery}%`)
    orderSql = `CASE
        WHEN normalized_name = ? THEN 0
        WHEN normalized_name LIKE ? THEN 1
        ELSE 2
      END, name ASC, city ASC`
  }
  const [rows] = await getPool().execute(
    `SELECT id, external_course_id, source, name, state_code, state_name, county, city, country,
            course_type, holes_count, par_total, total_yardage, course_rating, slope_rating,
            address, postal_code, phone, website, latitude, longitude, is_manual
       FROM golf_courses
      WHERE state_code = ?
        AND active = 1
        ${searchSql}
      ORDER BY ${orderSql}
      LIMIT ${limit}`,
    params,
  )
  return rows.map(normalizeCourseRow)
}

export async function listGolfCourseNamesByState(state, options = {}) {
  const courses = await listGolfCoursesForState(state, options)
  return courses.map((course) => course.name)
}


export async function findNearestGolfCourse({ latitude = null, longitude = null, state = '' } = {}) {
  const golferLatitude = toNumber(latitude)
  const golferLongitude = toNumber(longitude)
  const stateCode = normalizeStateCode(state)
  if (golferLatitude == null || golferLongitude == null) return null

  const distanceSql = `ROUND(? * ACOS(LEAST(1, GREATEST(-1,
    COS(RADIANS(?)) * COS(RADIANS(latitude)) * COS(RADIANS(longitude) - RADIANS(?)) +
    SIN(RADIANS(?)) * SIN(RADIANS(latitude))
  ))))`
  const params = [EARTH_RADIUS_YARDS, golferLatitude, golferLongitude, golferLatitude]
  const filters = ['active = 1', 'latitude IS NOT NULL', 'longitude IS NOT NULL']
  if (stateCode) {
    filters.push('state_code = ?')
    params.push(stateCode)
  }

  const [rows] = await getPool().execute(
    `SELECT id, external_course_id, source, name, state_code, state_name, county, city, country,
            course_type, holes_count, par_total, total_yardage, course_rating, slope_rating,
            address, postal_code, phone, website, latitude, longitude, is_manual,
            ${distanceSql} AS distance_yards
       FROM golf_courses
      WHERE ${filters.join(' AND ')}
      ORDER BY distance_yards ASC, name ASC
      LIMIT 1`,
    params,
  )
  if (!rows[0]) return null
  const course = normalizeCourseRow(rows[0])
  course.distanceYards = toInteger(rows[0].distance_yards)
  course.distance_yards = course.distanceYards
  return course
}

export async function resolveGolfCourseForState(state, courseName, courseId = '') {
  const stateCode = normalizeStateCode(state)
  const id = normalizeText(courseId)
  const name = normalizeText(courseName)
  const normalizedName = normalizeCourseName(name)
  if (!stateCode && !id && !name) return null

  const params = []
  const filters = ['active = 1']
  if (id) {
    filters.push('(id = ? OR external_course_id = ?)')
    params.push(id, id)
  }
  if (stateCode) {
    filters.push('state_code = ?')
    params.push(stateCode)
  }
  if (!id && normalizedName) {
    filters.push('(normalized_name = ? OR name = ?)')
    params.push(normalizedName, name)
  }

  const [rows] = await getPool().execute(
    `SELECT id, external_course_id, source, name, state_code, state_name, county, city, country,
            course_type, holes_count, par_total, total_yardage, course_rating, slope_rating,
            address, postal_code, phone, website, latitude, longitude, is_manual
       FROM golf_courses
      WHERE ${filters.join(' AND ')}
      ORDER BY CASE WHEN id = ? OR external_course_id = ? THEN 0 ELSE 1 END,
               CASE WHEN normalized_name = ? THEN 0 ELSE 1 END,
               name ASC
      LIMIT 1`,
    [...params, id, id, normalizedName],
  )
  return rows[0] ? normalizeCourseRow(rows[0]) : null
}

export async function findGolfCourseForState(state, courseName, courseId = '') {
  return resolveGolfCourseForState(state, courseName, courseId)
}

export async function getGolfCourseByName(courseName, state = '') {
  return resolveGolfCourseForState(state, courseName)
}

export function formatGolfCoursePhysicalAddress(course) {
  const parts = [course?.address, course?.city, course?.state_code || course?.state, course?.postal_code || course?.postalCode]
    .map(normalizeText)
    .filter(Boolean)
  return parts.join(', ')
}

function normalizeTeeText(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeHoleRow(row = {}, golferLatitude = null, golferLongitude = null) {
  const frontLatitude = toNumber(row.front_latitude)
  const frontLongitude = toNumber(row.front_longitude)
  const centerLatitude = toNumber(row.center_latitude)
  const centerLongitude = toNumber(row.center_longitude)
  const backLatitude = toNumber(row.back_latitude)
  const backLongitude = toNumber(row.back_longitude)
  const distanceToFrontYards = calculateDistanceYards(golferLatitude, golferLongitude, frontLatitude, frontLongitude)
  const distanceToCenterYards = calculateDistanceYards(golferLatitude, golferLongitude, centerLatitude, centerLongitude)
  const distanceToBackYards = calculateDistanceYards(golferLatitude, golferLongitude, backLatitude, backLongitude)

  return {
    hole: toInteger(row.hole_number),
    par: toInteger(row.par),
    yards: toInteger(row.yards),
    strokeIndex: toInteger(row.stroke_index),
    teeColor: normalizeText(row.tee_color) || 'default',
    teeBoxType: normalizeText(row.tee_name) || normalizeText(row.tee_color) || 'default',
    teeLatitude: toNumber(row.tee_latitude),
    teeLongitude: toNumber(row.tee_longitude),
    greenPolygon: null,
    distanceToFrontYards,
    distanceToCenterYards,
    distanceToBackYards,
    distanceToFlagYards: distanceToCenterYards,
    frontLatitude,
    frontLongitude,
    centerLatitude,
    centerLongitude,
    backLatitude,
    backLongitude,
    flagLatitude: centerLatitude,
    flagLongitude: centerLongitude,
    source: normalizeText(row.source) || 'manual',
  }
}

export async function getGolfCourseHolesForCourse({ state = '', course = '', courseId = '', golferLatitude = null, golferLongitude = null, teeColor = 'white' } = {}) {
  const matchedCourse = await resolveGolfCourseForState(state, course, courseId)
  if (!matchedCourse?.id) throw new Error('Select a golf course from the database catalog for the selected state')
  const selectedTee = normalizeTeeText(teeColor)
  const db = getPool()
  const schema = await getHoleEndpointSchemaCapabilities(db)
  const teeLatitudeSelect = schema.hasTeeLatitude ? 'tee_latitude' : 'NULL AS tee_latitude'
  const teeLongitudeSelect = schema.hasTeeLongitude ? 'tee_longitude' : 'NULL AS tee_longitude'

  const [rows] = await db.execute(
    `SELECT hole_number, tee_name, tee_color, par, yards, stroke_index,
            ${teeLatitudeSelect}, ${teeLongitudeSelect}, front_latitude, front_longitude, center_latitude, center_longitude,
            back_latitude, back_longitude, source
       FROM golf_course_holes
      WHERE course_id = ?
        AND active = 1
      ORDER BY CASE
          WHEN LOWER(tee_color) = ? OR LOWER(tee_name) = ? THEN 0
          WHEN LOWER(tee_color) IN ('default', '') OR LOWER(tee_name) IN ('default', '') THEN 1
          ELSE 2
        END,
        hole_number ASC,
        tee_name ASC`,
    [matchedCourse.id, selectedTee, selectedTee],
  )

  const holesByNumber = new Map()
  for (const row of rows) {
    const holeNumber = toInteger(row.hole_number)
    if (!holeNumber || holesByNumber.has(holeNumber)) continue
    holesByNumber.set(holeNumber, normalizeHoleRow(row, golferLatitude, golferLongitude))
    if (holesByNumber.size >= 18) break
  }

  return {
    course: matchedCourse,
    holes: [...holesByNumber.values()].sort((a, b) => a.hole - b.hole),
    teeColor,
    availableTeeColors: [...new Set(rows.map((row) => normalizeText(row.tee_color || row.tee_name)).filter(Boolean))],
  }
}

export async function upsertOpenGolfCourse(listRecord = {}, detailPayload = {}, db = getPool()) {
  const course = normalizeOpenGolfCoursePayload(listRecord, detailPayload)
  if (!course.name || !course.stateCode) throw new Error('OpenGolfAPI course name and state are required')
  const id = course.id || randomUUID()
  const externalCourseId = course.externalCourseId || id

  await db.execute(
    `INSERT INTO golf_courses (
       id, external_course_id, source, name, normalized_name, state_code, state_name, county, city,
       country, course_type, holes_count, par_total, total_yardage, course_rating, slope_rating, address, postal_code, phone,
       website, golf_course_website, latitude, longitude, is_manual, active, raw_list_payload, raw_detail_payload, imported_at
     ) VALUES (?, ?, 'opengolfapi', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       external_course_id = VALUES(external_course_id),
       source = 'opengolfapi',
       name = VALUES(name),
       normalized_name = VALUES(normalized_name),
       state_code = VALUES(state_code),
       state_name = VALUES(state_name),
       county = VALUES(county),
       city = VALUES(city),
       country = VALUES(country),
       course_type = VALUES(course_type),
       holes_count = VALUES(holes_count),
       par_total = VALUES(par_total),
       total_yardage = VALUES(total_yardage),
       course_rating = VALUES(course_rating),
       slope_rating = VALUES(slope_rating),
       address = VALUES(address),
       postal_code = VALUES(postal_code),
       phone = VALUES(phone),
       website = VALUES(website),
       golf_course_website = VALUES(golf_course_website),
       latitude = VALUES(latitude),
       longitude = VALUES(longitude),
       active = 1,
       raw_list_payload = VALUES(raw_list_payload),
       raw_detail_payload = VALUES(raw_detail_payload),
       imported_at = UTC_TIMESTAMP()`,
    [
      id,
      externalCourseId,
      course.name,
      course.normalizedName,
      course.stateCode,
      course.stateName,
      course.county,
      course.city,
      course.country,
      course.courseType,
      course.holesCount,
      course.parTotal,
      course.totalYardage,
      course.courseRating,
      course.slopeRating,
      course.address,
      course.postalCode,
      course.phone,
      course.website,
      course.website,
      course.latitude,
      course.longitude,
      asJson(course.rawListPayload),
      asJson(course.rawDetailPayload),
    ],
  )

  const holes = extractOpenGolfCourseHoles(detailPayload)
  if (holes.length > 0) await ensureOpenGolfCourseHoleEndpointSchema(db)
  await db.execute(`DELETE FROM golf_course_holes WHERE course_id = ? AND source = 'opengolfapi'`, [id])
  for (const hole of holes) {
    await db.execute(
      `INSERT INTO golf_course_holes (
         id, course_id, source, hole_number, tee_name, tee_color, par, yards, stroke_index,
         tee_latitude, tee_longitude, front_latitude, front_longitude, center_latitude, center_longitude, back_latitude, back_longitude,
         active, raw_payload
       ) VALUES (?, ?, 'opengolfapi', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         tee_color = VALUES(tee_color),
         par = VALUES(par),
         yards = VALUES(yards),
         stroke_index = VALUES(stroke_index),
         tee_latitude = VALUES(tee_latitude),
         tee_longitude = VALUES(tee_longitude),
         front_latitude = VALUES(front_latitude),
         front_longitude = VALUES(front_longitude),
         center_latitude = VALUES(center_latitude),
         center_longitude = VALUES(center_longitude),
         back_latitude = VALUES(back_latitude),
         back_longitude = VALUES(back_longitude),
         active = 1,
         raw_payload = VALUES(raw_payload)`,
      [
        randomUUID(),
        id,
        hole.holeNumber,
        hole.teeName || 'default',
        hole.teeColor || 'default',
        hole.par,
        hole.yards,
        hole.strokeIndex,
        hole.teeLatitude ?? null,
        hole.teeLongitude ?? null,
        hole.frontLatitude,
        hole.frontLongitude,
        hole.centerLatitude,
        hole.centerLongitude,
        hole.backLatitude,
        hole.backLongitude,
        asJson(hole.rawPayload),
      ],
    )
  }

  logApi('opengolfapi_course_upserted', { courseId: id, externalCourseId, state: course.stateCode, course: course.name, holeCount: holes.length })
  return { id, externalCourseId, course, holeCount: holes.length }
}


export function normalizeOpenGolfCourseEndpointDetails(holesPayload = {}, teesPayload = {}) {
  const holes = extractOpenGolfCourseHoleEndpointRows(holesPayload)
  const teeSummary = extractOpenGolfCourseTeeSummary(teesPayload)
  return { holes, teeSummary }
}

export async function refreshOpenGolfCourseEndpointDetails(courseRow = {}, holesPayload = {}, teesPayload = {}, db = getPool(), { dryRun = false } = {}) {
  const courseId = normalizeText(courseRow.id)
  const externalCourseId = normalizeText(courseRow.external_course_id || courseRow.externalCourseId || courseId)
  if (!courseId) throw new Error('OpenGolfAPI database course id is required')

  const { holes, teeSummary } = normalizeOpenGolfCourseEndpointDetails(holesPayload, teesPayload)
  const result = {
    courseId,
    externalCourseId,
    holeCount: holes.length,
    teeCount: teeSummary.teeCount,
    totalYardage: teeSummary.totalYardage ?? null,
    courseRating: teeSummary.courseRating ?? null,
    slopeRating: teeSummary.slopeRating ?? null,
    dryRun,
  }
  if (dryRun) return result

  await db.execute(
    `UPDATE golf_courses
        SET total_yardage = ?,
            course_rating = ?,
            slope_rating = ?,
            raw_detail_payload = ?,
            imported_at = UTC_TIMESTAMP(),
            updated_at = UTC_TIMESTAMP()
      WHERE id = ?`,
    [
      result.totalYardage,
      result.courseRating,
      result.slopeRating,
      asJson({ holes: holesPayload, tees: teesPayload }),
      courseId,
    ],
  )

  if (holes.length > 0) {
    await ensureOpenGolfCourseHoleEndpointSchema(db)
    await db.execute(`DELETE FROM golf_course_holes WHERE course_id = ? AND source = 'opengolfapi'`, [courseId])
    for (const hole of holes) {
      await db.execute(
        `INSERT INTO golf_course_holes (
           id, course_id, source, hole_number, tee_name, tee_color, par, yards, stroke_index,
           tee_latitude, tee_longitude, front_latitude, front_longitude, center_latitude, center_longitude,
           back_latitude, back_longitude, active, raw_payload
         ) VALUES (?, ?, 'opengolfapi', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE
           tee_color = VALUES(tee_color),
           par = VALUES(par),
           yards = VALUES(yards),
           stroke_index = VALUES(stroke_index),
           tee_latitude = VALUES(tee_latitude),
           tee_longitude = VALUES(tee_longitude),
           front_latitude = VALUES(front_latitude),
           front_longitude = VALUES(front_longitude),
           center_latitude = VALUES(center_latitude),
           center_longitude = VALUES(center_longitude),
           back_latitude = VALUES(back_latitude),
           back_longitude = VALUES(back_longitude),
           active = 1,
           raw_payload = VALUES(raw_payload)`,
        [
          randomUUID(),
          courseId,
          hole.holeNumber,
          hole.teeName || 'default',
          hole.teeColor || 'default',
          hole.par,
          hole.yards,
          hole.strokeIndex,
          hole.teeLatitude,
          hole.teeLongitude,
          hole.frontLatitude,
          hole.frontLongitude,
          hole.centerLatitude,
          hole.centerLongitude,
          hole.backLatitude,
          hole.backLongitude,
          asJson(hole.rawPayload),
        ],
      )
    }
  }

  logApi('opengolfapi_course_endpoint_details_refreshed', result)
  return result
}

export function __resetGolfCourseServiceCachesForTests() {
  cachedHoleEndpointSchema = null
}
