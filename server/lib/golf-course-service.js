import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPool } from '../db.js'
import { logError, logInfo } from './logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_CSV_PATH = path.resolve(__dirname, '../../opengolfapi-us.courses.042026.csv')

const US_STATE_NAME_TO_CODE = new Map([
  ['ALABAMA', 'AL'], ['ALASKA', 'AK'], ['ARIZONA', 'AZ'], ['ARKANSAS', 'AR'], ['CALIFORNIA', 'CA'],
  ['COLORADO', 'CO'], ['CONNECTICUT', 'CT'], ['DELAWARE', 'DE'], ['FLORIDA', 'FL'], ['GEORGIA', 'GA'],
  ['HAWAII', 'HI'], ['IDAHO', 'ID'], ['ILLINOIS', 'IL'], ['INDIANA', 'IN'], ['IOWA', 'IA'],
  ['KANSAS', 'KS'], ['KENTUCKY', 'KY'], ['LOUISIANA', 'LA'], ['MAINE', 'ME'], ['MARYLAND', 'MD'],
  ['MASSACHUSETTS', 'MA'], ['MICHIGAN', 'MI'], ['MINNESOTA', 'MN'], ['MISSISSIPPI', 'MS'], ['MISSOURI', 'MO'],
  ['MONTANA', 'MT'], ['NEBRASKA', 'NE'], ['NEVADA', 'NV'], ['NEW HAMPSHIRE', 'NH'], ['NEW JERSEY', 'NJ'],
  ['NEW MEXICO', 'NM'], ['NEW YORK', 'NY'], ['NORTH CAROLINA', 'NC'], ['NORTH DAKOTA', 'ND'], ['OHIO', 'OH'],
  ['OKLAHOMA', 'OK'], ['OREGON', 'OR'], ['PENNSYLVANIA', 'PA'], ['RHODE ISLAND', 'RI'], ['SOUTH CAROLINA', 'SC'],
  ['SOUTH DAKOTA', 'SD'], ['TENNESSEE', 'TN'], ['TEXAS', 'TX'], ['UTAH', 'UT'], ['VERMONT', 'VT'],
  ['VIRGINIA', 'VA'], ['WASHINGTON', 'WA'], ['WEST VIRGINIA', 'WV'], ['WISCONSIN', 'WI'], ['WYOMING', 'WY'],
  ['DISTRICT OF COLUMBIA', 'DC'],
])

let csvCache = null
let csvCachePath = null
let schemaCache = null

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeStateCode(state) {
  const value = normalizeWhitespace(state).toUpperCase()
  if (!value) return ''
  if (value.length <= 3) return value
  return US_STATE_NAME_TO_CODE.get(value) || value
}

function normalizeCourseName(name) {
  return normalizeWhitespace(name)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’.]/g, '')
    .replace(/\b(country club|golf club|golf course|golf resort|resort golf course|club at|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseCsvLine(line) {
  const values = []
  let current = ''
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
    } else {
      current += char
    }
  }
  values.push(current)
  return values.map((value) => value.trim())
}

function mapCsvRow(headers, rawValues) {
  const row = {}
  headers.forEach((header, index) => {
    row[header] = rawValues[index] ?? ''
  })
  return row
}

function inferField(row, candidates) {
  for (const candidate of candidates) {
    const exact = row[candidate]
    if (exact != null && String(exact).trim()) return String(exact).trim()
    const lowerCandidate = candidate.toLowerCase()
    const key = Object.keys(row).find((entry) => entry.toLowerCase() === lowerCandidate)
    if (key && String(row[key]).trim()) return String(row[key]).trim()
  }
  return ''
}

function mapCourseRecord(row, rowIndex) {
  const rawState = inferField(row, ['state_code', 'state', 'province', 'region'])
  const stateCode = normalizeStateCode(rawState)
  const stateName = normalizeWhitespace(rawState)
  const name = normalizeWhitespace(inferField(row, ['name', 'course_name', 'golf_course_name']))
  const city = normalizeWhitespace(inferField(row, ['city', 'municipality']))
  const address = normalizeWhitespace(inferField(row, ['address', 'street', 'street_address']))
  const postalCode = normalizeWhitespace(inferField(row, ['postal_code', 'zip', 'zip_code']))
  const country = normalizeWhitespace(inferField(row, ['country'])) || 'US'
  const idSource = normalizeWhitespace(inferField(row, ['id', 'course_id', 'uuid', 'slug']))
  const id = idSource || `${stateCode || 'NA'}-${normalizeCourseName(name) || `row-${rowIndex + 1}`}`

  return {
    id,
    name,
    normalized_name: normalizeCourseName(name),
    country,
    state: stateName || stateCode,
    state_code: stateCode || stateName,
    city,
    address,
    postal_code: postalCode,
  }
}

