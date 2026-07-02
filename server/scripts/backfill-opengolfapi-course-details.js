import 'dotenv/config'
import { pathToFileURL } from 'url'
import { getPool, closeDb } from '../db.js'
import { fetchOpenGolfApiCourseHoles, fetchOpenGolfApiCourseTees } from '../lib/opengolfapi-client.js'
import { ensureOpenGolfCourseHoleEndpointSchema, refreshOpenGolfCourseEndpointDetails } from '../lib/golf-course-service.js'
import { logApi, logError, logInfo } from '../lib/logger.js'

// Usage flags include --course-id=<id>, --max-courses=<n>, --offset=<n>, --missing-only, --dry-run, and --stop-on-error.
function optionValue(name, fallback = '') {
  const prefix = `--${name}=`
  const found = process.argv.find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length).trim() : fallback
}

function flagEnabled(name) {
  return process.argv.includes(`--${name}`)
}

function positiveIntegerOption(name, fallback = 0) {
  return Math.max(0, Math.trunc(Number(optionValue(name, String(fallback))) || 0))
}

function sleep(ms) {
  const waitMs = Math.max(0, Math.trunc(Number(ms) || 0))
  if (waitMs <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, waitMs))
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function buildCourseTargetQuery({ courseId = '', offset = 0, limit = 0, missingOnly = false } = {}) {
  const params = []
  const filters = ["source = 'opengolfapi'", 'active = 1']
  const normalizedCourseId = normalizeText(courseId)
  if (normalizedCourseId) {
    filters.push('(id = ? OR external_course_id = ?)')
    params.push(normalizedCourseId, normalizedCourseId)
  }
  if (missingOnly) {
    filters.push(`(
      total_yardage IS NULL
      OR course_rating IS NULL
      OR slope_rating IS NULL
      OR NOT EXISTS (
        SELECT 1
          FROM golf_course_holes h
         WHERE h.course_id = golf_courses.id
           AND h.source = 'opengolfapi'
         LIMIT 1
      )
    )`)
  }
  const limitSql = limit > 0 ? ` LIMIT ${limit}` : (offset > 0 ? ' LIMIT 18446744073709551615' : '')
  const offsetSql = offset > 0 ? ` OFFSET ${offset}` : ''
  return {
    sql: `SELECT id, external_course_id, name, state_code
            FROM golf_courses
           WHERE ${filters.join(' AND ')}
           ORDER BY state_code ASC, name ASC, id ASC${limitSql}${offsetSql}`,
    params,
  }
}

export async function listOpenGolfApiCourseTargets(db, options = {}) {
  const query = buildCourseTargetQuery({ ...options, limit: options.limit || options.maxCourses || 0 })
  const [rows] = await db.execute(query.sql, query.params)
  return rows
}

async function refreshCourse(course, { db, dryRun = false } = {}) {
  const courseApiId = normalizeText(course.external_course_id || course.id)
  if (!courseApiId) throw new Error('OpenGolfAPI course id is required')
  const holesPayload = await fetchOpenGolfApiCourseHoles(courseApiId)
  const teesPayload = await fetchOpenGolfApiCourseTees(courseApiId)
  return refreshOpenGolfCourseEndpointDetails(course, holesPayload, teesPayload, db, { dryRun })
}

export async function backfillOpenGolfApiCourseDetails(options = {}) {
  const db = options.db || getPool()
  const dryRun = Boolean(options.dryRun)
  const delayMs = Math.max(0, Math.trunc(Number(options.delayMs) || 0))
  const stopOnError = Boolean(options.stopOnError)
  const schema = await ensureOpenGolfCourseHoleEndpointSchema(db)
  const targets = await listOpenGolfApiCourseTargets(db, options)
  const totals = {
    discovered: targets.length,
    attempted: 0,
    updated: 0,
    failed: 0,
    holesImported: 0,
    dryRun,
  }

  logApi('opengolfapi_course_details_backfill_started', { ...totals, delayMs, stopOnError, schemaColumnsAdded: schema.added })
  for (const course of targets) {
    const courseApiId = normalizeText(course.external_course_id || course.id)
    totals.attempted += 1
    try {
      const result = await refreshCourse(course, { db, dryRun })
      totals.updated += 1
      totals.holesImported += result.holeCount
      logApi('opengolfapi_course_details_backfilled', {
        courseId: course.id,
        externalCourseId: courseApiId,
        course: course.name,
        state: course.state_code,
        holeCount: result.holeCount,
        teeCount: result.teeCount,
        totalYardage: result.totalYardage,
        courseRating: result.courseRating,
        slopeRating: result.slopeRating,
        dryRun,
      })
    } catch (error) {
      totals.failed += 1
      logError('OpenGolfAPI course details backfill failed', {
        courseId: course.id,
        externalCourseId: courseApiId,
        course: course.name,
        state: course.state_code,
        statusCode: error?.statusCode || null,
        error,
      })
      if (stopOnError) throw error
    }
    if (delayMs > 0 && course !== targets[targets.length - 1]) await sleep(delayMs)
  }

  logInfo('OpenGolfAPI course detail backfill completed', totals)
  return totals
}

export async function main() {
  const options = {
    courseId: optionValue('course-id', optionValue('id', '')),
    maxCourses: positiveIntegerOption('max-courses', 0),
    limit: positiveIntegerOption('limit', positiveIntegerOption('max-courses', 0)),
    offset: positiveIntegerOption('offset', 0),
    delayMs: positiveIntegerOption('delay-ms', process.env.OPEN_GOLF_API_DETAIL_IMPORT_DELAY_MS || '500'),
    missingOnly: flagEnabled('missing-only'),
    dryRun: flagEnabled('dry-run'),
    stopOnError: flagEnabled('stop-on-error'),
  }
  if (!options.limit && options.maxCourses) options.limit = options.maxCourses

  try {
    const totals = await backfillOpenGolfApiCourseDetails(options)
    console.log(`OpenGolfAPI course detail backfill completed: ${totals.updated}/${totals.attempted} courses, ${totals.holesImported} hole rows, ${totals.failed} failed.${totals.dryRun ? ' Dry run only.' : ''}`)
  } catch (error) {
    logError('OpenGolfAPI course detail backfill failed', { error })
    console.error('OpenGolfAPI course detail backfill failed:', error)
    process.exitCode = 1
  } finally {
    await closeDb()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
