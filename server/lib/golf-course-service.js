import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { getPool } from '../db.js'
import { logApi, logError, logInfo } from './logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_CSV_PATH = path.resolve(__dirname, '../../opengolfapi-us.courses.042026.csv')

function csvPath() {
  return process.env.GOLF_COURSES_CSV_PATH
    ? path.resolve(process.env.GOLF_COURSES_CSV_PATH)
    : DEFAULT_CSV_PATH
}

function parseCsvLine(line) {
  const out = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === ',' && !inQuotes) {
      out.push(current)
      current = ''
      continue
    }
    current += char
  }
  out.push(current)
  return out
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase()
}

function cleanString(value) {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

function cleanNumber(value) {
  if (value == null || value === '') return null
  const normalized = String(value).trim().replace(/[^0-9.+-]/g, '')
  if (!normalized) return null
  const num = Number(normalized)
  return Number.isFinite(num) ? num : null
}

function cleanInteger(value) {
  const num = cleanNumber(value)
  return Number.isFinite(num) ? Math.trunc(num) : null
}

function cleanDateTime(value) {
  const trimmed = cleanString(value)
  if (!trimmed) return null
  const dt = new Date(trimmed)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString().slice(0, 19).replace('T', ' ')
}

function mapCourseRow(row) {
  return {
    id: cleanString(row.id),
    name: cleanString(row.name),
    normalizedName: normalizeName(row.name),
    country: cleanString(row.country) || 'US',
    state: String(row.state || '').trim().toUpperCase(),
    city: cleanString(row.city),
    courseType: cleanString(row.type),
    holesCount: cleanInteger(row.holes),
    parTotal: cleanInteger(row.par),
    latitude: cleanNumber(row.latitude),
    longitude: cleanNumber(row.longitude),
    phone: cleanString(row.phone),
    website: cleanString(row.website),
    yearBuilt: cleanInteger(row.year_built),
    address: cleanString(row.address),
    postalCode: cleanString(row.postal_code),
    architect: cleanString(row.architect),
    totalYardage: cleanInteger(row.total_yardage),
    osmId: cleanInteger(row.osm_id),
    sourceUpdatedAt: cleanDateTime(row.updated_at),
    holes: Array.from({ length: 18 }, (_, idx) => ({
      holeNumber: idx + 1,
      parValue: cleanInteger(row[`hole_${idx + 1}_par`]),
      handicapValue: cleanInteger(row[`hole_${idx + 1}_hcp`]),
    })).filter((entry) => entry.parValue != null || entry.handicapValue != null),
  }
}

export async function searchGolfCourses({ state, query, limit = 20 } = {}) {
  const db = getPool()
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100)
  const where = ['1 = 1']
  const params = []

  if (state) {
    where.push('state = ?')
    params.push(String(state).trim().toUpperCase())
  }

  const trimmedQuery = String(query || '').trim()
  if (trimmedQuery) {
    const like = `%${trimmedQuery}%`
    where.push('(name LIKE ? OR city LIKE ? OR state LIKE ? OR address LIKE ?)')
    params.push(like, like, like, like)
  }

  const [rows] = await db.execute(
    `SELECT id, name, state, city, course_type AS courseType, holes_count AS holesCount,
            par_total AS parTotal, latitude, longitude, address, postal_code AS postalCode,
            website, phone
       FROM golf_courses
      WHERE ${where.join(' AND ')}
      ORDER BY state ASC, city ASC, name ASC
      LIMIT ${safeLimit}`,
    params,
  )

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    state: row.state,
    city: row.city,
    courseType: row.courseType,
    holesCount: row.holesCount,
    parTotal: row.parTotal,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    address: row.address,
    postalCode: row.postalCode,
    website: row.website,
    phone: row.phone,
    label: [row.name, row.city, row.state].filter(Boolean).join(' — '),
  }))
}