async function loadCsvCourses(csvPath = process.env.GOLF_COURSES_CSV_PATH || DEFAULT_CSV_PATH) {
  if (csvCache && csvCachePath === csvPath) return csvCache
  const content = await fs.readFile(csvPath, 'utf8')
  const lines = content.split(/\r?\n/).filter((line) => line.trim())
  if (!lines.length) {
    csvCache = []
    csvCachePath = csvPath
    return csvCache
  }

  const headers = parseCsvLine(lines[0]).map((header) => normalizeWhitespace(header))
  const courses = []
  for (let index = 1; index < lines.length; index += 1) {
    const values = parseCsvLine(lines[index])
    const row = mapCsvRow(headers, values)
    const course = mapCourseRecord(row, index)
    if (!course.name) continue
    courses.push(course)
  }

  csvCache = courses
  csvCachePath = csvPath
  return courses
}

async function getGolfCoursesTableSchema() {
  if (schemaCache) return schemaCache
  const pool = getPool()
  try {
    const [tables] = await pool.query("SHOW TABLES LIKE 'golf_courses'")
    if (!Array.isArray(tables) || tables.length === 0) {
      schemaCache = { exists: false, columns: new Set() }
      return schemaCache
    }
    const [columns] = await pool.query('SHOW COLUMNS FROM golf_courses')
    schemaCache = {
      exists: true,
      columns: new Set(columns.map((column) => String(column.Field))),
    }
    return schemaCache
  } catch (error) {
    logError('Unable to inspect golf_courses schema', { error })
    schemaCache = { exists: false, columns: new Set() }
    return schemaCache
  }
}

