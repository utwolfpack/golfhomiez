import { fuzzyTextMatch, GOLF_HOMIEZ_TOURNAMENT_SOURCE } from './tournament-discovery.js'
import { normalizeStateCode } from './us-states.js'
import { normalizeUsPhoneForDisplay } from './us-phone.js'

export const GOLF_COURSE_SEARCH_PAGE_SIZE = 20
export const GOLF_COURSE_ZIP_RADIUS_MILES = 50

const postalBoundsCache = new Map()

function cleanText(value, maxLength = 1000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function normalizePostalCode(value) {
  const raw = cleanText(value, 32)
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 5) throw new Error('Zip Code must contain a valid 5-digit ZIP code.')
  return digits.slice(0, 5)
}

export function normalizeGolfCourseSearchFilters(filters = {}) {
  return {
    state: normalizeStateCode(filters.state),
    city: cleanText(filters.city, 128),
    zipCode: normalizePostalCode(filters.zipCode || filters.zip),
    golfCourseName: cleanText(filters.golfCourseName || filters.course, 191),
  }
}

function toFiniteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function toRadians(value) {
  return Number(value) * (Math.PI / 180)
}

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(toFiniteNumber)
  if (values.some((value) => value === null)) return null
  const [resolvedLat1, resolvedLon1, resolvedLat2, resolvedLon2] = values
  const earthRadiusMiles = 3958.8
  const dLat = toRadians(resolvedLat2 - resolvedLat1)
  const dLon = toRadians(resolvedLon2 - resolvedLon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(resolvedLat1)) * Math.cos(toRadians(resolvedLat2)) * Math.sin(dLon / 2) ** 2
  return earthRadiusMiles * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

export function distanceMilesToBounds(latitude, longitude, bounds) {
  const lat = toFiniteNumber(latitude)
  const lon = toFiniteNumber(longitude)
  if (lat === null || lon === null || !bounds) return null
  const south = toFiniteNumber(bounds.south)
  const north = toFiniteNumber(bounds.north)
  const west = toFiniteNumber(bounds.west)
  const east = toFiniteNumber(bounds.east)
  if ([south, north, west, east].some((value) => value === null)) return null
  const closestLat = Math.min(Math.max(lat, south), north)
  const closestLon = Math.min(Math.max(lon, west), east)
  return haversineMiles(lat, lon, closestLat, closestLon)
}

function boundsFromRows(rows = []) {
  const points = rows
    .map((row) => ({ latitude: toFiniteNumber(row.latitude), longitude: toFiniteNumber(row.longitude) }))
    .filter((point) => point.latitude !== null && point.longitude !== null)
  if (!points.length) return null
  return {
    south: Math.min(...points.map((point) => point.latitude)),
    north: Math.max(...points.map((point) => point.latitude)),
    west: Math.min(...points.map((point) => point.longitude)),
    east: Math.max(...points.map((point) => point.longitude)),
    source: 'golf_course_catalog',
  }
}

async function resolvePostalCodeBoundsFromCatalog(db, zipCode) {
  const [rows] = await db.execute(
    `SELECT latitude, longitude
       FROM golf_courses
      WHERE LEFT(REPLACE(COALESCE(postal_code, ''), '-', ''), 5) = ?
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL`,
    [zipCode],
  )
  return boundsFromRows(rows)
}

export async function resolveUsPostalCodeBounds(zipCode, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
} = {}) {
  const normalizedZip = normalizePostalCode(zipCode)
  if (!normalizedZip) return null
  if (postalBoundsCache.has(normalizedZip)) return postalBoundsCache.get(normalizedZip)
  if (typeof fetchImpl !== 'function') return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || 5000))
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('countrycodes', 'us')
    url.searchParams.set('postalcode', normalizedZip)
    url.searchParams.set('limit', '1')
    url.searchParams.set('addressdetails', '0')
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'GolfHomiez ZIP radius lookup',
      },
      signal: controller.signal,
    })
    if (!response?.ok) return null
    const payload = await response.json()
    const result = Array.isArray(payload) ? payload[0] : null
    const boundingBox = Array.isArray(result?.boundingbox) ? result.boundingbox : []
    const south = toFiniteNumber(boundingBox[0] ?? result?.lat)
    const north = toFiniteNumber(boundingBox[1] ?? result?.lat)
    const west = toFiniteNumber(boundingBox[2] ?? result?.lon)
    const east = toFiniteNumber(boundingBox[3] ?? result?.lon)
    if ([south, north, west, east].some((value) => value === null)) return null
    const bounds = { south, north, west, east, source: 'nominatim' }
    postalBoundsCache.set(normalizedZip, bounds)
    return bounds
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function resolvePostalSearchBounds(db, zipCode, options = {}) {
  if (!zipCode) return null
  const externalBounds = await resolveUsPostalCodeBounds(zipCode, options)
  if (externalBounds) return externalBounds
  try {
    return await resolvePostalCodeBoundsFromCatalog(db, zipCode)
  } catch {
    return null
  }
}

