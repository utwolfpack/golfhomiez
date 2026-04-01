import { requestJson } from './request'
import type { SavedLocation } from './location-store'

type LocationOption = SavedLocation & { key?: string }

function getBaseUrl() {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin
  return ''
}

export async function searchLocations(query: string, limit = 8): Promise<LocationOption[]> {
  const q = String(query || '').trim()
  if (q.length < 2) return []
  const url = `${getBaseUrl()}/api/locations/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}`
  const { data, response } = await requestJson<LocationOption[]>(url)
  if (!response.ok) throw new Error('Location search failed')
  return Array.isArray(data) ? data : []
}

export async function getNearestLocation(latitude: number, longitude: number): Promise<LocationOption | null> {
  const url = `${getBaseUrl()}/api/locations/nearest?latitude=${encodeURIComponent(String(latitude))}&longitude=${encodeURIComponent(String(longitude))}`
  const { data, response } = await requestJson<LocationOption | null>(url)
  if (!response.ok) throw new Error('Nearest location lookup failed')
  return data || null
}
