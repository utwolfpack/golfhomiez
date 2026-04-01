import type { SavedLocation } from './location-store'
import { attachRequestMetadata } from './frontend-logger'

export type LocationOption = SavedLocation & { key: string }

async function fetchLocationJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    ...attachRequestMetadata({ method: 'GET' }),
    credentials: 'include',
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(data?.message || `Location request failed (${response.status})`)
  }

  return data as T
}

export async function searchLocations(query: string, limit = 8): Promise<LocationOption[]> {
  const url = new URL('/api/locations/search', window.location.origin)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(limit))
  const payload = await fetchLocationJson<{ results?: LocationOption[] }>(url.toString())
  return Array.isArray(payload?.results) ? payload.results : []
}

export async function getNearestLocation(latitude: number, longitude: number): Promise<LocationOption | null> {
  const url = new URL('/api/locations/nearest', window.location.origin)
  url.searchParams.set('lat', String(latitude))
  url.searchParams.set('lng', String(longitude))
  const payload = await fetchLocationJson<{ result?: LocationOption | null }>(url.toString())
  return payload?.result || null
}
