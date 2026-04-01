import type { SavedLocation } from './location-store'
import { attachRequestMetadata, getCorrelationId, logFrontendEvent } from './frontend-logger'

export type LocationOption = SavedLocation & { key?: string }

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  return text ? JSON.parse(text) as T : ([] as unknown as T)
}

async function locationFetch<T>(url: string, requestName: string): Promise<T> {
  const startedAt = Date.now()
  const requestInit = attachRequestMetadata({ method: 'GET' })

  const response = await fetch(url, {
    ...requestInit,
    credentials: 'include',
  })

  const correlationId = response.headers.get('X-Correlation-Id') || getCorrelationId()

  logFrontendEvent({
    category: 'location.fetch',
    level: response.ok ? 'info' : 'warn',
    message: requestName,
    data: {
      correlationId,
      url,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
    },
  })

  if (!response.ok) {
    const payload = await parseJson<{ message?: string } | null>(response)
    throw new Error(payload?.message || `Request failed (${response.status})`)
  }

  return parseJson<T>(response)
}

export async function searchLocations(query: string, limit = 8): Promise<LocationOption[]> {
  const normalized = String(query || '').trim()
  if (normalized.length < 2) return []

  const url = new URL('/api/locations/search', window.location.origin)
  url.searchParams.set('q', normalized)
  url.searchParams.set('limit', String(limit))
  return locationFetch<LocationOption[]>(url.toString(), 'location_search_completed')
}

export async function getNearestLocation(latitude: number, longitude: number): Promise<LocationOption | null> {
  const url = new URL('/api/locations/nearest', window.location.origin)
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  return locationFetch<LocationOption | null>(url.toString(), 'location_nearest_completed')
}
