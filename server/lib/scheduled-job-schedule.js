import { getMountainTimeParts, mountainLocalTimeToUtc } from './cancelled-tournament-cleanup.js'

export const SCHEDULE_TYPES = new Set(['manual', 'daily', 'weekly', 'monthly'])
export const DEFAULT_SCHEDULE_TIME_ZONE = 'America/Denver'

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function integer(value, fallback = null) {
  if (value === '' || value == null) return fallback
  const parsed = Number.parseInt(String(value), 10)
  return Number.isInteger(parsed) ? parsed : fallback
}

function normalizeTime(value, fallback = '00:00') {
  const raw = String(value || fallback).trim()
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match) throw new Error('Schedule time must use HH:MM format')
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error('Schedule time is invalid')
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function normalizeScheduleConfig(input = {}, fallback = { type: 'manual' }) {
  const fallbackType = SCHEDULE_TYPES.has(String(fallback?.type || '').toLowerCase()) ? String(fallback.type).toLowerCase() : 'manual'
  const type = String(input?.type ?? fallbackType).trim().toLowerCase()
  if (!SCHEDULE_TYPES.has(type)) throw new Error('Schedule must be Manual, Daily, Weekly, or Monthly')

  if (type === 'manual') {
    return { type: 'manual', time: null, dayOfWeek: null, dayOfMonth: null }
  }

  const time = normalizeTime(input?.time ?? fallback?.time ?? '00:00')
  if (type === 'daily') return { type, time, dayOfWeek: null, dayOfMonth: null }

  if (type === 'weekly') {
    const dayOfWeek = integer(input?.dayOfWeek, integer(fallback?.dayOfWeek, 0))
    if (dayOfWeek == null || dayOfWeek < 0 || dayOfWeek > 6) throw new Error('Weekly schedule day must be between Sunday and Saturday')
    return { type, time, dayOfWeek, dayOfMonth: null }
  }

  const dayOfMonth = integer(input?.dayOfMonth, integer(fallback?.dayOfMonth, 1))
  if (dayOfMonth == null || dayOfMonth < 1 || dayOfMonth > 31) throw new Error('Monthly schedule day must be between 1 and 31')
  return { type, time, dayOfWeek: null, dayOfMonth }
}

export function scheduleLabel(schedule) {
  const normalized = normalizeScheduleConfig(schedule)
  if (normalized.type === 'manual') return 'Manual'
  if (normalized.type === 'daily') return `Daily ${normalized.time}`
  if (normalized.type === 'weekly') return `Weekly ${WEEKDAY_LABELS[normalized.dayOfWeek]} ${normalized.time}`
  return `Monthly day ${normalized.dayOfMonth} ${normalized.time}`
}

function parseTime(time) {
  const [hour, minute] = String(time || '00:00').split(':').map(Number)
  return { hour, minute }
}

function localDateFromParts(parts, dayOffset = 0) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset, 12, 0, 0))
}

function localMomentHasPassed(parts, hour, minute) {
  return parts.hour > hour ||
    (parts.hour === hour && parts.minute > minute) ||
    (parts.hour === hour && parts.minute === minute && parts.second > 0)
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate()
}

export function nextRunForSchedule(scheduleInput, now = new Date(), timeZone = DEFAULT_SCHEDULE_TIME_ZONE) {
  const schedule = normalizeScheduleConfig(scheduleInput)
  if (schedule.type === 'manual') return null

  const local = getMountainTimeParts(now, timeZone)
  const { hour, minute } = parseTime(schedule.time)

  if (schedule.type === 'daily') {
    const offset = localMomentHasPassed(local, hour, minute) ? 1 : 0
    const target = localDateFromParts(local, offset)
    return mountainLocalTimeToUtc(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), hour, minute, 0, timeZone)
  }

  if (schedule.type === 'weekly') {
    let dayOffset = (7 + schedule.dayOfWeek - local.weekday) % 7
    if (dayOffset === 0 && localMomentHasPassed(local, hour, minute)) dayOffset = 7
    const target = localDateFromParts(local, dayOffset)
    return mountainLocalTimeToUtc(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), hour, minute, 0, timeZone)
  }

  const maxCurrentDay = daysInMonth(local.year, local.month)
  const currentTargetDay = Math.min(schedule.dayOfMonth, maxCurrentDay)
  const shouldUseNextMonth = local.day > currentTargetDay || (local.day === currentTargetDay && localMomentHasPassed(local, hour, minute))
  let year = local.year
  let month = local.month
  if (shouldUseNextMonth) {
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  const targetDay = Math.min(schedule.dayOfMonth, daysInMonth(year, month))
  return mountainLocalTimeToUtc(year, month, targetDay, hour, minute, 0, timeZone)
}

export function databaseScheduleFromRow(row = {}, fallback = { type: 'manual' }) {
  return normalizeScheduleConfig({
    type: row.schedule_type ?? fallback?.type,
    time: row.schedule_time ?? fallback?.time,
    dayOfWeek: row.schedule_day_of_week ?? fallback?.dayOfWeek,
    dayOfMonth: row.schedule_day_of_month ?? fallback?.dayOfMonth,
  }, fallback)
}

export function scheduleDatabaseValues(scheduleInput) {
  const schedule = normalizeScheduleConfig(scheduleInput)
  return {
    schedule,
    type: schedule.type,
    time: schedule.time ? `${schedule.time}:00` : null,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    label: scheduleLabel(schedule),
  }
}
