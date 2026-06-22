import fs from 'node:fs'
import path from 'node:path'
import { City, State } from 'country-state-city'

const stateNameByCode = new Map(
  State.getStatesOfCountry('US')
    .filter((state) => state.isoCode && state.name)
    .map((state) => [state.isoCode, state.name]),
)

let usLocationsCache = null
let postalCodeMapCache = null
const DEFAULT_POSTAL_CODE_CSV_PATH = path.resolve(process.cwd(), 'opengolfapi-us.courses.042026.csv')

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function parseCsvRows(text) {
  const rows = []
  let row = []
  let value = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (inQuotes) {
      if (char === '"' && next === '"') {
        value += '"'
        index += 1
      } else if (char === '"') {
        inQuotes = false
      } else {
        value += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
      continue
    }
    if (char === ',') {
      row.push(value)
      value = ''
      continue
    }
    if (char === '\n') {
      row.push(value)
      rows.push(row)
      row = []
      value = ''
      continue
    }
    if (char !== '\r') value += char
  }

  if (value.length || row.length) {
    row.push(value)
    rows.push(row)
  }
  return rows
}

function postalCodeKey(city, stateCode) {
  return `${normalize(city).trim()}|${String(stateCode || '').trim().toUpperCase()}`
}

function getPostalCodeMap() {
  if (postalCodeMapCache) return postalCodeMapCache

  const pathFromEnv = process.env.LOCATION_POSTAL_CODE_CSV_PATH || process.env.GOLF_COURSE_CSV_PATH || DEFAULT_POSTAL_CODE_CSV_PATH
  const countsByCity = new Map()
  try {
    const csvText = fs.readFileSync(path.resolve(pathFromEnv), 'utf8')
    const rows = parseCsvRows(csvText)
    const headers = (rows[0] || []).map((header) => String(header || '').trim())
    const cityIndex = headers.indexOf('city')
    const stateIndex = headers.indexOf('state')
    const postalIndex = headers.indexOf('postal_code') >= 0 ? headers.indexOf('postal_code') : headers.indexOf('postalCode')
    if (cityIndex < 0 || stateIndex < 0 || postalIndex < 0) throw new Error('postal code CSV is missing city, state, or postal_code columns')

    for (const values of rows.slice(1)) {
      const city = String(values[cityIndex] || '').trim()
      const stateCode = String(values[stateIndex] || '').trim().toUpperCase()
      const postalCode = String(values[postalIndex] || '').trim()
      if (!city || !stateCode || !/^\d{5}(?:-\d{4})?$/.test(postalCode)) continue
      const key = postalCodeKey(city, stateCode)
      if (!countsByCity.has(key)) countsByCity.set(key, new Map())
      const counts = countsByCity.get(key)
      counts.set(postalCode, (counts.get(postalCode) || 0) + 1)
    }
  } catch {
    postalCodeMapCache = new Map()
    return postalCodeMapCache
  }

  postalCodeMapCache = new Map()
  for (const [key, counts] of countsByCity.entries()) {
    const postalCode = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || ''
    if (postalCode) postalCodeMapCache.set(key, postalCode)
  }
  return postalCodeMapCache
}

function getPostalCodeForCity(city, stateCode) {
  return getPostalCodeMap().get(postalCodeKey(city, stateCode)) || ''
}

function buildLabel(city, stateName, stateCode, postalCode = '') {
  const zipText = String(postalCode || '').trim()
  return zipText ? `${city}, ${stateCode} ${zipText} · ${stateName}` : `${city}, ${stateCode} · ${stateName}`
}

function toLocation(city) {
  if (city.countryCode !== 'US' || !city.stateCode || !city.name) return null
  const latitude = Number(city.latitude)
  const longitude = Number(city.longitude)
  const stateName = stateNameByCode.get(city.stateCode) || ''
  if (!stateName || Number.isNaN(latitude) || Number.isNaN(longitude)) return null

  const postalCode = getPostalCodeForCity(city.name, city.stateCode)

  return {
    key: `${city.name}|${city.stateCode}|${latitude}|${longitude}`,
    city: city.name,
    stateCode: city.stateCode,
    stateName,
    postalCode,
    label: buildLabel(city.name, stateName, city.stateCode, postalCode),
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

async function reverseGeocodePostalCode(latitude, longitude) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const url = new URL('https://nominatim.openstreetmap.org/reverse')
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('lat', String(latitude))
    url.searchParams.set('lon', String(longitude))
    url.searchParams.set('zoom', '18')
    url.searchParams.set('addressdetails', '1')

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Golf Homiez location lookup',
        'Accept-Language': 'en-US,en;q=0.8',
      },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!response.ok) return null
    const data = await response.json()
    const address = data && typeof data === 'object' ? data.address : null
    const postalCode = address && typeof address.postcode === 'string' ? address.postcode.trim() : ''
    return postalCode || null
  } catch {
    return null
  }
}

export async function getNearestLocation(latitude, longitude) {
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

  if (!best) return null

  const postalCode = await reverseGeocodePostalCode(latitude, longitude)
  return {
    ...best,
    postalCode: postalCode || best.postalCode || '',
    label: buildLabel(best.city, best.stateName, best.stateCode, postalCode || best.postalCode || ''),
  }
}
