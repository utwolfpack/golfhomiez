import { api } from './api'
import { getCorrelationId, logFrontendEvent } from './frontend-logger'

export type GolfCourseStateOption = {
  abbr: string
  name: string
}

const COURSE_SEARCH_MIN_CHARS = 0
export const MAX_COURSE_SEARCH_LIMIT = 1000
const courseSearchCache = new Map<string, GolfCourseOption[]>()
const courseSearchInFlight = new Map<string, Promise<GolfCourseOption[]>>()

export type GolfCourseOption = {
  id: string
  name: string
  state: string
  state_code?: string | null
  city?: string | null
  courseType?: string | null
  holesCount?: number | null
  parTotal?: number | null
  par?: number | null
  courseRating?: number | null
  slopeRating?: number | null
  latitude?: number | null
  longitude?: number | null
  address?: string | null
  postalCode?: string | null
  postal_code?: string | null
  website?: string | null
  phone?: string | null
  distanceYards?: number | null
  distance_yards?: number | null
  label: string
}


function normalizeCourseStateOption(raw: unknown): GolfCourseStateOption | null {
  if (typeof raw === 'string') {
    const abbr = raw.trim().toUpperCase()
    return abbr ? { abbr, name: abbr } : null
  }
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const abbr = String(record.abbr || record.code || record.state || record.state_code || record.stateCode || '').trim().toUpperCase()
  const name = String(record.name || record.stateName || record.label || abbr).trim()
  return abbr ? { abbr, name: name || abbr } : null
}

export function normalizeGolfCourseStateOptions(raw: unknown): GolfCourseStateOption[] {
  const values: unknown[] = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray((raw as any).states) ? (raw as any).states : [])
  const seen = new Set<string>()
  return values
    .map(normalizeCourseStateOption)
    .filter((state): state is GolfCourseStateOption => Boolean(state))
    .filter((state) => {
      if (seen.has(state.abbr)) return false
      seen.add(state.abbr)
      return true
    })
}

function toNumber(value: unknown): number | null {
  const next = Number(value)
  return Number.isFinite(next) ? next : null
}

function normalizeCourseOption(raw: unknown, index: number): GolfCourseOption | null {
  if (typeof raw === 'string') {
    const name = raw.trim()
    if (!name) return null
    return { id: name, name, state: '', label: name }
  }
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const id = String(record.id || record.course_id || record.courseId || record.slug || '').trim()
  const name = String(record.name || record.course_name || record.courseName || '').trim()
  if (!name) return null
  const state = String(record.state || record.state_code || record.stateCode || '').trim().toUpperCase()
  const city = String(record.city || '').trim()
  const parTotal = toNumber(record.parTotal ?? record.par_total ?? record.par)
  const holesCount = toNumber(record.holesCount ?? record.holes_count ?? record.holes)
  const label = String(record.label || '').trim() || [name, [city, state].filter(Boolean).join(', '), parTotal ? `Par ${parTotal}` : ''].filter(Boolean).join(' · ')

  return {
    id: id || `${state || 'course'}-${index}-${name}`,
    name,
    state,
    state_code: String(record.state_code || record.stateCode || state || '').trim().toUpperCase() || null,
    city: city || null,
    courseType: String(record.courseType || record.course_type || record.type || '').trim() || null,
    holesCount,
    parTotal,
    par: parTotal,
    courseRating: toNumber(record.courseRating ?? record.course_rating),
    slopeRating: toNumber(record.slopeRating ?? record.slope_rating),
    latitude: toNumber(record.latitude ?? record.lat),
    longitude: toNumber(record.longitude ?? record.lng ?? record.lon),
    address: String(record.address || '').trim() || null,
    postalCode: String(record.postalCode || record.postal_code || record.zip || '').trim() || null,
    postal_code: String(record.postal_code || record.postalCode || record.zip || '').trim() || null,
    website: String(record.website || '').trim() || null,
    phone: String(record.phone || '').trim() || null,
    distanceYards: toNumber(record.distanceYards ?? record.distance_yards),
    distance_yards: toNumber(record.distance_yards ?? record.distanceYards),
    label,
  }
}

