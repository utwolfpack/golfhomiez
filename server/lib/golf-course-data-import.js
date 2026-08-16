import { randomUUID } from 'node:crypto'
import {
  fetchOpenGolfApiBulkCourseCatalog,
  fetchOpenGolfApiCourseDetail,
  fetchOpenGolfApiCourseHoles,
  fetchOpenGolfApiCourseTees,
  fetchOpenGolfApiStateCourses,
  getOpenGolfApiRateLimitConfig,
  getOpenGolfApiRateLimitSnapshot,
  resetOpenGolfApiBulkDatasetCache,
} from './opengolfapi-client.js'
import { refreshOpenGolfCourseEndpointDetails, upsertOpenGolfCourse } from './golf-course-service.js'
import { US_STATES, normalizeStateCode } from './us-states.js'

const DEFAULT_PAGE_LIMIT = 500
const DEFAULT_COURSE_CONCURRENCY = 8
const MAX_COURSE_CONCURRENCY = 32
const DEFAULT_TARGET_RUN_HOURS = 12
const MAX_FAILURE_SAMPLES = 25

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function envInteger(names, fallback, { allowZero = true } = {}) {
  for (const key of Array.isArray(names) ? names : [names]) {
    const raw = process.env[key]
    if (raw == null || raw === '') continue
    const value = Math.trunc(Number(raw))
    if (Number.isFinite(value) && (allowZero ? value >= 0 : value > 0)) return value
  }
  return fallback
}

function envNumber(names, fallback, { min = 0 } = {}) {
  for (const key of Array.isArray(names) ? names : [names]) {
    const raw = process.env[key]
    if (raw == null || raw === '') continue
    const value = Number(raw)
    if (Number.isFinite(value) && value >= min) return value
  }
  return fallback
}

function envBoolean(names, fallback) {
  for (const key of Array.isArray(names) ? names : [names]) {
    const raw = normalizeText(process.env[key]).toLowerCase()
    if (!raw) continue
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true
    if (['0', 'false', 'no', 'off'].includes(raw)) return false
  }
  return fallback
}

function sleep(ms, signal = null) {
  const waitMs = Math.max(0, Math.trunc(Number(ms) || 0))
  if (!waitMs) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancellationError(signal))
    const onAbort = () => {
      globalThis.clearTimeout(timer)
      reject(cancellationError(signal))
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, waitMs)
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

function cancellationError(signal = null) {
  const reason = signal?.reason
  if (reason instanceof Error) {
    if (!reason.code) reason.code = 'SCHEDULED_JOB_CANCELLED'
    return reason
  }
  const error = new Error('getGolfCourseData cancellation requested')
  error.code = 'SCHEDULED_JOB_CANCELLED'
  return error
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw cancellationError(signal)
}

function normalizeStates(value) {
  const all = US_STATES.map(([code]) => code)
  if (Array.isArray(value)) {
    const states = [...new Set(value.map(normalizeStateCode).filter((code) => all.includes(code)))]
    return states.length ? states : all
  }
  const raw = normalizeText(value)
  if (!raw || raw.toLowerCase() === 'all') return all
  const states = [...new Set(raw.split(',').map(normalizeStateCode).filter((code) => all.includes(code)))]
  return states.length ? states : all
}

