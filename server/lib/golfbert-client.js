import crypto from 'node:crypto'

import { logApi, logError, logWarn } from './logger.js'
import { recordExternalApiCall } from './external-api-metrics.js'
import { DEFAULT_TEE_COLOR, normalizeTeeColor } from './tee-colors.js'

const DEFAULT_BASE_URL = 'https://api.golfbert.com'
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000
const DEFAULT_COURSE_PAGE_SIZE = 100
const MAX_COURSE_PAGES = 100
const MAX_CACHE_ENTRIES = 500
const EARTH_RADIUS_YARDS = 6967410
const DEFAULT_GOLFBERT_REGION = 'us-east-1'
const DEFAULT_GOLFBERT_SERVICE = 'execute-api'
const UNSAFE_BASE_URL_PATTERN = /^https?:\/\/(www\.)?golfbert\.com\/api\/?v?1?\/?$/i

const US_STATE_NAMES_BY_CODE = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
}
const US_STATE_CODES_BY_NAME = Object.fromEntries(Object.entries(US_STATE_NAMES_BY_CODE).map(([code, name]) => [name.toUpperCase(), code]))
let baseUrlWarningEmitted = false

const courseSearchCache = new Map()
const courseByIdCache = new Map()
const courseResolutionCache = new Map()
const holesCache = new Map()
const scorecardCache = new Map()