export async function getGolfCourseByName({ state, name }) {
  const trimmedName = String(name || '').trim()
  if (!trimmedName) return null
  const db = getPool()
  const where = ['normalized_name = ?']
  const params = [normalizeName(trimmedName)]
  if (state) {
    where.push('state = ?')
    params.push(String(state).trim().toUpperCase())
  }
  const [rows] = await db.execute(
    `SELECT id, name, state, city, course_type AS courseType, holes_count AS holesCount,
            par_total AS parTotal, latitude, longitude, address, postal_code AS postalCode,
            website, phone
       FROM golf_courses
      WHERE ${where.join(' AND ')}
      ORDER BY state ASC, city ASC, name ASC
      LIMIT 1`,
    params,
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    city: row.city,
    courseType: row.courseType,
    holesCount: row.holesCount,
    parTotal: row.parTotal,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    address: row.address,
    postalCode: row.postalCode,
    website: row.website,
    phone: row.phone,
    label: [row.name, row.city, row.state].filter(Boolean).join(' — '),
  }
}

export async function importGolfCoursesFromCsv({ filePath = csvPath(), logger = console } = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Golf courses CSV not found at ${filePath}`)
  }

  const db = getPool()
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  const conn = await db.getConnection()
  let processed = 0
  let imported = 0
  let header = null

  try {
    await conn.beginTransaction()
    for await (const line of rl) {
      if (!header) {
        header = parseCsvLine(line)
        continue
      }
      if (!line.trim()) continue
      const values = parseCsvLine(line)
      const row = Object.fromEntries(header.map((key, index) => [key, values[index] ?? '']))
      const course = mapCourseRow(row)
      if (!course.id || !course.name || !course.state) continue

      await conn.execute(
        `INSERT INTO golf_courses (
          id, name, normalized_name, country, state, city, course_type, holes_count, par_total,
          latitude, longitude, phone, website, year_built, address, postal_code, architect,
          total_yardage, osm_id, source_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          normalized_name = VALUES(normalized_name),
          country = VALUES(country),
          state = VALUES(state),
          city = VALUES(city),
          course_type = VALUES(course_type),
          holes_count = VALUES(holes_count),
          par_total = VALUES(par_total),
          latitude = VALUES(latitude),
          longitude = VALUES(longitude),
          phone = VALUES(phone),
          website = VALUES(website),
          year_built = VALUES(year_built),
          address = VALUES(address),
          postal_code = VALUES(postal_code),
          architect = VALUES(architect),
          total_yardage = VALUES(total_yardage),
          osm_id = VALUES(osm_id),
          source_updated_at = VALUES(source_updated_at),
          updated_at = CURRENT_TIMESTAMP`,
        [
          course.id, course.name, course.normalizedName, course.country, course.state, course.city,
          course.courseType, course.holesCount, course.parTotal, course.latitude, course.longitude,
          course.phone, course.website, course.yearBuilt, course.address, course.postalCode,
          course.architect, course.totalYardage, course.osmId, course.sourceUpdatedAt,
        ],
      )

      await conn.execute('DELETE FROM golf_course_holes WHERE golf_course_id = ?', [course.id])
      for (const hole of course.holes) {
        await conn.execute(
          `INSERT INTO golf_course_holes (golf_course_id, hole_number, par_value, handicap_value)
           VALUES (?, ?, ?, ?)` ,
          [course.id, hole.holeNumber, hole.parValue, hole.handicapValue],
        )
      }

      processed += 1
      imported += 1
      if (processed % 500 === 0) logger.info?.(`[golf-courses:import] processed ${processed}`)
    }
    await conn.commit()
    logger.info?.(`[golf-courses:import] imported ${imported} courses from ${filePath}`)
    logInfo('Golf courses import completed', { filePath, imported })
    return { imported, filePath }
  } catch (error) {
    await conn.rollback()
    logError('Golf courses import failed', { filePath, processed, error })
    throw error
  } finally {
    conn.release()
    rl.close()
  }
}

export async function countGolfCourses() {
  const db = getPool()
  const [[row]] = await db.query('SELECT COUNT(*) AS total FROM golf_courses')
  return Number(row?.total || 0)
}

export async function golfCoursesHealth() {
  try {
    const total = await countGolfCourses()
    return { total, csvPath: csvPath(), csvPresent: fs.existsSync(csvPath()) }
  } catch (error) {
    logApi('golf_courses_health_failed', { error })
    return { total: 0, csvPath: csvPath(), csvPresent: fs.existsSync(csvPath()) }
  }
}