export function normalizeGolfCourseDataJobConfig(input = {}) {
  const config = input && typeof input === 'object' ? input : {}
  const rateLimitConfig = getOpenGolfApiRateLimitConfig()
  const fastMode = config.fastMode == null
    ? envBoolean(['OPEN_GOLF_API_FAST_MODE', 'OPENGOLFAPI_FAST_MODE'], true)
    : config.fastMode !== false
  return {
    fastMode,
    states: normalizeStates(config.states),
    pageLimit: Math.min(500, Math.max(1, Math.trunc(Number(config.pageLimit) || DEFAULT_PAGE_LIMIT))),
    useBulkFallback: config.useBulkFallback !== false,
    useCourseDetailEndpoint: config.useCourseDetailEndpoint == null
      ? envBoolean(['OPEN_GOLF_API_USE_COURSE_DETAIL_ENDPOINT', 'OPENGOLFAPI_USE_COURSE_DETAIL_ENDPOINT'], false)
      : config.useCourseDetailEndpoint === true,
    courseConcurrency: Math.min(MAX_COURSE_CONCURRENCY, Math.max(1, Math.trunc(Number(config.courseConcurrency ?? envInteger(['OPEN_GOLF_API_IMPORT_CONCURRENCY', 'OPENGOLFAPI_IMPORT_CONCURRENCY'], DEFAULT_COURSE_CONCURRENCY, { allowZero: false })) || DEFAULT_COURSE_CONCURRENCY))),
    targetRunHours: Math.max(1, Number(config.targetRunHours ?? envNumber(['OPEN_GOLF_API_TARGET_RUN_HOURS', 'OPENGOLFAPI_TARGET_RUN_HOURS'], DEFAULT_TARGET_RUN_HOURS, { min: 1 })) || DEFAULT_TARGET_RUN_HOURS),
    requestIntervalMs: Math.max(0, Math.trunc(Number(config.requestIntervalMs ?? rateLimitConfig.requestIntervalMs) || 0)),
    courseDelayMs: Math.max(0, Math.trunc(Number(config.courseDelayMs ?? envInteger(['OPEN_GOLF_API_IMPORT_DELAY_MS', 'OPENGOLFAPI_IMPORT_DELAY_MS'], 0)) || 0)),
    stateDelayMs: Math.max(0, Math.trunc(Number(config.stateDelayMs ?? envInteger(['OPEN_GOLF_API_IMPORT_STATE_DELAY_MS', 'OPENGOLFAPI_IMPORT_STATE_DELAY_MS'], 0)) || 0)),
    stopOnError: Boolean(config.stopOnError),
    waitForDailyReset: config.waitForDailyReset == null ? rateLimitConfig.waitForDailyReset : config.waitForDailyReset !== false,
    adaptiveDailyPacing: fastMode ? false : (config.adaptiveDailyPacing == null ? rateLimitConfig.adaptiveDailyPacing : config.adaptiveDailyPacing !== false),
  }
}

export function buildGolfCourseDataImportPlan(courseCount, configInput = {}) {
  const config = normalizeGolfCourseDataJobConfig(configInput)
  const normalizedCourseCount = Math.max(0, Math.trunc(Number(courseCount) || 0))
  const stateRequests = config.states.length
  const requestsPerCourse = 2 + (config.useCourseDetailEndpoint ? 1 : 0)
  const estimatedApiRequests = stateRequests + (normalizedCourseCount * requestsPerCourse)
  const estimatedThrottleHours = estimatedApiRequests > 0
    ? (estimatedApiRequests * config.requestIntervalMs) / 3_600_000
    : 0
  const targetIntervalMs = estimatedApiRequests > 0
    ? Math.max(0, Math.floor((config.targetRunHours * 3_600_000) / estimatedApiRequests))
    : 0
  const reserve = getOpenGolfApiRateLimitConfig().rateLimitReserve
  return {
    courseCount: normalizedCourseCount,
    stateRequests,
    requestsPerCourse,
    estimatedApiRequests,
    estimatedThrottleHours: Number(estimatedThrottleHours.toFixed(2)),
    requestIntervalMs: config.requestIntervalMs,
    courseConcurrency: config.courseConcurrency,
    targetRunHours: config.targetRunHours,
    targetIntervalMs,
    recommendedDailyQuota: estimatedApiRequests + reserve,
    usesCourseDetailEndpoint: config.useCourseDetailEndpoint,
    usesBulkCourseMetadata: !config.useCourseDetailEndpoint,
    targetLikelyAchievableByThrottle: estimatedThrottleHours <= config.targetRunHours,
  }
}

async function runWithConcurrency(items, concurrency, worker, signal = null) {
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, items.length))
  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      throwIfCancelled(signal)
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

function courseIdFromRecord(record) {
  return normalizeText(record?.id || record?.course_id || record?.courseId || record?.uuid)
}

function stateCodeFromRecord(record) {
  return normalizeStateCode(record?.state || record?.state_code || record?.stateCode || record?.location?.state || record?.address?.state)
}