function now() {
  return Date.now()
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeTeeText(value) {
  return String(value ?? '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase()
}

function golfbertTeeColor(value) {
  const normalized = normalizeTeeText(value)
  if (/\bred\b/.test(normalized)) return 'red'
  if (/\bwhite\b/.test(normalized)) return 'white'
  if (/\bblue\b/.test(normalized)) return 'blue'
  if (/\bblack\b/.test(normalized)) return 'black'
  return ''
}

function normalizeState(value) {
  const normalized = normalizeText(value).toUpperCase()
  if (!normalized) return ''
  if (US_STATE_NAMES_BY_CODE[normalized]) return normalized
  return US_STATE_CODES_BY_NAME[normalized] || normalized
}

function golfbertStateParam(value) {
  const stateCode = normalizeState(value)
  return US_STATE_NAMES_BY_CODE[stateCode] || normalizeText(value)
}

function normalizeCourseName(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’.]/g, '')
    .replace(/\b(country club|golf club|golf course|golf resort|resort golf course|club at|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cacheTtlMs() {
  const configured = Number(process.env.GOLFBERT_CACHE_TTL_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_CACHE_TTL_MS
}

function cacheGet(cache, key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= now()) {
    cache.delete(key)
    return null
  }
  return entry.value
}

function cacheSet(cache, key, value, ttlMs = cacheTtlMs()) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }
  cache.set(key, { value, expiresAt: now() + ttlMs })
  return value
}

function getBaseUrl() {
  const configured = normalizeText(process.env.GOLFBERT_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  if (!configured) return DEFAULT_BASE_URL

  if (UNSAFE_BASE_URL_PATTERN.test(configured)) {
    if (!baseUrlWarningEmitted) {
      baseUrlWarningEmitted = true
      logWarn('Golfbert API base URL normalized from web app URL to API host', { configuredBaseUrl: configured, normalizedBaseUrl: DEFAULT_BASE_URL })
    }
    return DEFAULT_BASE_URL
  }

  try {
    const parsed = new URL(configured)
    const hostname = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname.replace(/\/+$/, '')

    if (hostname === 'api.golfbert.com' && /\/v1$/i.test(pathname)) {
      parsed.pathname = pathname.replace(/\/v1$/i, '') || '/'
      return parsed.toString().replace(/\/+$/, '')
    }
  } catch {
    return configured
  }

  return configured
}

function normalizeGolfbertPath(pathname) {
  const cleanPath = `/${normalizeText(pathname).replace(/^\/+/, '')}`
  return cleanPath.startsWith('/v1/') ? cleanPath : `/v1${cleanPath}`
}

function buildGolfbertUrl(pathname) {
  return new URL(`${getBaseUrl()}${normalizeGolfbertPath(pathname)}`)
}

function golfbertCoursePageSize() {
  const configured = Number(process.env.GOLFBERT_COURSE_PAGE_SIZE)
  return Number.isFinite(configured) && configured > 0 ? Math.min(Math.trunc(configured), 500) : DEFAULT_COURSE_PAGE_SIZE
}

function getApiKey() {
  return normalizeText(process.env.GOLFBERT_API_KEY || process.env.GOLFBERT_KEY || '')
}

function requireApiKey() {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('GOLFBERT_API_KEY is required to load golf course information.')
  }
  return apiKey
}

function getGolfbertAccessKey() {
  return normalizeText(process.env.GOLFBERT_API_ACCESS_KEY || process.env.GOLFBERT_ACCESS_KEY || '')
}

function getGolfbertSecretKey() {
  return normalizeText(process.env.GOLFBERT_API_SECRET_KEY || process.env.GOLFBERT_SECRET_KEY || process.env.GOLFBERT_KEY_SECRET || '')
}

function getAuthScheme() {
  const configured = normalizeText(process.env.GOLFBERT_API_AUTH_SCHEME || '').toLowerCase()
  if (configured) return configured
  return getGolfbertAccessKey() && getGolfbertSecretKey() ? 'aws4' : 'header'
}

function buildAuthHeaders(apiKey) {
  const headerName = normalizeText(process.env.GOLFBERT_API_KEY_HEADER || 'x-api-key')
  const authScheme = getAuthScheme()
  const headers = {
    Accept: 'application/json',
  }

  if (headerName) headers[headerName] = apiKey
  if (authScheme === 'bearer') headers.Authorization = `Bearer ${apiKey}`
  if (authScheme === 'query') delete headers[headerName]

  return headers
}

function appendAuthQuery(url, apiKey) {
  const authScheme = getAuthScheme()
  if (authScheme !== 'query') return
  const queryName = normalizeText(process.env.GOLFBERT_API_KEY_QUERY_PARAM || 'api_key')
  if (queryName && !url.searchParams.has(queryName)) url.searchParams.set(queryName, apiKey)
}

function hashSha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hmacSha256(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding)
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function buildCanonicalQueryString(url) {
  return [...url.searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&')
}

function buildSignedAwsV4Headers(url, headers, { method = 'GET' } = {}) {
  const accessKey = getGolfbertAccessKey()
  const secretKey = getGolfbertSecretKey()
  const authScheme = getAuthScheme()
  if (authScheme !== 'aws4') return headers
  if (!accessKey || !secretKey) {
    throw new Error('GOLFBERT_API_ACCESS_KEY and GOLFBERT_API_SECRET_KEY are required when GOLFBERT_API_AUTH_SCHEME=aws4.')
  }

  const region = normalizeText(process.env.GOLFBERT_API_REGION || DEFAULT_GOLFBERT_REGION)
  const service = normalizeText(process.env.GOLFBERT_API_SERVICE || DEFAULT_GOLFBERT_SERVICE)
  const nowDate = new Date()
  const amzDate = nowDate.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const signedHeaders = {
    ...headers,
    host: url.host,
    'x-amz-date': amzDate,
  }
  const normalizedHeaderEntries = Object.entries(signedHeaders)
    .filter(([, value]) => value !== undefined && value !== null && normalizeText(value) !== '')
    .map(([key, value]) => [key.toLowerCase(), normalizeText(value)])
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
  const canonicalHeaders = normalizedHeaderEntries.map(([key, value]) => `${key}:${value}\n`).join('')
  const signedHeaderNames = normalizedHeaderEntries.map(([key]) => key).join(';')
  const canonicalRequest = [
    method.toUpperCase(),
    url.pathname || '/',
    buildCanonicalQueryString(url),
    canonicalHeaders,
    signedHeaderNames,
    hashSha256Hex(''),
  ].join('\n')
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hashSha256Hex(canonicalRequest),
  ].join('\n')
  const dateKey = hmacSha256(`AWS4${secretKey}`, dateStamp)
  const regionKey = hmacSha256(dateKey, region)
  const serviceKey = hmacSha256(regionKey, service)
  const signingKey = hmacSha256(serviceKey, 'aws4_request')
  const signature = hmacSha256(signingKey, stringToSign, 'hex')

  return {
    ...signedHeaders,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope},SignedHeaders=${signedHeaderNames},Signature=${signature}`,
  }
}

function normalizeArrayPayload(payload, preferredKeys = []) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  for (const key of [...preferredKeys, 'resources', 'data', 'results', 'courses', 'items', 'holes', 'holeteeboxes']) {
    if (Array.isArray(payload[key])) return payload[key]
  }
  return []
}
function safeGolfbertQuery(url) {
  const hiddenAuthQueryNames = new Set(['api_key', 'apikey', 'key', normalizeText(process.env.GOLFBERT_API_KEY_QUERY_PARAM || 'api_key').toLowerCase()])
  return Object.fromEntries([...url.searchParams.entries()].map(([key, value]) => [key, hiddenAuthQueryNames.has(key.toLowerCase()) ? '[redacted]' : value]))
}

function golfbertFailureDiagnostic(message, requestPath) {
  if (/Missing Authentication Token/i.test(message)) {
    return `Golfbert rejected ${requestPath}; verify the API base URL is https://api.golfbert.com and the list-courses path includes the official trailing slash /v1/courses/.`
  }
  if (/not found|404/i.test(message)) return `Golfbert route ${requestPath} was not found; verify the configured base URL and endpoint path.`
  if (/Forbidden|signature|credential|token/i.test(message)) return 'Golfbert authentication failed; verify x-api-key, access key, secret key, region, service, and system clock.'
  return null
}

