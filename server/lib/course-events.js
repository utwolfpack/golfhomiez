import crypto from 'node:crypto'

const MAX_TITLE_LENGTH = 191
const MAX_DETAILS_LENGTH = 5000

function cleanText(value, maxLength) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  return normalized.slice(0, maxLength)
}

function normalizeDate(value) {
  const normalized = String(value ?? '').trim().slice(0, 10)
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return normalized
}

function normalizeTime(value) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  const match = normalized.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function sanitizeCourseEventInput(input = {}) {
  const title = cleanText(input.title, MAX_TITLE_LENGTH)
  const eventDate = normalizeDate(input.eventDate ?? input.event_date)
  const rawStartTime = String(input.startTime ?? input.start_time ?? '').trim()
  const rawEndTime = String(input.endTime ?? input.end_time ?? '').trim()
  const startTime = normalizeTime(rawStartTime)
  const endTime = normalizeTime(rawEndTime)
  const details = cleanText(input.details ?? input.miscInfo ?? input.misc_info, MAX_DETAILS_LENGTH)

  if (!title) throw new Error('Event name is required.')
  if (!eventDate) throw new Error('Event date is required and must be a valid calendar date.')
  if (rawStartTime && !startTime) throw new Error('Event start time is invalid.')
  if (rawEndTime && !endTime) throw new Error('Event end time is invalid.')
  if (startTime && endTime && endTime < startTime) throw new Error('Event end time cannot be before the start time.')

  return { title, eventDate, startTime, endTime, details }
}

export function mapCourseEvent(row) {
  if (!row) return null
  const time = (value) => value == null ? null : String(value).slice(0, 5)
  return {
    id: row.id,
    golfCoursePublicPageId: row.golf_course_public_page_id,
    title: row.title,
    eventDate: row.event_date instanceof Date ? row.event_date.toISOString().slice(0, 10) : String(row.event_date || '').slice(0, 10),
    startTime: time(row.start_time),
    endTime: time(row.end_time),
    details: row.details || null,
    isPublic: Boolean(row.is_public),
    createdByHostAccountId: row.created_by_host_account_id || null,
    correlationId: row.correlation_id || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

export async function listCourseEventsForPage(db, golfCoursePublicPageId, options = {}) {
  const publicOnly = options.publicOnly !== false
  const upcomingOnly = Boolean(options.upcomingOnly)
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 250))
  const conditions = ['golf_course_public_page_id = ?']
  const params = [golfCoursePublicPageId]
  if (publicOnly) conditions.push('is_public = 1')
  if (upcomingOnly) conditions.push('event_date >= CURRENT_DATE')
  const [rows] = await db.execute(
    `SELECT id, golf_course_public_page_id, title, event_date, start_time, end_time, details, is_public,
            created_by_host_account_id, correlation_id, created_at, updated_at
       FROM golf_course_events
      WHERE ${conditions.join(' AND ')}
      ORDER BY event_date ASC, CASE WHEN start_time IS NULL THEN 1 ELSE 0 END, start_time ASC, title ASC
      LIMIT ${limit}`,
    params,
  )
  return (rows || []).map(mapCourseEvent)
}

export async function createCourseEvent(db, { golfCoursePublicPageId, hostAccountId, correlationId, input }) {
  const normalized = sanitizeCourseEventInput(input)
  const id = crypto.randomUUID()
  await db.execute(
    `INSERT INTO golf_course_events (
       id, golf_course_public_page_id, title, event_date, start_time, end_time, details,
       is_public, created_by_host_account_id, correlation_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      id,
      golfCoursePublicPageId,
      normalized.title,
      normalized.eventDate,
      normalized.startTime,
      normalized.endTime,
      normalized.details,
      hostAccountId || null,
      correlationId || null,
    ],
  )
  const [rows] = await db.execute('SELECT * FROM golf_course_events WHERE id = ? AND golf_course_public_page_id = ? LIMIT 1', [id, golfCoursePublicPageId])
  return mapCourseEvent(rows?.[0])
}

export async function updateCourseEvent(db, { id, golfCoursePublicPageId, correlationId, input }) {
  const normalized = sanitizeCourseEventInput(input)
  const [result] = await db.execute(
    `UPDATE golf_course_events
        SET title = ?, event_date = ?, start_time = ?, end_time = ?, details = ?, is_public = 1,
            correlation_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND golf_course_public_page_id = ?`,
    [normalized.title, normalized.eventDate, normalized.startTime, normalized.endTime, normalized.details, correlationId || null, id, golfCoursePublicPageId],
  )
  if (!Number(result?.affectedRows || 0)) return null
  const [rows] = await db.execute('SELECT * FROM golf_course_events WHERE id = ? AND golf_course_public_page_id = ? LIMIT 1', [id, golfCoursePublicPageId])
  return mapCourseEvent(rows?.[0])
}

export async function deleteCourseEvent(db, { id, golfCoursePublicPageId }) {
  const [result] = await db.execute('DELETE FROM golf_course_events WHERE id = ? AND golf_course_public_page_id = ?', [id, golfCoursePublicPageId])
  return Number(result?.affectedRows || 0) > 0
}