function isFatalOpenGolfApiError(error) {
  const statusCode = Number(error?.statusCode || 0)
  return statusCode === 401 || statusCode === 403 || statusCode === 429 || error?.code === 'OPENGOLFAPI_STATE_COMPLETENESS_UNAVAILABLE'
}

function failureSample(state, courseId, courseName, phase, error) {
  return {
    state,
    courseId: courseId || null,
    course: normalizeText(courseName) || null,
    phase,
    statusCode: error?.statusCode || null,
    message: normalizeText(error?.message || error) || 'Unknown error',
  }
}

function buildProgress(totals, state = null) {
  return {
    statesRequested: totals.statesRequested,
    statesCompleted: totals.statesCompleted,
    state,
    coursesDiscovered: totals.coursesDiscovered,
    coursesAttempted: totals.coursesAttempted,
    coursesImported: totals.coursesImported,
    coursesFailed: totals.coursesFailed,
    holesImported: totals.holesImported,
    teeSetsRead: totals.teeSetsRead,
  }
}

export async function runGetGolfCourseData(pool, {
  correlationId = `getGolfCourseData-${randomUUID()}`,
  triggeredBy = 'manual',
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
  signal = null,
  jobConfig = {},
} = {}) {
  const config = normalizeGolfCourseDataJobConfig(jobConfig)
  const startedAt = new Date()
  const totals = {
    statesRequested: config.states.length,
    statesCompleted: 0,
    statesFailed: 0,
    coursesDiscovered: 0,
    coursesAttempted: 0,
    coursesImported: 0,
    coursesFailed: 0,
    holesImported: 0,
    teeSetsRead: 0,
    failureSamples: [],
  }

  const startDetails = {
    correlationId,
    jobId: 'getGolfCourseData',
    triggeredBy,
    fastMode: config.fastMode,
    states: config.states,
    stateCount: config.states.length,
    pageLimit: config.pageLimit,
    useBulkFallback: config.useBulkFallback,
    useCourseDetailEndpoint: config.useCourseDetailEndpoint,
    courseConcurrency: config.courseConcurrency,
    targetRunHours: config.targetRunHours,
    requestIntervalMs: config.requestIntervalMs,
    courseDelayMs: config.courseDelayMs,
    stateDelayMs: config.stateDelayMs,
    stopOnError: config.stopOnError,
    waitForDailyReset: config.waitForDailyReset,
    adaptiveDailyPacing: config.adaptiveDailyPacing,
    rateLimit: getOpenGolfApiRateLimitSnapshot(),
  }
  logApi('golf_course_data_import_started', startDetails)
  logScheduledJob('golf_course_data_import_started', startDetails)
  resetOpenGolfApiBulkDatasetCache()

  let importPlan = null
  if (config.useBulkFallback) {
    try {
      const bulkCatalog = await fetchOpenGolfApiBulkCourseCatalog({ correlationId })
      const selectedStates = new Set(config.states)
      const plannedCourses = bulkCatalog.filter((record) => selectedStates.has(stateCodeFromRecord(record))).length
      importPlan = buildGolfCourseDataImportPlan(plannedCourses, config)
      const planDetails = { correlationId, jobId: 'getGolfCourseData', ...importPlan }
      logApi('golf_course_data_import_plan', planDetails)
      logScheduledJob('golf_course_data_import_plan', planDetails)
    } catch (error) {
      logApi('golf_course_data_import_plan_unavailable', { correlationId, jobId: 'getGolfCourseData', message: normalizeText(error?.message || error) })
    }
  }

  const requestOptions = {
    correlationId,
    signal,
    waitForDailyReset: config.waitForDailyReset,
    adaptiveDailyPacing: config.adaptiveDailyPacing,
    requestIntervalMs: config.requestIntervalMs,
    onRateLimitEvent: (event, details) => logScheduledJob(event, { jobId: 'getGolfCourseData', ...details }),
  }

  try {
    for (let stateIndex = 0; stateIndex < config.states.length; stateIndex += 1) {
      throwIfCancelled(signal)
      const state = config.states[stateIndex]
      const stateStartedAt = Date.now()
      let stateImported = 0
      let stateFailed = 0
      let stateHoles = 0
      let stateTees = 0
      let stateCourses = []
      let fatalStateError = null

      logScheduledJob('golf_course_data_state_started', { correlationId, jobId: 'getGolfCourseData', state, stateIndex: stateIndex + 1, stateCount: config.states.length })
      try {
        stateCourses = await fetchOpenGolfApiStateCourses(state, {
          pageLimit: config.pageLimit,
          useBulkFallback: config.useBulkFallback,
          ...requestOptions,
        })
        totals.coursesDiscovered += stateCourses.length
      } catch (error) {
        totals.statesFailed += 1
        const sample = failureSample(state, '', '', 'state-list', error)
        if (totals.failureSamples.length < MAX_FAILURE_SAMPLES) totals.failureSamples.push(sample)
        logError('getGolfCourseData state list failed', { correlationId, jobId: 'getGolfCourseData', state, error })
        logScheduledJob('golf_course_data_state_failed', { correlationId, jobId: 'getGolfCourseData', state, phase: 'state-list', error: sample.message })
        if (config.stopOnError || isFatalOpenGolfApiError(error)) throw error
        continue
      }

      logApi('golf_course_data_state_discovered', { correlationId, jobId: 'getGolfCourseData', state, courseCount: stateCourses.length, courseConcurrency: config.courseConcurrency })

      await runWithConcurrency(stateCourses, config.courseConcurrency, async (listRecord, courseIndex) => {
        if (fatalStateError) return
        throwIfCancelled(signal)
        const courseId = courseIdFromRecord(listRecord)
        const courseName = listRecord?.course_name || listRecord?.courseName || listRecord?.name || null
        totals.coursesAttempted += 1

        if (!courseId) {
          totals.coursesFailed += 1
          stateFailed += 1
          const sample = failureSample(state, '', courseName, 'course-id', new Error('OpenGolfAPI course id is missing'))
          if (totals.failureSamples.length < MAX_FAILURE_SAMPLES) totals.failureSamples.push(sample)
          logError('getGolfCourseData course skipped because id is missing', { correlationId, jobId: 'getGolfCourseData', state, courseIndex: courseIndex + 1, listRecord })
          if (config.stopOnError) fatalStateError = new Error(`OpenGolfAPI course id is missing for ${courseName || state}`)
          return
        }

        try {
          // The official bulk catalog already carries course metadata and scorecard data.
          // In fast mode, avoid the redundant /courses/{id} call and spend the API budget
          // only on /holes (yardages/handicap) and /tees (rating/slope/total yardage).
          const endpointRequests = Promise.all([
            fetchOpenGolfApiCourseHoles(courseId, requestOptions),
            fetchOpenGolfApiCourseTees(courseId, requestOptions),
          ])

          let detailPayload = listRecord
          if (config.useCourseDetailEndpoint) {
            detailPayload = await fetchOpenGolfApiCourseDetail(courseId, requestOptions)
          }

          const upsertPromise = upsertOpenGolfCourse(listRecord, detailPayload, pool, { correlationId, skipHoleRows: true })
          const [upsert, [holesPayload, teesPayload]] = await Promise.all([upsertPromise, endpointRequests])
          throwIfCancelled(signal)

          const endpointResult = await refreshOpenGolfCourseEndpointDetails(
            { id: upsert.id, external_course_id: upsert.externalCourseId },
            holesPayload,
            teesPayload,
            pool,
            { correlationId },
          )

          totals.coursesImported += 1
          totals.holesImported += endpointResult.holeCount
          totals.teeSetsRead += endpointResult.teeCount
          stateImported += 1
          stateHoles += endpointResult.holeCount
          stateTees += endpointResult.teeCount

          const courseDetails = {
            correlationId,
            jobId: 'getGolfCourseData',
            state,
            courseId: upsert.id,
            externalCourseId: upsert.externalCourseId,
            course: upsert.course?.name || normalizeText(courseName) || null,
            courseIndex: courseIndex + 1,
            stateCourseCount: stateCourses.length,
            holeCount: endpointResult.holeCount,
            teeCount: endpointResult.teeCount,
            totalYardage: endpointResult.totalYardage,
            courseRating: endpointResult.courseRating,
            slopeRating: endpointResult.slopeRating,
            courseMetadataSource: config.useCourseDetailEndpoint ? '/v1/courses/{id}' : 'official bulk catalog',
          }
          logApi('golf_course_data_course_imported', courseDetails)
          logScheduledJob('golf_course_data_course_imported', courseDetails)
        } catch (error) {
          if (signal?.aborted || error?.code === 'SCHEDULED_JOB_CANCELLED') throw error
          totals.coursesFailed += 1
          stateFailed += 1
          const phase = config.useCourseDetailEndpoint ? 'course-detail-holes-tees' : 'course-holes-tees'
          const sample = failureSample(state, courseId, courseName, phase, error)
          if (totals.failureSamples.length < MAX_FAILURE_SAMPLES) totals.failureSamples.push(sample)
          logError('getGolfCourseData course import failed', { correlationId, jobId: 'getGolfCourseData', state, courseId, course: courseName, error })
          logScheduledJob('golf_course_data_course_failed', { correlationId, jobId: 'getGolfCourseData', ...sample, level: 'error' })
          if (config.stopOnError || isFatalOpenGolfApiError(error)) fatalStateError = error
        }

        if (config.courseDelayMs > 0) await sleep(config.courseDelayMs, signal)
      }, signal)

      if (fatalStateError) throw fatalStateError

      totals.statesCompleted += 1
      const stateSummary = {
        correlationId,
        jobId: 'getGolfCourseData',
        state,
        discovered: stateCourses.length,
        imported: stateImported,
        failed: stateFailed,
        holesImported: stateHoles,
        teeSetsRead: stateTees,
        courseConcurrency: config.courseConcurrency,
        durationMs: Date.now() - stateStartedAt,
        progress: buildProgress(totals, state),
      }
      logApi('golf_course_data_state_completed', stateSummary)
      logScheduledJob('golf_course_data_state_completed', stateSummary)

      if (config.stateDelayMs > 0 && stateIndex < config.states.length - 1) await sleep(config.stateDelayMs, signal)
    }

    const output = {
      ...totals,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      source: 'OpenGolfAPI',
      stateEndpoint: '/v1/courses/state/{STATE}',
      detailEndpoint: config.useCourseDetailEndpoint ? '/v1/courses/{id}' : null,
      courseMetadataSource: config.useCourseDetailEndpoint ? '/v1/courses/{id}' : 'official OpenGolfAPI bulk dataset',
      holesEndpoint: '/v1/courses/{id}/holes',
      teesEndpoint: '/v1/courses/{id}/tees',
      completenessSupplement: config.useBulkFallback ? 'official OpenGolfAPI bulk dataset' : null,
      fastMode: config.fastMode,
      courseConcurrency: config.courseConcurrency,
      requestIntervalMs: config.requestIntervalMs,
      targetRunHours: config.targetRunHours,
      importPlan,
      waitForDailyReset: config.waitForDailyReset,
      adaptiveDailyPacing: config.adaptiveDailyPacing,
      rateLimit: getOpenGolfApiRateLimitSnapshot(),
    }
    logApi('golf_course_data_import_completed', { correlationId, jobId: 'getGolfCourseData', ...output })
    logScheduledJob('golf_course_data_import_completed', { correlationId, jobId: 'getGolfCourseData', ...output })
    return output
  } catch (error) {
    if (signal?.aborted || error?.code === 'SCHEDULED_JOB_CANCELLED') {
      error.code = 'SCHEDULED_JOB_CANCELLED'
      error.output = {
        cancelled: true,
        ...totals,
        startedAt: startedAt.toISOString(),
        cancelledAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        importPlan,
      }
      logScheduledJob('golf_course_data_import_cancelled', { correlationId, jobId: 'getGolfCourseData', ...error.output })
      throw error
    }
    error.output = {
      failed: true,
      ...totals,
      startedAt: startedAt.toISOString(),
      failedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      message: normalizeText(error?.message || error),
      importPlan,
      rateLimit: getOpenGolfApiRateLimitSnapshot(),
    }
    logError('getGolfCourseData import failed', { correlationId, jobId: 'getGolfCourseData', progress: buildProgress(totals), error })
    logScheduledJob('golf_course_data_import_failed', { correlationId, jobId: 'getGolfCourseData', ...error.output, level: 'error' })
    throw error
  }
}
