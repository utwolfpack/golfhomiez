import { api } from './api'
import type { SavedLocation } from './location-store'

type LocationOption = SavedLocation & { key?: string; distanceMiles?: number }

type SearchResponse = { results: LocationOption[] }
type ResolveResponse = { location: LocationOption }

function getPageOrigin() {
  if (typeof window === 'undefined') return 'http://localhost'
  return window.location.origin
}

export async function searchLocations(query: string, limit = 8): Promise<LocationOption[]> {
  const url = new URL('/api/locations/search', getPageOrigin())
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(limit))
  const data = await api<SearchResponse>(url.toString(), { method: 'GET' })
  return Array.isArray(data?.results) ? data.results : []
}

export async function getNearestLocation(latitude: number, longitude: number): Promise<LocationOption | null> {
  const url = new URL('/api/locations/resolve', getPageOrigin())
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  try {
    const data = await api<ResolveResponse>(url.toString(), { method: 'GET' })
    return data?.location || null
  } catch (error) {
    if (error instanceof Error && /404/.test(error.message)) return null
    throw error
  }
}

export async function resolveMyLocationFromBrowser(): Promise<LocationOption> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('Location detection is not available in this browser.')
  }

  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 300000,
    })
  })

  const location = await getNearestLocation(position.coords.latitude, position.coords.longitude)
  if (!location) throw new Error('No nearby location match was found.')
  return location
}
