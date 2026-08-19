import { fuzzyTextMatch, GOLF_HOMIEZ_TOURNAMENT_SOURCE } from './tournament-discovery.js'
import { normalizeStateCode } from './us-states.js'

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

export async function searchGolfHomiezCourses(db, filters = {}, {
  page = 1,
  fetchImpl = globalThis.fetch,
  zipRadiusMiles = GOLF_COURSE_ZIP_RADIUS_MILES,
} = {}) {
  const normalized = normalizeGolfCourseSearchFilters(filters)
  const params = []
  const where = []
  if (normalized.state) {
    where.push(`UPPER(TRIM(COALESCE(NULLIF(gc.state_code, ''), NULLIF(gcpp.state_code, '')))) = ?`)
    params.push(normalized.state)
  }

  const [rows] = await db.execute(
    `SELECT gc.id AS golf_course_id, gcpp.id AS page_id, gcpp.slug,
            COALESCE(NULLIF(TRIM(gc.name), ''), NULLIF(TRIM(gcpp.golf_course_name), '')) AS golf_course_name,
            COALESCE(NULLIF(TRIM(gc.city), ''), NULLIF(TRIM(gcpp.city), '')) AS city,
            COALESCE(NULLIF(TRIM(gc.state_code), ''), NULLIF(TRIM(gcpp.state_code), '')) AS state_code,
            COALESCE(NULLIF(TRIM(gc.postal_code), ''), NULLIF(TRIM(gcpp.postal_code), '')) AS postal_code,
            COALESCE(NULLIF(TRIM(gcpp.website_url), ''), NULLIF(TRIM(gc.golf_course_website), ''), NULLIF(TRIM(gc.website), '')) AS website_url,
            gc.website AS catalog_website, gc.latitude, gc.longitude,
            GREATEST(
              (SELECT COUNT(*)
                 FROM tournaments hosted_tournament
                 JOIN host_accounts tournament_host
                   ON BINARY tournament_host.id = BINARY hosted_tournament.host_account_id
                WHERE LOWER(COALESCE(hosted_tournament.status, '')) IN ('published', 'completed')
                  AND BINARY tournament_host.golf_course_id = BINARY gc.id),
              (SELECT COUNT(*)
                 FROM golf_course_tournaments search_tournament
                WHERE search_tournament.source_type = '${GOLF_HOMIEZ_TOURNAMENT_SOURCE}'
                  AND ((search_tournament.golf_course_id IS NOT NULL
                        AND BINARY search_tournament.golf_course_id = BINARY gc.id)
                       OR (search_tournament.golf_course_id IS NULL
                           AND LOWER(TRIM(CONVERT(search_tournament.golf_course_name USING utf8mb4))) COLLATE utf8mb4_general_ci =
                               LOWER(TRIM(CONVERT(gc.name USING utf8mb4))) COLLATE utf8mb4_general_ci
                           AND LOWER(TRIM(CONVERT(COALESCE(search_tournament.state_code, '') USING utf8mb4))) COLLATE utf8mb4_general_ci =
                               LOWER(TRIM(CONVERT(COALESCE(gc.state_code, '') USING utf8mb4))) COLLATE utf8mb4_general_ci)))
            ) AS hosted_tournament_count
       FROM golf_courses gc
       LEFT JOIN golf_course_public_pages gcpp
         ON BINARY gcpp.golf_course_id = BINARY gc.id
        AND gcpp.is_published = 1
      WHERE ${where.length ? where.join('\n        AND ') : '1 = 1'}
      ORDER BY gc.state_code ASC, gc.name ASC`,
    params,
  )

  const zipBounds = normalized.zipCode
    ? await resolvePostalSearchBounds(db, normalized.zipCode, { fetchImpl })
    : null
  const resolvedRadius = Math.max(1, Number(zipRadiusMiles) || GOLF_COURSE_ZIP_RADIUS_MILES)

  const matchingCourses = uniqueCourses(rows)
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
  }
}