export function normalizeGolfCourseOptions(raw: unknown): GolfCourseOption[] {
  const values = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray((raw as any).courses) ? (raw as any).courses : [])
  return values.map(normalizeCourseOption).filter(Boolean) as GolfCourseOption[]
}

export function golfCourseNames(courses: GolfCourseOption[]): string[] {
  const seen = new Set<string>()
  return courses
    .map((course) => course.name)
    .filter((name) => {
      const key = name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export async function searchGolfCourses(params: { state?: string; query?: string; limit?: number } = {}): Promise<GolfCourseOption[]> {
  const trimmedQuery = String(params.query || '').trim()
  const state = String(params.state || '').trim().toUpperCase()
  const limit = Math.min(Math.max(Number(params.limit) || 25, 1), MAX_COURSE_SEARCH_LIMIT)
  if (!state || trimmedQuery.length < COURSE_SEARCH_MIN_CHARS) return []

  const query = new URLSearchParams()
  query.set('state', state)
  if (trimmedQuery) query.set('q', trimmedQuery)
  query.set('limit', String(limit))

  const cacheKey = query.toString().toLowerCase()
  const cached = courseSearchCache.get(cacheKey)
  if (cached) return cached
  const inFlight = courseSearchInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const correlationId = getCorrelationId()
  logFrontendEvent({ category: 'golf-courses.search', message: 'started', data: { correlationId, state, query: trimmedQuery, limit } })
  const request = api<unknown>(`/api/golf-courses?${query.toString()}`)
    .then((payload) => {
      const results = normalizeGolfCourseOptions(payload)
      courseSearchCache.set(cacheKey, results)
      logFrontendEvent({ category: 'golf-courses.search', message: 'completed', data: { correlationId, state, query: trimmedQuery, limit, resultCount: results.length } })
      return results
    })
    .catch((error) => {
      logFrontendEvent({ category: 'golf-courses.search', level: 'error', message: 'failed', data: { correlationId, state, query: trimmedQuery, limit, error: error instanceof Error ? error.message : String(error) } })
      throw error
    })
    .finally(() => {
      courseSearchInFlight.delete(cacheKey)
    })

  courseSearchInFlight.set(cacheKey, request)
  return request
}


export async function findNearestGolfCourse(params: { latitude: number; longitude: number; state?: string } = { latitude: NaN, longitude: NaN }): Promise<GolfCourseOption | null> {
  const latitude = Number(params.latitude)
  const longitude = Number(params.longitude)
  const state = String(params.state || '').trim().toUpperCase()
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  const query = new URLSearchParams({ lat: String(latitude), lng: String(longitude) })
  if (state) query.set('state', state)

  const correlationId = getCorrelationId()
  logFrontendEvent({ category: 'golf-courses.nearest', message: 'started', data: { correlationId, state, latitude, longitude } })
  try {
    const payload = await api<unknown>(`/api/golf-courses/nearest?${query.toString()}`)
    const course = normalizeCourseOption(payload, 0)
    logFrontendEvent({ category: 'golf-courses.nearest', message: 'completed', data: { correlationId, state, found: Boolean(course), courseId: course?.id || '', courseName: course?.name || '', distanceYards: course?.distanceYards ?? null } })
    return course
  } catch (error) {
    logFrontendEvent({ category: 'golf-courses.nearest', level: 'warn', message: 'failed', data: { correlationId, state, error: error instanceof Error ? error.message : String(error) } })
    throw error
  }
}

export async function fetchGolfCourseStates(): Promise<GolfCourseStateOption[]> {
  const correlationId = getCorrelationId()
  logFrontendEvent({ category: 'golf-courses.states', message: 'started', data: { correlationId } })
  try {
    const results = normalizeGolfCourseStateOptions(await api<unknown>('/api/golf-course-states'))
    logFrontendEvent({ category: 'golf-courses.states', message: 'completed', data: { correlationId, resultCount: results.length } })
    return results
  } catch (error) {
    logFrontendEvent({ category: 'golf-courses.states', level: 'error', message: 'failed', data: { correlationId, error: error instanceof Error ? error.message : String(error) } })
    throw error
  }
}
