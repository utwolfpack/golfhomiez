import { City, State } from 'country-state-city'

let cachedUsLocations = null

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

function buildLabel(city, stateName, stateCode) {
  return `${city}, ${stateCode} · ${stateName}`
}

function getUsLocations() {
  if (cachedUsLocations) return cachedUsLocations

  const statesByCode = new Map(
    State.getStatesOfCountry('US')
      .filter((state) => state.isoCode && state.name)
      .map((state) => [state.isoCode, state.name]),
  )

  const seen = new Set()
  cachedUsLocations = City.getCitiesOfCountry('US')
    .map((city) => {
      if (!city || city.countryCode !== 'US' || !city.stateCode || !city.name) return null
      const stateName = statesByCode.get(city.stateCode)
      const latitude = Number(city.latitude)
      const longitude = Number(city.longitude)
      if (!stateName || Number.isNaN(latitude) || Number.isNaN(longitude)) return null
      const key = `${city.name}|${city.stateCode}|${latitude}|${longitude}`
      if (seen.has(key)) return null
      seen.add(key)
      return {
        key,
        city: city.name,
        stateCode: city.stateCode,
        stateName,
        label: buildLabel(city.name, stateName, city.stateCode),
        latitude,
        longitude,
      }
    })
    .filter(Boolean)

  return cachedUsLocations
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

export function searchLocations(query, limit = 8) {
  const q = normalize(query)
  const all = getUsLocations()
  if (!q) return all.slice(0, limit)

  return all
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
    .slice(0, limit)
    .map((entry) => entry.location)
}

export function getNearestLocation(latitude, longitude) {
  const lat = Number(latitude)
  const lon = Number(longitude)
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null

  let best = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const location of getUsLocations()) {
    const distanceMiles = haversineMiles(lat, lon, location.latitude, location.longitude)
    if (distanceMiles < bestDistance) {
      best = { ...location, distanceMiles: Number(distanceMiles.toFixed(2)) }
      bestDistance = distanceMiles
    }
  }
  return best
}