function rawCourseMarker(rawCourses) {
  const ids = rawCourses
    .map((course) => integerValue(firstPresent(course, ['id', 'course_id', 'courseId'])))
    .filter((value) => value != null)
  return ids.length ? Math.max(...ids) : null
}


function firstPresent(source, keys) {
  if (!source || typeof source !== 'object') return undefined
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined && value !== null && normalizeText(value) !== '') return value
  }
  return undefined
}

function numberValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function integerValue(value) {
  const number = numberValue(value)
  return number == null ? null : Math.trunc(number)
}

function coordinateValue(value) {
  const number = numberValue(value)
  return number != null && Math.abs(number) <= 180 ? number : null
}

function buildCourseLabel(course) {
  const location = [course.city, course.state].filter(Boolean).join(', ')
  const detail = [location, course.holesCount ? `${course.holesCount} holes` : '', course.parTotal ? `Par ${course.parTotal}` : ''].filter(Boolean).join(' · ')
  return detail ? `${course.name} (${detail})` : course.name
}

function normalizeCourse(raw) {
  const id = normalizeText(firstPresent(raw, ['id', 'course_id', 'courseId', 'uuid', 'slug']))
  const name = normalizeText(firstPresent(raw, ['name', 'course_name', 'courseName', 'club_name', 'clubName']))
  if (!id || !name) return null

  const rawAddress = raw?.address && typeof raw.address === 'object' ? raw.address : {}
  const state = normalizeState(firstPresent(raw, ['state', 'state_code', 'stateCode', 'region', 'province']) || firstPresent(rawAddress, ['state']))
  const city = normalizeText(firstPresent(raw, ['city', 'municipality', 'locality']) || firstPresent(rawAddress, ['city'])) || null
  const address = normalizeText(firstPresent(raw, ['street', 'street_address', 'streetAddress']) || firstPresent(rawAddress, ['street']) || (raw?.address && typeof raw.address !== 'object' ? raw.address : '')) || null
  const postalCode = normalizeText(firstPresent(raw, ['postal_code', 'postalCode', 'zip', 'zip_code', 'zipCode']) || firstPresent(rawAddress, ['zip', 'postal_code', 'postalCode'])) || null
  const website = normalizeText(firstPresent(raw, ['website', 'url', 'web_url', 'webUrl'])) || null
  const phone = normalizeText(firstPresent(raw, ['phone', 'phone_number', 'phoneNumber'])) || null
  const coordinates = raw?.coordinates && typeof raw.coordinates === 'object' ? raw.coordinates : {}
  const latitude = coordinateValue(firstPresent(raw, ['latitude', 'lat']) || firstPresent(coordinates, ['latitude', 'lat']))
  const longitude = coordinateValue(firstPresent(raw, ['longitude', 'lng', 'lon', 'long', '_long']) || firstPresent(coordinates, ['longitude', 'lng', 'lon', 'long', '_long']))
  const parTotal = integerValue(firstPresent(raw, ['par_total', 'parTotal', 'par']))
  const holesCount = integerValue(firstPresent(raw, ['holes_count', 'holesCount', 'holes']))
  const courseRating = numberValue(firstPresent(raw, ['course_rating', 'courseRating', 'rating']))
  const slopeRating = integerValue(firstPresent(raw, ['slope_rating', 'slopeRating', 'slope']))

  const course = {
    id,
    name,
    normalized_name: normalizeCourseName(name),
    state,
    state_code: state,
    stateName: US_STATE_NAMES_BY_CODE[state] || state,
    city,
    address,
    postal_code: postalCode,
    website,
    phone,
    latitude,
    longitude,
    par: parTotal,
    parTotal,
    courseRating,
    course_rating: courseRating,
    slopeRating,
    slope_rating: slopeRating,
    holesCount,
    courseType: normalizeText(firstPresent(raw, ['type', 'course_type', 'courseType'])) || null,
  }
  return { ...course, label: buildCourseLabel(course) }
}

