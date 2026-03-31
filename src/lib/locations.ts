import type { ICity } from "country-state-city"
import type { SavedLocation } from './location-store'

type LocationOption = SavedLocation & { key: string }
type CountryStateCityModule = typeof import('country-state-city')

let cscModulePromise: Promise<CountryStateCityModule> | null = null
let usLocationsCache: LocationOption[] | null = null

function getCountryStateCityModule() {
  if (!cscModulePromise) {
    cscModulePromise = import('country-state-city')
  }
  return cscModulePromise
}

function normalize(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function buildLabel(city: string, stateName: string, stateCode: string) {
  return `${city}, ${stateCode} · ${stateName}`
}

function toLocation(city: ICity, stateName: string): LocationOption | null {
  if (city.countryCode !== 'US' || !city.stateCode || !city.name) return null
  const latitude = Number(city.latitude)
  const longitude = Number(city.longitude)
  if (!stateName || Number.isNaN(latitude) || Number.isNaN(longitude)) return null

  return {
    key: `${city.name}|${city.stateCode}|${latitude}|${longitude}`,
    city: city.name,
    stateCode: city.stateCode,
    stateName,
    label: buildLabel(city.name, stateName, city.stateCode),
    latitude,
    longitude,
  }
}

export async function getUSLocations(): Promise<LocationOption[]> {
  if (usLocationsCache) return usLocationsCache

  const { City, State } = await getCountryStateCityModule()
  const seen = new Set<string>()
  const statesByCode = new Map(
    State.getStatesOfCountry('US')
      .filter((state) => state.isoCode && state.name)
      .map((state) => [state.isoCode, state.name]),
  )

  usLocationsCache = City.getCitiesOfCountry('US')
    .map((city) => toLocation(city, statesByCode.get(city.stateCode) || ''))
    .filter((item): item is LocationOption => Boolean(item))
    .filter((item) => {
      if (seen.has(item.key)) return false
      seen.add(item.key)
      return true
    })

  return usLocationsCache
}

export async function searchLocations(query: string, limit = 8): Promise<LocationOption[]> {
  const q = normalize(query).trim()
  const all = await getUSLocations()
  if (!q) return all.slice(0, limit)

  const scored = all
    .map((location) => {
      const city = normalize(location.city)
      const stateCode = normalize(location.stateCode)
      const stateName = normalize(location.stateName)
      let score = 0
      if (city === q) score += 100
      else if (city.startsWith(q)) score += 80
      else if (city.includes(q)) score += 40
      if (stateCode === q) score += 60
      else if (stateCode.startsWith(q)) score += 30
      if (stateName.startsWith(q)) score += 50
      else if (stateName.includes(q)) score += 20
      return { location, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.location.label.localeCompare(b.location.label))

  return scored.slice(0, limit).map((entry) => entry.location)
}

function toRadians(value: number) {
  return value * (Math.PI / 180)
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export async function getNearestLocation(latitude: number, longitude: number): Promise<LocationOption | null> {
  const all = await getUSLocations()
  if (!all.length || Number.isNaN(latitude) || Number.isNaN(longitude)) return null

  let best: LocationOption | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const location of all) {
    const distance = haversineMiles(latitude, longitude, location.latitude, location.longitude)
    if (distance < bestDistance) {
      best = location
      bestDistance = distance
    }
  }

  return best
}
