import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_CSV_PATH = path.resolve(process.cwd(), 'opengolfapi-us.courses.042026.csv')

function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (char === '"' && next === '"') {
        value += '"'
        i += 1
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

    if (char === '\r') continue

    value += char
  }

  if (value.length || row.length) {
    row.push(value)
    rows.push(row)
  }

  return rows
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(golf|course|club|country|state|park|resort|at|the|municipal)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleCaseStateCode(value) {
  return String(value || '').trim().toUpperCase()
}

function loadCatalog() {
  const csvPath = path.resolve(process.env.GOLF_COURSE_CSV_PATH || DEFAULT_CSV_PATH)
  const csvText = fs.readFileSync(csvPath, 'utf8')
  const records = parseCsv(csvText)
  if (!records.length) return { byState: new Map(), namesByState: new Map(), rows: [] }

  const headers = records[0].map((header) => String(header || '').trim())
  const byState = new Map()
  const namesByState = new Map()
  const rows = []

  for (const values of records.slice(1)) {
    const row = {}
    headers.forEach((header, index) => {
      row[header] = values[index] ?? ''
    })

    const state = titleCaseStateCode(row.state)
    const name = String(row.name || '').trim()
    if (!state || !name) continue

    const entry = {
      id: String(row.id || '').trim() || `${state}:${name}`,
      state,
      name,
      city: String(row.city || '').trim() || null,
      type: String(row.type || '').trim() || null,
      holes: Number.parseInt(String(row.holes || '').trim(), 10) || null,
      par: Number.parseInt(String(row.par || '').trim(), 10) || null,
      website: String(row.website || '').trim() || null,
      normalizedName: normalizeName(name),
    }

    if (!byState.has(state)) byState.set(state, [])
    byState.get(state).push(entry)
    rows.push(entry)
  }

  for (const [state, entries] of byState.entries()) {
    const deduped = []
    const seen = new Set()
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name) || String(a.city || '').localeCompare(String(b.city || '')))) {
      const key = `${entry.name.toLowerCase()}::${String(entry.city || '').toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(entry)
    }
    byState.set(state, deduped)
    namesByState.set(state, deduped.map((entry) => entry.name))
  }

  return { byState, namesByState, rows }
}

let cache = null

function getCatalog() {
  if (!cache) cache = loadCatalog()
  return cache
}

export function listGolfCoursesByState(state) {
  const key = titleCaseStateCode(state)
  return [...(getCatalog().byState.get(key) || [])]
}

export function listGolfCourseNamesByState(state) {
  const key = titleCaseStateCode(state)
  return [...(getCatalog().namesByState.get(key) || [])]
}

export function isKnownGolfCourseForState(state, courseName) {
  return Boolean(findGolfCourseForState(state, courseName))
}

export function findGolfCourseForState(state, courseName) {
  const key = titleCaseStateCode(state)
  const rawName = String(courseName || '').trim()
  if (!key || !rawName) return null

  const entries = getCatalog().byState.get(key) || []
  const exact = entries.find((entry) => entry.name.toLowerCase() === rawName.toLowerCase())
  if (exact) return exact

  const normalized = normalizeName(rawName)
  if (!normalized) return null

  const normalizedExact = entries.find((entry) => entry.normalizedName === normalized)
  if (normalizedExact) return normalizedExact

  const partialMatches = entries.filter((entry) => entry.normalizedName.includes(normalized) || normalized.includes(entry.normalizedName))
  return partialMatches[0] || null
}

export function listStatesWithGolfCourses() {
  return [...getCatalog().byState.keys()].sort((a, b) => a.localeCompare(b))
}
