export type ResolvedLocation = {
  city?: string
  state?: string
  stateCode?: string
  label: string
  latitude?: number
  longitude?: number
  accuracy?: number
}

function getCorrelationId(): string {
  const g = globalThis as typeof globalThis & { __CORRELATION_ID__?: string }
  return g.__CORRELATION_ID__ ?? ''
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'X-Correlation-Id': getCorrelationId(),
    },
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}

export async function searchLocations(query: string): Promise<ResolvedLocation[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const params = new URLSearchParams({ q: trimmed })
  const data = await fetchJson<{ locations?: ResolvedLocation[] }>(`/api/locations/search?${params.toString()}`)
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

  const data = await fetchJson<ResolvedLocation | { location?: ResolvedLocation }>(
    `/api/locations/nearest?${params.toString()}`,
  )

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