function getNestedCoordinate(source, objectKeys, latKeys, lngKeys) {
  for (const objectKey of objectKeys) {
    const nested = source?.[objectKey]
    if (!nested || typeof nested !== 'object') continue
    const latitude = coordinateValue(firstPresent(nested, latKeys))
    const longitude = coordinateValue(firstPresent(nested, lngKeys))
    if (latitude != null && longitude != null) return { latitude, longitude }
  }
  return null
}

function getHoleFlagCoordinate(raw) {
  const nested = getNestedCoordinate(
    raw,
    ['flag', 'flagcoords', 'flagCoords', 'pin', 'cup', 'green_center', 'greenCenter', 'center', 'centroid'],
    ['latitude', 'lat'],
    ['longitude', 'lng', 'lon', 'long', '_long'],
  )
  if (nested) return nested

  const latitude = coordinateValue(firstPresent(raw, ['flag_latitude', 'flagLatitude', 'pin_latitude', 'pinLatitude', 'green_latitude', 'greenLatitude', 'center_latitude', 'centerLatitude']))
  const longitude = coordinateValue(firstPresent(raw, ['flag_longitude', 'flagLongitude', 'flag_lng', 'flagLng', 'flag_long', 'flagLong', 'pin_longitude', 'pinLongitude', 'pin_lng', 'pinLng', 'green_longitude', 'greenLongitude', 'center_longitude', 'centerLongitude', '_long']))
  if (latitude != null && longitude != null) return { latitude, longitude }

  return null
}

