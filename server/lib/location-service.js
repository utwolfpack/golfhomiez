import { City, State } from 'country-state-city'

const stateNameByCode = new Map(
  State.getStatesOfCountry('US')
    .filter((state) => state.isoCode && state.name)
    .map((state) => [state.isoCode, state.name]),
)

let usLocationsCache = null

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function buildLabel(city, stateName, stateCode) {
  return `${city}, ${stateCode} · ${stateName}`
}

function toLocation(city) {
  if (city.countryCode !== 'US' || !city.stateCode || !city.name) return null
  const latitude = Number(city.latitude)
  const longitude = Number(city.longitude)
  const stateName = stateNameByCode.get(city.stateCode) || ''
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

export function getUSLocations() {
  if (usLocationsCache) return usLocationsCache

  const seen = new Set()
  usLocationsCache = City.getCitiesOfCountry('US')
    .map(toLocation)
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item.key)) return false
      seen.add(item.key)
      return true
    })

  return usLocationsCache
}

export function searchLocations(query, limit = 8) {
  const q = normalize(query).trim()
  const all = getUSLocations()
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

function toRadians(value) {
  return value * (Math.PI / 180)
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export function getNearestLocation(latitude, longitude) {
  const all = getUSLocations()
  if (!all.length || Number.isNaN(latitude) || Number.isNaN(longitude)) return null

  let best = null
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