function normalizeCourseResult(row) {
  return {
    id: cleanText(row.golf_course_id || row.page_id || row.slug, 191),
    golfCourseId: cleanText(row.golf_course_id, 191) || null,
    golfCourseName: cleanText(row.golf_course_name, 191) || 'Golf course',
    city: cleanText(row.city, 128) || null,
    state: normalizeStateCode(row.state_code),
    zipCode: cleanText(row.postal_code, 32) || null,
    phone: normalizeUsPhoneForDisplay(row.phone || row.contact_phone),
    websiteUrl: cleanText(row.website_url || row.catalog_website, 1024) || null,
    golfCoursePagePath: row.slug ? `/${cleanText(row.slug, 191)}` : null,
    latitude: toFiniteNumber(row.latitude),
    longitude: toFiniteNumber(row.longitude),
    hostedTournamentCount: Math.max(0, Number(row.hosted_tournament_count) || 0),
    distanceMiles: null,
  }
}

function uniqueCourses(rows) {
  const seen = new Set()
  const result = []
  for (const row of rows || []) {
    const course = normalizeCourseResult(row)
    const key = course.golfCourseId || `${course.golfCourseName.toLowerCase()}|${course.state}|${String(course.city || '').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(course)
  }
  return result
}

function identifierKey(value) {
  return cleanText(value, 191)
}

function courseNameStateKey(name, state) {
  const normalizedName = cleanText(name, 191).toLowerCase()
  const normalizedState = normalizeStateCode(state)
  if (!normalizedName || !normalizedState) return ''
  return `${normalizedName}|${normalizedState}`
}

function incrementCount(map, key) {
  if (!key) return
  map.set(key, (map.get(key) || 0) + 1)
}

async function executeCatalogQuery(db, stage, sql, params = []) {
  try {
    return await db.execute(sql, params)
  } catch (error) {
    if (error && typeof error === 'object' && !error.golfCourseSearchStage) {
      error.golfCourseSearchStage = stage
    }
    throw error
  }
}

async function loadGolfCourseSearchCatalog(db) {
  // Keep cross-table identifier comparisons out of SQL. Stage databases can contain
  // identifiers created under different utf8mb4 collations after backup/restore or
  // historical migrations. Joining the small catalog data sets in JavaScript makes
  // Find a Golf Course independent of those collation differences.
  const [courseRows] = await executeCatalogQuery(
    db,
    'catalog_courses',
    `SELECT id AS golf_course_id, name AS golf_course_name, city, state_code, postal_code,
            phone, golf_course_website, website AS catalog_website, latitude, longitude
       FROM golf_courses
      ORDER BY state_code ASC, name ASC`,
  )
  const [pageRows] = await executeCatalogQuery(
    db,
    'public_pages',
    `SELECT id AS page_id, golf_course_id, slug, golf_course_name, city, state_code, postal_code, contact_phone, website_url
       FROM golf_course_public_pages
      WHERE is_published = 1`,
  )
  const [hostRows] = await executeCatalogQuery(
    db,
    'host_course_map',
    `SELECT id AS host_account_id, golf_course_id
       FROM host_accounts
      WHERE golf_course_id IS NOT NULL`,
  )
  const [tournamentRows] = await executeCatalogQuery(
    db,
    'hosted_tournaments',
    `SELECT host_account_id, status
       FROM tournaments
      WHERE host_account_id IS NOT NULL
        AND archived_at IS NULL`,
  )
  const [indexedTournamentRows] = await executeCatalogQuery(
    db,
    'indexed_golfhomiez_tournaments',
    `SELECT golf_course_id, golf_course_name, state_code, source_type, active
       FROM golf_course_tournaments
      WHERE active = 1`,
  )

  const pageByCourseId = new Map()
  for (const row of pageRows || []) {
    const key = identifierKey(row.golf_course_id)
    if (key && !pageByCourseId.has(key)) pageByCourseId.set(key, row)
  }

  const courseIdByHostId = new Map()
  for (const row of hostRows || []) {
    const hostId = identifierKey(row.host_account_id)
    const courseId = identifierKey(row.golf_course_id)
    if (hostId && courseId) courseIdByHostId.set(hostId, courseId)
  }

  const hostedCountsByCourseId = new Map()
  for (const row of tournamentRows || []) {
    const status = cleanText(row.status, 32).toLowerCase()
    if (status !== 'published' && status !== 'completed') continue
    const courseId = courseIdByHostId.get(identifierKey(row.host_account_id))
    incrementCount(hostedCountsByCourseId, courseId)
  }

  const indexedCountsByCourseId = new Map()
  const indexedCountsByNameState = new Map()
  for (const row of indexedTournamentRows || []) {
    if (cleanText(row.source_type, 32).toLowerCase() !== GOLF_HOMIEZ_TOURNAMENT_SOURCE) continue
    if (Number(row.active) === 0) continue
    const courseId = identifierKey(row.golf_course_id)
    if (courseId) incrementCount(indexedCountsByCourseId, courseId)
    else incrementCount(indexedCountsByNameState, courseNameStateKey(row.golf_course_name, row.state_code))
  }

  const rows = (courseRows || []).map((course) => {
    const courseId = identifierKey(course.golf_course_id)
    const page = pageByCourseId.get(courseId) || null
    const golfCourseName = cleanText(course.golf_course_name || page?.golf_course_name, 191)
    const stateCode = normalizeStateCode(course.state_code || page?.state_code)
    const directCount = hostedCountsByCourseId.get(courseId) || 0
    const indexedCount = Math.max(
      indexedCountsByCourseId.get(courseId) || 0,
      indexedCountsByNameState.get(courseNameStateKey(golfCourseName, stateCode)) || 0,
    )
    return {
      ...course,
      page_id: page?.page_id || null,
      slug: page?.slug || null,
      golf_course_name: golfCourseName,
      city: cleanText(course.city || page?.city, 128),
      state_code: stateCode,
      postal_code: cleanText(course.postal_code || page?.postal_code, 32),
      phone: normalizeUsPhoneForDisplay(page?.contact_phone || course.phone),
      website_url: cleanText(page?.website_url || course.golf_course_website || course.catalog_website, 1024),
      hosted_tournament_count: Math.max(directCount, indexedCount),
    }
  })

  return {
    rows,
    diagnostics: {
      strategy: 'collation_independent_application_join',
      catalogCourseRows: courseRows?.length || 0,
      publicPageRows: pageRows?.length || 0,
      hostRows: hostRows?.length || 0,
      tournamentRows: tournamentRows?.length || 0,
      indexedTournamentRows: indexedTournamentRows?.length || 0,
    },
  }
}

export async function searchGolfHomiezCourses(db, filters = {}, {
  page = 1,
  fetchImpl = globalThis.fetch,
  zipRadiusMiles = GOLF_COURSE_ZIP_RADIUS_MILES,
} = {}) {
  const normalized = normalizeGolfCourseSearchFilters(filters)
  const { rows, diagnostics } = await loadGolfCourseSearchCatalog(db)

  const zipBounds = normalized.zipCode
    ? await resolvePostalSearchBounds(db, normalized.zipCode, { fetchImpl })
    : null
  const resolvedRadius = Math.max(1, Number(zipRadiusMiles) || GOLF_COURSE_ZIP_RADIUS_MILES)

  const matchingCourses = uniqueCourses(rows)
    .filter((course) => !normalized.state || course.state === normalized.state)
    .filter((course) => fuzzyTextMatch(course.city, normalized.city))
    .filter((course) => fuzzyTextMatch(course.golfCourseName, normalized.golfCourseName))
    .map((course) => {
      if (!normalized.zipCode) return course
      const exactZip = String(course.zipCode || '').replace(/\D/g, '').slice(0, 5) === normalized.zipCode
      const distanceMiles = zipBounds ? distanceMilesToBounds(course.latitude, course.longitude, zipBounds) : null
      return {
        ...course,
        distanceMiles: distanceMiles === null ? null : Math.round(distanceMiles * 10) / 10,
        zipMatch: exactZip || (distanceMiles !== null && distanceMiles <= resolvedRadius),
      }
    })
    .filter((course) => !normalized.zipCode || course.zipMatch)
    .sort((left, right) => {
      const leftHosted = left.hostedTournamentCount > 0 ? 1 : 0
      const rightHosted = right.hostedTournamentCount > 0 ? 1 : 0
      if (leftHosted !== rightHosted) return rightHosted - leftHosted
      if (normalized.zipCode) {
        const leftDistance = left.distanceMiles ?? Number.POSITIVE_INFINITY
        const rightDistance = right.distanceMiles ?? Number.POSITIVE_INFINITY
        if (leftDistance !== rightDistance) return leftDistance - rightDistance
      }
      return left.golfCourseName.localeCompare(right.golfCourseName) || String(left.city || '').localeCompare(String(right.city || ''))
    })
    .map(({ zipMatch, ...course }) => course)

  const requestedPage = Math.max(Number.parseInt(String(page || 1), 10) || 1, 1)
  const totalResults = matchingCourses.length
  const totalPages = totalResults === 0 ? 0 : Math.ceil(totalResults / GOLF_COURSE_SEARCH_PAGE_SIZE)
  const resolvedPage = totalPages > 0 ? Math.min(requestedPage, totalPages) : 1
  const offset = (resolvedPage - 1) * GOLF_COURSE_SEARCH_PAGE_SIZE

  return {
    filters: normalized,
    zipSearch: {
      requestedZipCode: normalized.zipCode || null,
      radiusMiles: resolvedRadius,
      radiusResolved: normalized.zipCode ? Boolean(zipBounds) : true,
      source: zipBounds?.source || null,
    },
    pagination: {
      page: resolvedPage,
      pageSize: GOLF_COURSE_SEARCH_PAGE_SIZE,
      totalResults,
      totalPages,
    },
    courses: matchingCourses.slice(offset, offset + GOLF_COURSE_SEARCH_PAGE_SIZE),
    diagnostics,
  }
}