export function calculateDistanceYards(latitudeA, longitudeA, latitudeB, longitudeB) {
  const lat1 = numberValue(latitudeA)
  const lon1 = numberValue(longitudeA)
  const lat2 = numberValue(latitudeB)
  const lon2 = numberValue(longitudeB)
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

function normalizeHole(raw, index, golferLocation = null, selectedTeeColor = DEFAULT_TEE_COLOR) {
  const holeNumber = integerValue(firstPresent(raw, ['hole_number', 'holeNumber', 'holenumber', 'number', 'hole', 'sequence'])) || index + 1
  const id = normalizeText(firstPresent(raw, ['id', 'hole_id', 'holeId', 'holeid'])) || String(holeNumber)
  const par = integerValue(firstPresent(raw, ['par']))
  const yards = integerValue(firstPresent(raw, ['yards', 'yardage', 'length', 'length_yards', 'lengthYards', 'tee_yards', 'teeYards']))
  const strokeIndex = integerValue(firstPresent(raw, ['stroke_index', 'strokeIndex', 'handicap', 'hcp', 'mens_handicap', 'mensHandicap', 'si']))
  const flag = getHoleFlagCoordinate(raw)
  const rawTeeColor = golfbertTeeColor(firstPresent(raw, ['color', 'tee_color', 'teeColor', 'teebox_color', 'teeboxColor', 'teeboxtype', 'teeBoxType', 'tee_box_type']))
  const teeColor = rawTeeColor || normalizeTeeColor(selectedTeeColor)
  const teeBoxType = normalizeText(firstPresent(raw, ['teeboxtype', 'teeBoxType', 'tee_box_type'])) || teeColor
  const distanceToFlagYards = flag && golferLocation
    ? calculateDistanceYards(golferLocation.latitude, golferLocation.longitude, flag.latitude, flag.longitude)
    : null

  return {
    id,
    hole: Math.max(1, Math.min(18, holeNumber)),
    par: par && par > 0 ? par : null,
    yards: yards && yards > 0 ? yards : null,
    strokeIndex: strokeIndex && strokeIndex > 0 ? Math.min(18, strokeIndex) : null,
    teeColor,
    teeBoxType,
    flagLatitude: flag?.latitude ?? null,
    flagLongitude: flag?.longitude ?? null,
    distanceToFlagYards,
    score: par && par > 0 ? par : 0,
    scoreProvided: false,
  }
}

function normalizeScorecardHoleTeebox(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const holeNumber = integerValue(firstPresent(raw, ['holenumber', 'hole_number', 'holeNumber', 'number', 'hole'])) || index + 1
  return {
    hole: holeNumber,
    holeId: normalizeText(firstPresent(raw, ['holeid', 'hole_id', 'holeId'])),
    par: integerValue(firstPresent(raw, ['par'])),
    yards: integerValue(firstPresent(raw, ['length', 'yards', 'yardage', 'length_yards', 'lengthYards'])),
    strokeIndex: integerValue(firstPresent(raw, ['handicap', 'stroke_index', 'strokeIndex', 'hcp', 'si'])),
    color: normalizeText(firstPresent(raw, ['color', 'tee_color', 'teeColor', 'teebox_color', 'teeboxColor'])),
    teeColor: golfbertTeeColor(firstPresent(raw, ['color', 'tee_color', 'teeColor', 'teebox_color', 'teeboxColor', 'teeboxtype', 'teeBoxType', 'tee_box_type'])),
    teeBoxType: normalizeText(firstPresent(raw, ['teeboxtype', 'teeBoxType', 'tee_box_type'])),
  }
}

function scorecardTeePreference(entry, requestedTeeColor) {
  const teeColor = entry?.teeColor || golfbertTeeColor(entry?.color) || golfbertTeeColor(entry?.teeBoxType)
  if (teeColor === requestedTeeColor) return 100
  if (teeColor === DEFAULT_TEE_COLOR) return 80
  if (!teeColor) return 20
  return 10
}

function buildScorecardLookup(payload, requestedTeeColor = DEFAULT_TEE_COLOR) {
  const selectedTeeColor = normalizeTeeColor(requestedTeeColor)
  const lookup = new Map()
  const entries = normalizeArrayPayload(payload, ['holeteeboxes', 'resources'])
    .map(normalizeScorecardHoleTeebox)
    .filter((entry) => entry && entry.hole >= 1 && entry.hole <= 18)
  for (const entry of entries) {
    const normalizedEntry = { ...entry, teeColor: entry.teeColor || golfbertTeeColor(entry.color) || golfbertTeeColor(entry.teeBoxType) || '' }
    const existing = lookup.get(normalizedEntry.hole)
    if (!existing || scorecardTeePreference(normalizedEntry, selectedTeeColor) > scorecardTeePreference(existing, selectedTeeColor)) {
      lookup.set(normalizedEntry.hole, normalizedEntry)
    }
  }
  return lookup
}

function availableTeeColorsFromScorecard(scorecardPayload) {
  return Array.from(new Set(normalizeArrayPayload(scorecardPayload, ['holeteeboxes', 'resources'])
    .map((entry) => normalizeScorecardHoleTeebox(entry))
    .map((entry) => entry?.teeColor || golfbertTeeColor(entry?.color) || golfbertTeeColor(entry?.teeBoxType))
    .filter((color) => ['red', 'white', 'blue', 'black'].includes(color))))
}

function mergeScorecardIntoHoles(holes, scorecardPayload, requestedTeeColor = DEFAULT_TEE_COLOR) {
  const selectedTeeColor = normalizeTeeColor(requestedTeeColor)
  const lookup = buildScorecardLookup(scorecardPayload, selectedTeeColor)
  if (!lookup.size) return holes.map((hole) => ({ ...hole, teeColor: selectedTeeColor, teeBoxType: hole.teeBoxType || selectedTeeColor }))
  return holes.map((hole) => {
    const scorecard = lookup.get(hole.hole)
    const teeColor = normalizeTeeColor(scorecard?.teeColor || selectedTeeColor)
    if (!scorecard) return { ...hole, teeColor: selectedTeeColor, teeBoxType: hole.teeBoxType || selectedTeeColor }
    const par = scorecard.par || hole.par || null
    return {
      ...hole,
      par,
      yards: scorecard.yards || hole.yards || null,
      strokeIndex: scorecard.strokeIndex || hole.strokeIndex || null,
      teeColor,
      teeBoxType: scorecard.teeBoxType || teeColor,
      score: par && par > 0 ? par : hole.score,
    }
  })
}

function holesNeedScorecardEnrichment(holes) {
  return holes.some((hole) => !hole.par || !hole.yards || !hole.strokeIndex)
}

async function getGolfbertCourseScorecard(courseId) {
  const cleanCourseId = normalizeText(courseId)
  const key = `scorecard:${cleanCourseId}`
  const cached = cacheGet(scorecardCache, key)
  if (cached) return cached
  const payload = await golfbertRequest(`/courses/${encodeURIComponent(cleanCourseId)}/scorecard`, {}, { preferredKeys: ['holeteeboxes', 'resources'] })
  return cacheSet(scorecardCache, key, payload)
}

async function golfbertRequest(pathname, params = {}, { cacheKey = '', preferredKeys = [] } = {}) {
  if (cacheKey) {
    const cached = cacheGet(courseSearchCache, cacheKey) || cacheGet(holesCache, cacheKey)
    if (cached) return cached
  }

  const apiKey = requireApiKey()
  const url = buildGolfbertUrl(pathname)
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || normalizeText(value) === '') continue
    url.searchParams.set(key, String(value))
  }
  appendAuthQuery(url, apiKey)

  const startedAt = Date.now()
  const endpointPath = url.pathname
  const authScheme = getAuthScheme()
  const headers = buildSignedAwsV4Headers(url, buildAuthHeaders(apiKey), { method: 'GET' })
  logApi('golfbert_api_request_started', {
    endpoint: pathname,
    requestPath: endpointPath,
    baseUrl: url.origin,
    query: safeGolfbertQuery(url),
    authScheme,
    signedRequest: authScheme === 'aws4',
    signedHeaders: headers.Authorization ? String(headers.Authorization).match(/SignedHeaders=([^,]+)/)?.[1] || null : null,
    apiKeyHeaderPresent: Boolean(normalizeText(process.env.GOLFBERT_API_KEY_HEADER || 'x-api-key')),
  })

  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
    })
  } catch (error) {
    const durationMs = Date.now() - startedAt
    await recordExternalApiCall({ apiType: 'golfbert', endpoint: endpointPath, method: 'GET', statusCode: null, ok: false, durationMs })
    logError('Golfbert API request network error', { endpoint: pathname, requestPath: endpointPath, durationMs, error })
    throw error
  }
  const text = await response.text()
  const durationMs = Date.now() - startedAt
  await recordExternalApiCall({ apiType: 'golfbert', endpoint: endpointPath, method: 'GET', statusCode: response.status, ok: response.ok, durationMs })

  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch (error) {
      logError('Golfbert API returned non-JSON response', { endpoint: pathname, requestPath: endpointPath, status: response.status, durationMs, contentType: response.headers?.get?.('Content-Type') || null, responsePreview: text.slice(0, 160), diagnostic: golfbertFailureDiagnostic(String(response.status), endpointPath), error })
      throw new Error(`Golfbert API returned a non-JSON response from ${url.origin}${url.pathname}. Check GOLFBERT_API_BASE_URL and credentials.`)
    }
  }

  const resultCount = normalizeArrayPayload(payload, preferredKeys).length
  logApi('golfbert_api_request_completed', {
    endpoint: pathname,
    requestPath: endpointPath,
    status: response.status,
    ok: response.ok,
    durationMs,
    resultCount,
  })

  if (!response.ok) {
    const message = normalizeText(payload?.message || payload?.error || `Golfbert API request failed with status ${response.status}`)
    const diagnostic = golfbertFailureDiagnostic(message, endpointPath)
    logError('Golfbert API request failed', { endpoint: pathname, requestPath: endpointPath, status: response.status, durationMs, message, diagnostic })
    const error = new Error(message)
    error.status = response.status
    error.diagnostic = diagnostic
    throw error
  }

  return payload
}

