import { api } from './api'
import { getCorrelationId, logFrontendEvent } from './frontend-logger'

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
  label: string
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
  const query = new URLSearchParams()
  if (params.state) query.set('state', params.state)
  if (params.query) query.set('q', params.query)
  const correlationId = getCorrelationId()
  logFrontendEvent({ category: 'golf-courses.search', message: 'started', data: { correlationId, state: params.state || null, query: params.query || '' } })
  try {
    const results = normalizeGolfCourseOptions(await api<unknown>(`/api/golf-courses?${query.toString()}`))
    logFrontendEvent({ category: 'golf-courses.search', message: 'completed', data: { correlationId, state: params.state || null, query: params.query || '', resultCount: results.length } })
    return results
  } catch (error) {
    logFrontendEvent({ category: 'golf-courses.search', level: 'error', message: 'failed', data: { correlationId, state: params.state || null, query: params.query || '', error: error instanceof Error ? error.message : String(error) } })
    throw error
  }
}
