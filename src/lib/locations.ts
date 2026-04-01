import type { SavedLocation } from './location-store'
import { attachRequestMetadata, logFrontendEvent } from './frontend-logger'

type LocationOption = SavedLocation & { key?: string }

function buildUrl(path: string, params: Record<string, string | number>) {
  const url = new URL(path, window.location.origin)
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value))
  })
  return url.toString()
}

async function requestJson<T>(url: string, requestName: string): Promise<T> {
  const startedAt = Date.now()
  const response = await fetch(url, {
    ...attachRequestMetadata({ method: 'GET' }),
    credentials: 'same-origin',
  })

  logFrontendEvent({
    category: 'location.fetch',
    level: response.ok ? 'info' : 'warn',
    message: requestName,
    data: { url, status: response.status, ok: response.ok, durationMs: Date.now() - startedAt },
  })

  if (!response.ok) {
    throw new Error(`Location request failed (${response.status})`)
  }

  return response.json() as Promise<T>
}

export async function searchLocations(query: string, limit = 8): Promise<LocationOption[]> {
  const trimmed = String(query || '').trim()
  if (!trimmed) return []
  const url = buildUrl('/api/locations/search', { q: trimmed, limit })
  const payload = await requestJson<{ locations?: LocationOption[] }>(url, 'search_locations')
  return Array.isArray(payload.locations) ? payload.locations : []
}

export async function getNearestLocation(latitude: number, longitude: number): Promise<LocationOption | null> {
  const url = buildUrl('/api/locations/nearest', { latitude, longitude })
  const payload = await requestJson<{ location?: LocationOption | null }>(url, 'nearest_location')
  return payload.location || null
}