async function ensureGolfCoursesTable() {
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS golf_courses (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      normalized_name VARCHAR(191) NOT NULL,
      country VARCHAR(64) NULL,
      state VARCHAR(64) NOT NULL,
      state_code VARCHAR(8) NULL,
      city VARCHAR(191) NULL,
      address VARCHAR(255) NULL,
      postal_code VARCHAR(32) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_golf_courses_state (state),
      INDEX idx_golf_courses_state_code (state_code),
      INDEX idx_golf_courses_normalized_name (normalized_name)
    )
  `)
  schemaCache = null
  return getGolfCoursesTableSchema()
}

function matchesState(course, state) {
  const requested = normalizeStateCode(state)
  const courseStateCode = normalizeStateCode(course.state_code || course.state)
  const courseStateText = normalizeWhitespace(course.state).toUpperCase()
  return !requested || requested === courseStateCode || requested === courseStateText
}

async function listCoursesFromDatabase(state) {
  const schema = await getGolfCoursesTableSchema()
  if (!schema.exists) return null

  const columns = schema.columns
  const pool = getPool()
  const requestedStateCode = normalizeStateCode(state)
  const predicates = []
  const params = []

  if (requestedStateCode) {
    if (columns.has('state_code')) {
      predicates.push('UPPER(COALESCE(state_code, "")) = ?')
      params.push(requestedStateCode)
    }
    if (columns.has('state')) {
      predicates.push('UPPER(COALESCE(state, "")) = ?')
      params.push(requestedStateCode)
      const stateName = [...US_STATE_NAME_TO_CODE.entries()].find(([, code]) => code === requestedStateCode)?.[0]
      if (stateName) {
        predicates.push('UPPER(COALESCE(state, "")) = ?')
        params.push(stateName)
      }
    }
  }

  const whereClause = predicates.length ? `WHERE ${predicates.join(' OR ')}` : ''
  const [rows] = await pool.execute(
    `SELECT id, name, normalized_name, country, state${columns.has('state_code') ? ', state_code' : ', NULL AS state_code'}, city${columns.has('address') ? ', address' : ', NULL AS address'}${columns.has('postal_code') ? ', postal_code' : ', NULL AS postal_code'}
       FROM golf_courses
       ${whereClause}
      ORDER BY name ASC`,
    params,
  )

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    normalized_name: row.normalized_name || normalizeCourseName(row.name),
    country: row.country || 'US',
    state: row.state,
    state_code: row.state_code || normalizeStateCode(row.state),
    city: row.city || null,
    address: row.address || null,
    postal_code: row.postal_code || null,
  }))
}

export async function listGolfCoursesForState(state) {
  const dbCourses = await listCoursesFromDatabase(state)
  if (Array.isArray(dbCourses) && dbCourses.length) return dbCourses
  const csvCourses = await loadCsvCourses()
  return csvCourses.filter((course) => matchesState(course, state)).sort((left, right) => left.name.localeCompare(right.name))
}

export async function listGolfCourseNamesByState(state) {
  const courses = await listGolfCoursesForState(state)
  return courses.map((course) => course.name)
}

export async function resolveGolfCourseForState(state, courseName) {
  const normalizedTarget = normalizeCourseName(courseName)
  if (!normalizedTarget) return null
  const courses = await listGolfCoursesForState(state)
  return courses.find((course) => normalizeCourseName(course.name) === normalizedTarget || normalizeCourseName(course.normalized_name) === normalizedTarget) || null
}

export async function findGolfCourseForState(state, courseName) {
  return resolveGolfCourseForState(state, courseName)
}

export async function getGolfCourseByName(courseName, state = '') {
  const normalizedTarget = normalizeCourseName(courseName)
  if (!normalizedTarget) return null

  if (state) {
    return resolveGolfCourseForState(state, courseName)
  }

  const schema = await getGolfCoursesTableSchema()
  if (schema.exists) {
    const pool = getPool()
    const [rows] = await pool.execute(
      `SELECT id, name, normalized_name, country, state${schema.columns.has('state_code') ? ', state_code' : ', NULL AS state_code'}, city${schema.columns.has('address') ? ', address' : ', NULL AS address'}${schema.columns.has('postal_code') ? ', postal_code' : ', NULL AS postal_code'}
         FROM golf_courses
        WHERE normalized_name = ? OR LOWER(name) = LOWER(?)
        ORDER BY name ASC
        LIMIT 1`,
      [normalizedTarget, normalizeWhitespace(courseName)],
    )
    if (Array.isArray(rows) && rows.length) {
      const row = rows[0]
      return {
        id: row.id,
        name: row.name,
        normalized_name: row.normalized_name || normalizeCourseName(row.name),
        country: row.country || 'US',
        state: row.state,
        state_code: row.state_code || normalizeStateCode(row.state),
        city: row.city || null,
        address: row.address || null,
        postal_code: row.postal_code || null,
      }
    }
  }

  const csvCourses = await loadCsvCourses()
  return csvCourses.find((course) => normalizeCourseName(course.name) === normalizedTarget) || null
}

export async function importGolfCoursesFromCsv(csvPath = process.env.GOLF_COURSES_CSV_PATH || DEFAULT_CSV_PATH) {
  const courses = await loadCsvCourses(csvPath)
  const schema = await ensureGolfCoursesTable()
  const columns = schema.columns
  const pool = getPool()

  const insertColumns = ['id', 'name', 'normalized_name', 'country', 'state']
  if (columns.has('state_code')) insertColumns.push('state_code')
  if (columns.has('city')) insertColumns.push('city')
  if (columns.has('address')) insertColumns.push('address')
  if (columns.has('postal_code')) insertColumns.push('postal_code')
  const placeholders = insertColumns.map(() => '?').join(', ')
  const updateAssignments = insertColumns
    .filter((column) => column !== 'id')
    .map((column) => `${column} = VALUES(${column})`)
    .join(', ')

  const sql = `INSERT INTO golf_courses (${insertColumns.join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateAssignments}`
  let imported = 0
  for (const course of courses) {
    const values = insertColumns.map((column) => {
      if (column === 'state' && !columns.has('state_code')) return course.state_code || course.state
      return course[column] ?? null
    })
    await pool.execute(sql, values)
    imported += 1
  }
  logInfo('Golf courses import completed', { imported, csvPath })
  return { imported, csvPath }
}

export function __resetGolfCourseServiceCachesForTests() {
  csvCache = null
  csvCachePath = null
  schemaCache = null
}
