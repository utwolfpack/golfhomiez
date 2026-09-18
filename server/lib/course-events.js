import crypto from 'node:crypto'

const MAX_TITLE_LENGTH = 191
const MAX_DETAILS_LENGTH = 5000
const MAX_EXPANDED_OCCURRENCES = 5000
const RECURRENCE_CADENCES = new Set(['none', 'daily', 'weekly', 'monthly', 'yearly'])

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

function normalizeRecurrenceCadence(value) {
  const normalized = String(value ?? 'none').trim().toLowerCase() || 'none'
  if (!RECURRENCE_CADENCES.has(normalized)) throw new Error('Event recurrence cadence is invalid.')
  return normalized
}

function dateParts(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number)
  return { year, month, day }
}

function formatDateKey(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function addUtcDays(dateKey, days) {
  const { year, month, day } = dateParts(dateKey)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return formatDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function recurringDateKeys(startDate, endDate, cadence) {
  if (cadence === 'none' || !endDate || endDate <= startDate) return [startDate]
  const dates = []
  if (cadence === 'daily' || cadence === 'weekly') {
    const increment = cadence === 'daily' ? 1 : 7
    for (let current = startDate; current <= endDate && dates.length < MAX_EXPANDED_OCCURRENCES; current = addUtcDays(current, increment)) {
      dates.push(current)
    }
    return dates
  }

  const start = dateParts(startDate)
  if (cadence === 'monthly') {
    let monthOffset = 0
    while (dates.length < MAX_EXPANDED_OCCURRENCES) {
      const absoluteMonth = (start.month - 1) + monthOffset
      const year = start.year + Math.floor(absoluteMonth / 12)
      const month = (absoluteMonth % 12) + 1
      if (start.day <= daysInMonth(year, month)) {
        const key = formatDateKey(year, month, start.day)
        if (key > endDate) break
        dates.push(key)
      } else {
        const firstOfMonth = formatDateKey(year, month, 1)
        if (firstOfMonth > endDate) break
      }
      monthOffset += 1
    }
    return dates
  }

  if (cadence === 'yearly') {
    let yearOffset = 0
    while (dates.length < MAX_EXPANDED_OCCURRENCES) {
      const year = start.year + yearOffset
      if (start.day <= daysInMonth(year, start.month)) {
        const key = formatDateKey(year, start.month, start.day)
        if (key > endDate) break
        dates.push(key)
      } else if (formatDateKey(year, start.month, 1) > endDate) {
        break
      }
      yearOffset += 1
    }
  }
  return dates.length ? dates : [startDate]
}

export function sanitizeCourseEventInput(input = {}) {
  const title = cleanText(input.title, MAX_TITLE_LENGTH)
  const eventDate = normalizeDate(input.eventDate ?? input.event_date)
  const rawStartTime = String(input.startTime ?? input.start_time ?? '').trim()
  const rawEndTime = String(input.endTime ?? input.end_time ?? '').trim()
  const startTime = normalizeTime(rawStartTime)
  const endTime = normalizeTime(rawEndTime)
  const details = cleanText(input.details ?? input.miscInfo ?? input.misc_info, MAX_DETAILS_LENGTH)
  const recurrenceCadence = normalizeRecurrenceCadence(input.recurrenceCadence ?? input.recurrence_cadence)
  const rawRecurrenceEndDate = String(input.recurrenceEndDate ?? input.recurrence_end_date ?? '').trim()
  const recurrenceEndDate = recurrenceCadence === 'none' ? null : normalizeDate(rawRecurrenceEndDate)

  if (!title) throw new Error('Event name is required.')
  if (!eventDate) throw new Error('Event date is required and must be a valid calendar date.')
  if (rawStartTime && !startTime) throw new Error('Event start time is invalid.')
  if (rawEndTime && !endTime) throw new Error('Event end time is invalid.')
  if (startTime && endTime && endTime < startTime) throw new Error('Event end time cannot be before the start time.')
  if (recurrenceCadence !== 'none' && !recurrenceEndDate) throw new Error('Recurring events require a valid repeat-through date.')
  if (recurrenceEndDate && recurrenceEndDate < eventDate) throw new Error('Repeat-through date cannot be before the event date.')

  return { title, eventDate, startTime, endTime, details, recurrenceCadence, recurrenceEndDate }
}

export function mapCourseEvent(row) {
  if (!row) return null
  const time = (value) => value == null ? null : String(value).slice(0, 5)
  const date = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : (value == null ? null : String(value).slice(0, 10))
  const recurrenceCadence = RECURRENCE_CADENCES.has(String(row.recurrence_cadence || '').toLowerCase()) ? String(row.recurrence_cadence).toLowerCase() : 'none'
  return {
    id: row.id,
    sourceEventId: row.source_event_id || row.id,
    golfCoursePublicPageId: row.golf_course_public_page_id,
    title: row.title,
    eventDate: date(row.event_date),
    startTime: time(row.start_time),
    endTime: time(row.end_time),
    details: row.details || null,
    recurrenceCadence,
    recurrenceEndDate: date(row.recurrence_end_date),
    isRecurring: recurrenceCadence !== 'none',
    isOccurrence: Boolean(row.is_occurrence),
    isPublic: Boolean(row.is_public),
    createdByHostAccountId: row.created_by_host_account_id || null,
    correlationId: row.correlation_id || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

export function expandRecurringCourseEvents(events = [], options = {}) {
  const limit = Math.min(MAX_EXPANDED_OCCURRENCES, Math.max(1, Number(options.limit) || MAX_EXPANDED_OCCURRENCES))
  const expanded = []
  for (const event of events || []) {
    if (!event || expanded.length >= limit) break
    const cadence = RECURRENCE_CADENCES.has(String(event.recurrenceCadence || '').toLowerCase()) ? String(event.recurrenceCadence).toLowerCase() : 'none'
    const endDate = event.recurrenceEndDate || event.eventDate
    const dates = recurringDateKeys(event.eventDate, endDate, cadence)
    for (const occurrenceDate of dates) {
      if (expanded.length >= limit) break
      expanded.push(cadence === 'none'
        ? event
        : {
            ...event,
            id: `${event.id}::${occurrenceDate}`,
            sourceEventId: event.id,
            eventDate: occurrenceDate,
            isRecurring: true,
            isOccurrence: true,
          })
    }
  }
  return expanded.sort((left, right) => {
    const dateCompare = String(left.eventDate || '').localeCompare(String(right.eventDate || ''))
    if (dateCompare) return dateCompare
    const timeCompare = String(left.startTime || '99:99').localeCompare(String(right.startTime || '99:99'))
    return timeCompare || String(left.title || '').localeCompare(String(right.title || ''))
  })
}

export async function listCourseEventsForPage(db, golfCoursePublicPageId, options = {}) {
  const publicOnly = options.publicOnly !== false
  const upcomingOnly = Boolean(options.upcomingOnly)
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 250))
  const conditions = ['golf_course_public_page_id = ?']
  const params = [golfCoursePublicPageId]
  if (publicOnly) conditions.push('is_public = 1')
  if (upcomingOnly) conditions.push(`(
    event_date >= CURRENT_DATE
    OR (recurrence_cadence <> 'none' AND recurrence_end_date >= CURRENT_DATE)
  )`)
  const [rows] = await db.execute(
    `SELECT id, golf_course_public_page_id, title, event_date, start_time, end_time, details,
            recurrence_cadence, recurrence_end_date, is_public,
            created_by_host_account_id, correlation_id, created_at, updated_at
       FROM golf_course_events
      WHERE ${conditions.join(' AND ')}
      ORDER BY event_date ASC, CASE WHEN start_time IS NULL THEN 1 ELSE 0 END, start_time ASC, title ASC
      LIMIT ${limit}`,
    params,
  )
  const events = (rows || []).map(mapCourseEvent)
  return options.expandRecurring ? expandRecurringCourseEvents(events, { limit: options.expandedLimit || MAX_EXPANDED_OCCURRENCES }) : events
}

export async function createCourseEvent(db, { golfCoursePublicPageId, hostAccountId, correlationId, input }) {
  const normalized = sanitizeCourseEventInput(input)
  const id = crypto.randomUUID()
  await db.execute(
    `INSERT INTO golf_course_events (
       id, golf_course_public_page_id, title, event_date, start_time, end_time, details,
       recurrence_cadence, recurrence_end_date, is_public, created_by_host_account_id, correlation_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      id,
      golfCoursePublicPageId,
      normalized.title,
      normalized.eventDate,
      normalized.startTime,
      normalized.endTime,
      normalized.details,
      normalized.recurrenceCadence,
      normalized.recurrenceEndDate,
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
        SET title = ?, event_date = ?, start_time = ?, end_time = ?, details = ?,
            recurrence_cadence = ?, recurrence_end_date = ?, is_public = 1,
            correlation_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND golf_course_public_page_id = ?`,
    [normalized.title, normalized.eventDate, normalized.startTime, normalized.endTime, normalized.details, normalized.recurrenceCadence, normalized.recurrenceEndDate, correlationId || null, id, golfCoursePublicPageId],
  )
  if (!Number(result?.affectedRows || 0)) return null
  const [rows] = await db.execute('SELECT * FROM golf_course_events WHERE id = ? AND golf_course_public_page_id = ? LIMIT 1', [id, golfCoursePublicPageId])
  return mapCourseEvent(rows?.[0])
}

export async function deleteCourseEvent(db, { id, golfCoursePublicPageId }) {
  const [result] = await db.execute('DELETE FROM golf_course_events WHERE id = ? AND golf_course_public_page_id = ?', [id, golfCoursePublicPageId])
  return Number(result?.affectedRows || 0) > 0
}