function courseSearchCacheKey(state, query) {
  return `courses:${normalizeState(state)}:${normalizeText(query).toLowerCase()}`
}

function courseResolveCacheKey(state, courseName) {
  return `course:${normalizeState(state)}:${normalizeCourseName(courseName)}`
}

function holeCacheKey(courseId, golferLocation = null) {
  const locationKey = golferLocation ? `${Number(golferLocation.latitude).toFixed(6)},${Number(golferLocation.longitude).toFixed(6)}` : 'no-location'
  return `holes:${normalizeText(courseId)}:${locationKey}`
}

function sortCourses(courses) {
  return [...courses].sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')) || String(left.city || '').localeCompare(String(right.city || '')))
}

export async function searchGolfbertCourses({ state = '', query = '' } = {}) {
  const cleanState = normalizeState(state)
  const cleanQuery = normalizeText(query)
  const pageSize = golfbertCoursePageSize()
  const key = courseSearchCacheKey(cleanState, cleanQuery)
  const cached = cacheGet(courseSearchCache, key)
  if (cached) return cached

  const normalizedCoursesById = new Map()
  const seenMarkers = new Set()
  let marker = 0
  let pageCount = 0

  while (pageCount < MAX_COURSE_PAGES) {
    const params = {
      state: cleanState ? golfbertStateParam(cleanState) : '',
      name: cleanQuery,
      limit: pageSize,
      marker,
    }
    const payload = await golfbertRequest('/courses/', params, { preferredKeys: ['courses', 'resources'] })
    const rawCourses = normalizeArrayPayload(payload, ['courses', 'resources'])
    const normalizedPage = rawCourses
      .map(normalizeCourse)
      .filter(Boolean)
      .filter((course) => !cleanState || normalizeState(course.state || course.state_code || course.stateName) === cleanState)

    for (const course of normalizedPage) {
      normalizedCoursesById.set(normalizeText(course.id), course)
    }

    logApi('golfbert_course_page_loaded', {
      state: cleanState,
      query: cleanQuery,
      marker,
      pageSize,
      rawResultCount: rawCourses.length,
      acceptedResultCount: normalizedPage.length,
      accumulatedResultCount: normalizedCoursesById.size,
    })

    if (rawCourses.length < pageSize) break
    const nextMarker = rawCourseMarker(rawCourses)
    if (nextMarker == null || seenMarkers.has(nextMarker)) break
    seenMarkers.add(nextMarker)
    marker = nextMarker
    pageCount += 1
  }

  if (pageCount >= MAX_COURSE_PAGES) {
    logWarn('Golfbert course paging stopped at maximum page guard', { state: cleanState, query: cleanQuery, pageSize, maxPages: MAX_COURSE_PAGES, accumulatedResultCount: normalizedCoursesById.size })
  }

  const courses = sortCourses([...normalizedCoursesById.values()])

  for (const course of courses) {
    cacheSet(courseByIdCache, normalizeText(course.id), course)
    cacheSet(courseResolutionCache, courseResolveCacheKey(course.state, course.name), course)
  }

  return cacheSet(courseSearchCache, key, courses)
}

