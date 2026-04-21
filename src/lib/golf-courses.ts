import { api } from './api'
import { getCorrelationId, logFrontendEvent } from './frontend-logger'

export type GolfCourseOption = {
  id: string
  name: string
  state: string
  city?: string | null
  courseType?: string | null
  holesCount?: number | null
  parTotal?: number | null
  latitude?: number | null
  longitude?: number | null
  address?: string | null
  postalCode?: string | null
  website?: string | null
  phone?: string | null
  label: string
}

export async function searchGolfCourses(params: { state?: string; query?: string; limit?: number } = {}): Promise<GolfCourseOption[]> {
  const query = new URLSearchParams()
  if (params.state) query.set('state', params.state)
  if (params.query) query.set('q', params.query)
  if (params.limit) query.set('limit', String(params.limit))
  const correlationId = getCorrelationId()
  logFrontendEvent({ category: 'golf-courses.search', message: 'started', data: { correlationId, state: params.state || null, query: params.query || '', limit: params.limit || null } })
  try {
    const results = await api<GolfCourseOption[]>(`/api/golf-courses?${query.toString()}`)
    logFrontendEvent({ category: 'golf-courses.search', message: 'completed', data: { correlationId, state: params.state || null, query: params.query || '', resultCount: results.length } })
    return results
  } catch (error) {
    logFrontendEvent({ category: 'golf-courses.search', level: 'error', message: 'failed', data: { correlationId, state: params.state || null, query: params.query || '', error: error instanceof Error ? error.message : String(error) } })
    throw error
  }
}
