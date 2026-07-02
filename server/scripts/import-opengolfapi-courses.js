import 'dotenv/config'
import { pathToFileURL } from 'url'
import { getPool, closeDb } from '../db.js'
import { fetchOpenGolfApiCourseDetail, fetchOpenGolfApiStateCourses } from '../lib/opengolfapi-client.js'
import { upsertOpenGolfCourse } from '../lib/golf-course-service.js'
import { logApi, logError, logInfo } from '../lib/logger.js'
import { US_STATES, normalizeStateCode } from '../lib/us-states.js'

function optionValue(name, fallback = '') {
  const prefix = `--${name}=`
  const found = process.argv.find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length).trim() : fallback
}

function flagEnabled(name) {
  return process.argv.includes(`--${name}`)
}

function sleep(ms) {
  const waitMs = Math.max(0, Math.trunc(Number(ms) || 0))
  if (waitMs <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, waitMs))
}

function positiveIntegerOption(name, fallback = 0) {
  return Math.max(0, Math.trunc(Number(optionValue(name, String(fallback))) || 0))
}

function normalizeStatesOption(value) {
  const raw = String(value || '').trim()
  if (!raw || raw.toLowerCase() === 'all') return US_STATES.map(([code]) => code)
  return raw.split(',').map(normalizeStateCode).filter(Boolean)
}

function courseIdFromRecord(record) {
  return String(record?.id || record?.course_id || record?.courseId || record?.uuid || '').trim()
}

export async function importState(state, { maxCourses = 0, delayMs = 0, dryRun = false, stopOnError = false, pageLimit = null } = {}) {
  const stateCode = normalizeStateCode(state)
  let listRecords = []
  try {
    listRecords = await fetchOpenGolfApiStateCourses(stateCode, { pageLimit })
  } catch (error) {
    const result = { state: stateCode, discovered: 0, attempted: 0, imported: 0, failed: 1, holesImported: 0, dryRun, stateFailed: true, statusCode: error?.statusCode || null }
    logError('OpenGolfAPI state course list import failed', { state: stateCode, error, result })
    if (stopOnError) throw error
    return result
  }
  const selectedRecords = maxCourses > 0 ? listRecords.slice(0, maxCourses) : listRecords
  const db = getPool()
  let imported = 0
  let failed = 0
  let holesImported = 0

  logApi('opengolfapi_state_import_started', { state: stateCode, discoveredCourseCount: listRecords.length, courseCount: selectedRecords.length, maxCourses, pageLimit, dryRun })
  for (const listRecord of selectedRecords) {
    const courseId = courseIdFromRecord(listRecord)
    if (!courseId) {
      failed += 1
      logError('OpenGolfAPI course skipped because id was missing', { state: stateCode, listRecord })
      continue
    }

    try {
      const detailPayload = await fetchOpenGolfApiCourseDetail(courseId)
      if (!dryRun) {
        const result = await upsertOpenGolfCourse(listRecord, detailPayload, db)
        holesImported += result.holeCount
      }
      imported += 1
      logApi('opengolfapi_course_imported', { state: stateCode, courseId, dryRun })
    } catch (error) {
      failed += 1
      logError('OpenGolfAPI course import failed', { state: stateCode, courseId, statusCode: error?.statusCode || null, error })
      if (stopOnError) throw error
    }

    if (delayMs > 0) await sleep(delayMs)
  }

  const result = { state: stateCode, discovered: listRecords.length, attempted: selectedRecords.length, imported, failed, holesImported, dryRun }
  logApi('opengolfapi_state_import_completed', result)
  return result
}

export async function main() {
  const states = normalizeStatesOption(optionValue('states', optionValue('state', 'all')))
  const maxCourses = positiveIntegerOption('max-courses', 0)
  const delayMs = positiveIntegerOption('delay-ms', process.env.OPEN_GOLF_API_IMPORT_DELAY_MS || '500')
  const stateDelayMs = positiveIntegerOption('state-delay-ms', process.env.OPEN_GOLF_API_IMPORT_STATE_DELAY_MS || '5000')
  const pageLimit = positiveIntegerOption('page-limit', process.env.OPEN_GOLF_API_STATE_PAGE_LIMIT || process.env.OPENGOLFAPI_STATE_PAGE_LIMIT || '50')
  const stopOnError = flagEnabled('stop-on-error')
  const dryRun = flagEnabled('dry-run')
  const totals = { states: states.length, discovered: 0, attempted: 0, imported: 0, failed: 0, holesImported: 0, dryRun }

  try {
    for (const state of states) {
      const result = await importState(state, { maxCourses, delayMs, dryRun, stopOnError, pageLimit })
      totals.discovered += result.discovered
      totals.attempted += result.attempted
      totals.imported += result.imported
      totals.failed += result.failed
      totals.holesImported += result.holesImported
      if (stateDelayMs > 0 && state !== states[states.length - 1]) {
        logApi('opengolfapi_state_import_delay', { state, stateDelayMs })
        await sleep(stateDelayMs)
      }
    }
    logInfo('OpenGolfAPI import completed', totals)
    console.log(`OpenGolfAPI import completed: ${totals.imported}/${totals.attempted} courses from ${totals.discovered} discovered state-list rows, ${totals.holesImported} hole rows, ${totals.failed} failed.`)
  } catch (error) {
    logError('OpenGolfAPI import failed', { error, totals })
    console.error('OpenGolfAPI import failed:', error)
    process.exitCode = 1
  } finally {
    await closeDb()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