function scoreCourseNameMatch(course, courseName) {
  const target = normalizeCourseName(courseName)
  const candidate = normalizeCourseName(course?.normalized_name || course?.name)
  if (!target || !candidate) return 0
  if (target === candidate) return 100
  if (candidate.includes(target) || target.includes(candidate)) return 85 - Math.abs(candidate.length - target.length)
  const words = target.split(' ').filter((word) => word.length > 2)
  const matches = words.filter((word) => candidate.includes(word)).length
  return matches >= Math.max(1, Math.ceil(words.length * 0.75)) ? 50 + matches : 0
}

export async function resolveGolfbertCourse({ state = '', courseName = '', courseId = '' } = {}) {
  const cleanCourseId = normalizeText(courseId)
  const cleanState = normalizeState(state)
  const cleanCourseName = normalizeText(courseName)
  if (cleanCourseId) {
    const cachedById = cacheGet(courseByIdCache, cleanCourseId)
    if (cachedById) return cachedById
    if (!cleanCourseName) {
      return { id: cleanCourseId, name: cleanCourseId, normalized_name: normalizeCourseName(cleanCourseId), state: cleanState, state_code: cleanState, label: cleanCourseId }
    }
  }

  const key = courseResolveCacheKey(cleanState, cleanCourseName)
  const cached = cacheGet(courseResolutionCache, key)
  if (cached) return cached

  const courses = await searchGolfbertCourses({ state: cleanState, query: cleanCourseName, limit: 25 })
  const match = courses
    .map((course) => ({ course, score: scoreCourseNameMatch(course, cleanCourseName) + (cleanState && normalizeState(course.state) === cleanState ? 5 : 0) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.course || null

  if (!match) return null
  cacheSet(courseByIdCache, normalizeText(match.id), match)
  cacheSet(courseResolutionCache, key, match)
  return match
}

export async function getGolfbertCourseHoles({ state = '', course = '', courseId = '', golferLatitude = null, golferLongitude = null, teeColor = DEFAULT_TEE_COLOR } = {}) {
  const selectedTeeColor = normalizeTeeColor(teeColor)
  const matchedCourse = await resolveGolfbertCourse({ state, courseName: course, courseId })
  if (!matchedCourse?.id) {
    throw new Error('Select a golf course from the Golfbert catalog for the selected state.')
  }

  const golferLocation = numberValue(golferLatitude) != null && numberValue(golferLongitude) != null
    ? { latitude: numberValue(golferLatitude), longitude: numberValue(golferLongitude) }
    : null

  const key = `${holeCacheKey(matchedCourse.id, golferLocation)}:${selectedTeeColor}`
  const cached = cacheGet(holesCache, key)
  if (cached) return cached

  const payload = await golfbertRequest(`/courses/${encodeURIComponent(matchedCourse.id)}/holes`, {}, { preferredKeys: ['holes', 'resources'] })
  let holes = normalizeArrayPayload(payload, ['holes', 'resources'])
    .map((hole, index) => normalizeHole(hole, index, golferLocation, selectedTeeColor))
    .filter((hole) => hole.hole >= 1 && hole.hole <= 18)
    .sort((left, right) => left.hole - right.hole)

  let availableTeeColors = []
  if (holes.length) {
    try {
      const scorecardPayload = await getGolfbertCourseScorecard(matchedCourse.id)
      availableTeeColors = availableTeeColorsFromScorecard(scorecardPayload)
      holes = mergeScorecardIntoHoles(holes, scorecardPayload, selectedTeeColor)
      logApi('golfbert_scorecard_tee_loaded', {
        courseId: matchedCourse.id,
        selectedTeeColor,
        availableTeeColors,
        enrichedHoleCount: holes.filter((hole) => hole.teeColor === selectedTeeColor || hole.yards || hole.par || hole.strokeIndex).length,
        requestedTeeAvailable: availableTeeColors.includes(selectedTeeColor),
      })
    } catch (error) {
      if (holesNeedScorecardEnrichment(holes)) {
        logWarn('Golfbert scorecard enrichment failed; using hole payload only', { courseId: matchedCourse.id, selectedTeeColor, error: { name: error?.name, message: error?.message } })
      }
      holes = holes.map((hole) => ({ ...hole, teeColor: selectedTeeColor, teeBoxType: hole.teeBoxType || selectedTeeColor }))
    }
  }

  if (!holes.length) {
    logWarn('Golfbert course holes response was empty', { courseId: matchedCourse.id, state, course })
    throw new Error('Golfbert did not return hole data for this course.')
  }

  const normalized = holes.slice(0, 18)
  return cacheSet(holesCache, key, {
    course: matchedCourse,
    teeColor: selectedTeeColor,
    availableTeeColors,
    holes: normalized,
  })
}

export function formatGolfbertPhysicalAddress(course) {
  if (!course?.address) return ''
  const cityStateZip = [course.city, [course.state || course.state_code, course.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [course.address, cityStateZip].filter(Boolean).join(', ')
}

export function __resetGolfbertClientCachesForTests() {
  courseSearchCache.clear()
  courseByIdCache.clear()
  courseResolutionCache.clear()
  holesCache.clear()
  scorecardCache.clear()
  baseUrlWarningEmitted = false
}
