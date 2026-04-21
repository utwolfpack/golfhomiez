import { getCorrelationId, logFrontendEvent } from './frontend-logger'

export type ResolvedLocation = {
  city?: string
  state?: string
  stateCode?: string
  stateName?: string
  label: string
  latitude?: number
  longitude?: number
  accuracy?: number
  postalCode?: string
}

async function fetchJson<T>(url: string, action: string): Promise<T> {
  const correlationId = getCorrelationId()
  const startedAt = Date.now()

  logFrontendEvent({
    category: 'location.fetch',
    message: `${action}_started`,
    data: { correlationId, url },
  })

  const response = await fetch(url, {
    headers: {
      'X-Correlation-Id': correlationId,
    },
  })

  logFrontendEvent({
    category: 'location.fetch',
    level: response.ok ? 'info' : 'warn',
    message: `${action}_completed`,
    data: { correlationId, url, status: response.status, durationMs: Date.now() - startedAt },
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}

export async function searchLocations(query: string, limit = 8): Promise<ResolvedLocation[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const params = new URLSearchParams({ q: trimmed, limit: String(limit) })
  const data = await fetchJson<{ locations?: ResolvedLocation[] } | ResolvedLocation[]>(`/api/locations/search?${params.toString()}`, 'location_search')
  if (Array.isArray(data)) return data
  return Array.isArray(data.locations) ? data.locations : []
}

export async function getNearestLocation(
  latitude: number,
  longitude: number,
): Promise<ResolvedLocation | null> {
  const params = new URLSearchParams({
    lat: String(latitude),
    lng: String(longitude),
  })

  const data = await fetchJson<ResolvedLocation | { location?: ResolvedLocation }>(`/api/locations/nearest?${params.toString()}`, 'location_nearest')

  if ('location' in data && data.location) {
    return data.location
  }

  if ('label' in data && typeof data.label === 'string') {
    return data as ResolvedLocation
  }

  return null
}

export async function resolveMyLocationFromBrowser(): Promise<ResolvedLocation> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('Geolocation is not supported on this device')
  }

  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60000,
    })
  })

  const latitude = position.coords.latitude
  const longitude = position.coords.longitude
  const accuracy = position.coords.accuracy

  const nearest = await getNearestLocation(latitude, longitude)
  if (!nearest) {
    throw new Error('Unable to resolve location from coordinates')
  }

  return {
    ...nearest,
    latitude,
    longitude,
    accuracy,
  }
}
