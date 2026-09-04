import { randomUUID } from 'crypto'
import {
  CANCELLED_TOURNAMENT_CLEANUP_TIME_ZONE,
  deleteCancelledTournaments,
  nextCancelledTournamentCleanupRun,
} from './cancelled-tournament-cleanup.js'
import {
  GET_TOURNAMENTS_TIME_ZONE,
  nextGetTournamentsRun,
  runGetTournaments,
  runRetryFailedTournamentWebsites,
} from './tournament-discovery.js'
import { normalizeTournamentScrubValues, runScrubTournaments } from './tournament-scrub.js'
import { runScrubGolfHomiezTournaments } from './golfhomiez-tournament-scrub.js'
import { normalizeGolfCourseDataJobConfig, runGetGolfCourseData } from './golf-course-data-import.js'
import { nextRunForSchedule, normalizeScheduleConfig, scheduleLabel } from './scheduled-job-schedule.js'
import { reconcileStripeSubscriptions } from './billing.js'
import { runBuildGolfCourseEmails } from './golf-course-emails.js'
import { normalizeGolfCourseEmailScrubValues, runScrubGolfCourseEmails } from './golf-course-email-scrub.js'
import {
  getScheduledJobRecord,
  listScheduledJobRecords,
  recordScheduledJobRunCancellationRequested,
  recordScheduledJobRunCompleted,
  recordScheduledJobRunStarted,
  updateScheduledJobConfiguration,
  updateScheduledJobNextRun,
  upsertScheduledJobDefinitions,
} from './scheduled-job-store.js'

const activeJobRuns = new Map()
const MAX_TIMER_DELAY_MS = 2_147_000_000

function cancellationError(message = 'Scheduled job cancellation requested') {
  const error = new Error(message)
  error.code = 'SCHEDULED_JOB_CANCELLED'
  return error
}

function throwIfJobCancelled(signal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) {
    if (!reason.code) reason.code = 'SCHEDULED_JOB_CANCELLED'
    throw reason
  }
  throw cancellationError()
}

function isScheduledJobCancellation(error, signal) {
  return Boolean(signal?.aborted || error?.code === 'SCHEDULED_JOB_CANCELLED')
}

function alreadyRunningError(jobId) {
  const error = new Error(`Scheduled job is already running: ${jobId}`)
  error.code = 'SCHEDULED_JOB_ALREADY_RUNNING'
  return error
}

function notRunningError(jobId) {
  const error = new Error(`Scheduled job is not currently running: ${jobId}`)
  error.code = 'SCHEDULED_JOB_NOT_RUNNING'
  return error
}

function normalizeJobConfig(definition, input) {
  const config = input && typeof input === 'object' ? input : {}
  if (definition.id === 'scrubTournaments') {
    return { matchValues: normalizeTournamentScrubValues(config.matchValues) }
  }
  if (definition.id === 'scrubGolfCourseEmails') {
    return { matchValues: normalizeGolfCourseEmailScrubValues(config.matchValues) }
  }
  if (definition.id === 'getGolfCourseData') {
    return normalizeGolfCourseDataJobConfig(config)
  }
  return config
}

export const SCHEDULED_JOB_DEFINITIONS = [
  {
    id: 'reconcileStripeSubscriptions',
    name: 'Reconcile Stripe subscriptions',
    description: 'Refreshes local subscription state from Stripe to repair missed or delayed webhook delivery.',
    scheduleLabel: 'Daily 03:30 MT',
    defaultScheduleLabel: 'Daily 03:30 MT',
    scheduleTimeZone: GET_TOURNAMENTS_TIME_ZONE,
    defaultSchedule: { type: 'daily', time: '03:30', dayOfWeek: null, dayOfMonth: null },
    getDefaultNextRunAt: () => null,
    defaultJobConfig: {},
    async run({ pool }) {
      if (String(process.env.BILLING_ENABLED || '').toLowerCase() !== 'true') return { skipped: true, reason: 'billing_disabled' }
      return reconcileStripeSubscriptions(pool)
    },
  },
  {
    id: 'getGolfCourseData',
    name: 'getGolfCourseData',
    description: 'Imports and refreshes the US golf-course catalog from OpenGolfAPI. Fast mode uses the official bulk catalog for course metadata, concurrently enriches courses from holes and tees endpoints, batches database hole writes, and pauses through UTC daily resets if the API quota is exhausted.',
    scheduleLabel: 'Manual',
    defaultScheduleLabel: 'Manual',
    scheduleTimeZone: GET_TOURNAMENTS_TIME_ZONE,
    defaultSchedule: { type: 'manual', time: null, dayOfWeek: null, dayOfMonth: null },
    getDefaultNextRunAt: () => null,
    defaultJobConfig: normalizeGolfCourseDataJobConfig({ states: 'all', pageLimit: 500, useBulkFallback: true, fastMode: true }),
    backgroundManualRun: true,
    async run({ pool, correlationId, triggeredBy, logApi, logError, logScheduledJob, signal, jobConfig }) {
      return runGetGolfCourseData(pool, {
        correlationId,
        triggeredBy,
        logApi,
        logError,
        logScheduledJob,
        signal,
        jobConfig,
      })
    },
  },
  {
    id: 'buildGolfCourseEmails',
    name: 'Build Golf Course Emails',
    description: 'Builds docs/golfCourseEmails.csv from active golf-course websites. Each course uses at most two page attempts, with only a single transient retry when the first request fails, and captures course name, email address, and any nearby contact name or position found on the site.',
    scheduleLabel: 'Manual',
    defaultScheduleLabel: 'Manual',
    scheduleTimeZone: GET_TOURNAMENTS_TIME_ZONE,
    defaultSchedule: { type: 'manual', time: null, dayOfWeek: null, dayOfMonth: null },
    getDefaultNextRunAt: () => null,
    defaultJobConfig: {},
    backgroundManualRun: true,
    async run({ pool, correlationId, triggeredBy, logApi, logError, logScheduledJob, signal }) {
      return runBuildGolfCourseEmails(pool, {
        correlationId,
        triggeredBy,
        logApi,
        logError,
        logScheduledJob,
        signal,
      })
    },
  },
  {
    id: 'scrubGolfCourseEmails',
    name: 'Scrub Golf Course Emails',
    description: 'Deletes rows from docs/golfCourseEmails.csv when the Email Address column contains one of the configured literal scrub values and removes duplicate email-address rows so only the first record for each email remains.',
    scheduleLabel: 'Manual',
    defaultScheduleLabel: 'Manual',
    scheduleTimeZone: GET_TOURNAMENTS_TIME_ZONE,
    defaultSchedule: { type: 'manual', time: null, dayOfWeek: null, dayOfMonth: null },
    getDefaultNextRunAt: () => null,
    defaultJobConfig: { matchValues: [] },
    async run({ pool, correlationId, triggeredBy, logApi, logError, logScheduledJob, signal, jobConfig }) {
      return runScrubGolfCourseEmails(pool, {
        matchValues: jobConfig?.matchValues || [],
        correlationId,
        triggeredBy,
        logApi,
        logError,
        logScheduledJob,
        signal,
      })
    },
  },
  {
    id: 'getTournaments',
    name: 'getTournaments',
    description: 'Truncates and rebuilds the discovered tournament catalog from current golf-course websites, skipping unchanged URLs whose last crawl failed and storing tournaments from today through six months from today.',
    scheduleLabel: 'Daily 02:00 MT',
    defaultScheduleLabel: 'Daily 02:00 MT',
    scheduleTimeZone: GET_TOURNAMENTS_TIME_ZONE,
    defaultSchedule: { type: 'daily', time: '02:00', dayOfWeek: null, dayOfMonth: null },
    getDefaultNextRunAt: nextGetTournamentsRun,
    defaultJobConfig: {},
    async run({ pool, correlationId, triggeredBy, logApi, logError, logScheduledJob, signal }) {
      return runGetTournaments(pool, { correlationId, triggeredBy, logApi, logError, logScheduledJob, signal })
    },
  },
  {
    id: 'cancelled-tournament-cleanup',
    name: 'Cancelled tournament cleanup',
    description: 'Deletes tournaments marked cancelled and safely removes tournament registration and organizer invite records that belong to those tournaments.',
    scheduleLabel: 'Weekly Sunday 18:00 MT',
    defaultScheduleLabel: 'Weekly Sunday 18:00 MT',
    scheduleTimeZone: CANCELLED_TOURNAMENT_CLEANUP_TIME_ZONE,
    defaultSchedule: { type: 'weekly', time: '18:00', dayOfWeek: 0, dayOfMonth: null },
    getDefaultNextRunAt: nextCancelledTournamentCleanupRun,
    defaultJobConfig: {},
    async run({ pool, correlationId, logApi, logError, signal }) {
      throwIfJobCancelled(signal)
      const output = await deleteCancelledTournaments(pool, { correlationId, logApi, logError })
      throwIfJobCancelled(signal)
      return output
    },
  },
  {
    id: 'scrubTournaments',
    name: 'scrubTournaments',
    description: 'Deletes discovered golf-course tournament records when tournament_name contains one of the configured scrub values.',
    scheduleLabel: 'Manual',
    defaultScheduleLabel: 'Manual',
    scheduleTimeZone: GET_TOURNAMENTS_TIME_ZONE,
    defaultSchedule: { type: 'manual', time: null, dayOfWeek: null, dayOfMonth: null },
    getDefaultNextRunAt: () => null,
    defaultJobConfig: { matchValues: [] },
    async run({ pool, correlationId, triggeredBy, logApi, logError, logScheduledJob, signal, jobConfig }) {
      return runScrubTournaments(pool, {
        matchValues: jobConfig?.matchValues || [],
        correlationId,
        triggeredBy,
        logApi,
        logError,
        logScheduledJob,
        signal,
      })
    },
  },
  {
    id: 'scrubGolfHomiezTournaments',
    name: 'Scrub Golf Homiez Tournaments',
    description: "Removes golf_course_tournaments rows whose golfhomiez_tournament_id does not exist in this environment's tournaments table, preventing GolfHomiez tournament records imported from another database from appearing as local tournaments.",
    scheduleLabel: 'Manual',
    defaultScheduleLabel: 'Manual',
    scheduleTimeZone: GET_TOURNAMENTS_TIME_ZONE,
    defaultSchedule: { type: 'manual', time: null, dayOfWeek: null, dayOfMonth: null },
    getDefaultNextRunAt: () => null,
    defaultJobConfig: {},
    async run({ pool, correlationId, triggeredBy, logApi, logError, logScheduledJob, signal }) {
      return runScrubGolfHomiezTournaments(pool, {
        correlationId,
        triggeredBy,
        logApi,
        logError,
        logScheduledJob,
        signal,
      })
    },
  },
  {
    id: 'retryFailedTournamentWebsites',
    name: 'retryFailedTournamentWebsites',
    description: 'Retries golf-course tournament websites whose current URL matches a failed crawl-state record, updating the crawl state after each retry.',
    scheduleLabel: 'Manual',
    defaultScheduleLabel: 'Manual',
    scheduleTimeZone: GET_TOURNAMENTS_TIME_ZONE,
    defaultSchedule: { type: 'manual', time: null, dayOfWeek: null, dayOfMonth: null },
    getDefaultNextRunAt: () => null,
    defaultJobConfig: {},
    async run({ pool, correlationId, triggeredBy, logApi, logError, logScheduledJob, signal }) {
      return runRetryFailedTournamentWebsites(pool, {
        correlationId,
        triggeredBy,
        logApi,
        logError,
        logScheduledJob,
        signal,
      })
    },
  },
]

function findScheduledJobDefinition(jobId) {
  return SCHEDULED_JOB_DEFINITIONS.find((definition) => definition.id === jobId) || null
}

export function shouldRunScheduledJobInBackground(jobId) {
  return Boolean(findScheduledJobDefinition(jobId)?.backgroundManualRun)
}

function getNextRunForDefinition(definition, schedule, now = new Date()) {
  return nextRunForSchedule(schedule || definition.defaultSchedule || { type: 'manual' }, now, definition.scheduleTimeZone || GET_TOURNAMENTS_TIME_ZONE)
}

async function resolveRuntimeRecord(pool, definition) {
  const record = await getScheduledJobRecord(pool, definition)
  return record || {
    id: definition.id,
    schedule: normalizeScheduleConfig(definition.defaultSchedule || { type: 'manual' }),
    scheduleLabel: definition.defaultScheduleLabel || scheduleLabel(definition.defaultSchedule || { type: 'manual' }),
    jobConfig: normalizeJobConfig(definition, definition.defaultJobConfig),
  }
}

async function resolveNextRun(pool, definition, now = new Date()) {
  const record = await resolveRuntimeRecord(pool, definition)
  return getNextRunForDefinition(definition, record.schedule, now)
}

export async function listScheduledJobs(pool, now = new Date()) {
  const jobs = await listScheduledJobRecords(pool, SCHEDULED_JOB_DEFINITIONS, now)
  return jobs.map((job) => {
    const active = activeJobRuns.get(job.id)
    return {
      ...job,
      canCancel: Boolean(active && !active.controller.signal.aborted),
      activeRunId: active?.runId || null,
    }
  })
}

export async function configureScheduledJob(pool, jobId, {
  schedule: scheduleInput,
  jobConfig: jobConfigInput,
  correlationId = `scheduled-job-config-${jobId}-${randomUUID()}`,
  adminUser = null,
  logApi = () => {},
  logScheduledJob = () => {},
  now = new Date(),
} = {}) {
  const definition = findScheduledJobDefinition(jobId)
  if (!definition) throw new Error(`Scheduled job not found: ${jobId}`)

  const current = await resolveRuntimeRecord(pool, definition)
  const schedule = normalizeScheduleConfig(scheduleInput || current.schedule || definition.defaultSchedule, current.schedule || definition.defaultSchedule)
  const jobConfig = normalizeJobConfig(definition, jobConfigInput ?? current.jobConfig ?? definition.defaultJobConfig)
  const nextRunAt = getNextRunForDefinition(definition, schedule, now)
  const updated = await updateScheduledJobConfiguration(pool, definition, { schedule, jobConfig, nextRunAt })

  const details = {
    correlationId,
    jobId: definition.id,
    jobName: definition.name,
    schedule: updated?.schedule || schedule,
    scheduleLabel: updated?.scheduleLabel || scheduleLabel(schedule),
    scheduleTimeZone: definition.scheduleTimeZone || null,
    nextRunAt: nextRunAt?.toISOString?.() || null,
    jobConfig,
    adminUserId: adminUser?.id || null,
    adminUserEmail: adminUser?.email || null,
  }
  logApi('scheduled_job_configuration_updated', details)
  logScheduledJob('scheduled_job_configuration_updated', details)
  return updated || { ...current, schedule, jobConfig, nextRunAt }
}

export async function cancelScheduledJob(pool, jobId, {
  correlationId = `scheduled-job-cancel-${jobId}-${randomUUID()}`,
  adminUser = null,
  logApi = () => {},
  logScheduledJob = () => {},
} = {}) {
  const definition = findScheduledJobDefinition(jobId)
  if (!definition) throw new Error(`Scheduled job not found: ${jobId}`)

  const active = activeJobRuns.get(jobId)
  if (!active) throw notRunningError(jobId)

  if (!active.controller.signal.aborted) {
    active.cancelRequestedBy = adminUser?.id || adminUser?.email || 'admin'
    active.cancelRequestCorrelationId = correlationId
    active.controller.abort(cancellationError(`Scheduled job ${definition.name} was cancelled by an administrator`))
  }

  if (active.runId) {
    await recordScheduledJobRunCancellationRequested(pool, definition, { runId: active.runId })
  }

  const details = {
    correlationId: active.correlationId || correlationId,
    requestCorrelationId: correlationId,
    jobId: definition.id,
    jobName: definition.name,
    runId: active.runId || null,
    status: 'cancel_requested',
    adminUserId: adminUser?.id || null,
    adminUserEmail: adminUser?.email || null,
  }
  logApi('scheduled_job_cancel_requested', details)
  logScheduledJob('scheduled_job_cancel_requested', details)
  return details
}

export async function runScheduledJob(pool, jobId, {
  triggeredBy = 'manual',
  correlationId = `scheduled-job-${jobId}-${randomUUID()}`,
  adminUser = null,
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
} = {}) {
  const definition = findScheduledJobDefinition(jobId)
  if (!definition) throw new Error(`Scheduled job not found: ${jobId}`)
  if (activeJobRuns.has(jobId)) throw alreadyRunningError(jobId)

  const controller = new AbortController()
  const active = {
    jobId,
    runId: null,
    correlationId,
    controller,
    triggeredBy,
    startedAt: new Date(),
  }
  activeJobRuns.set(jobId, active)

  let runId = null
  try {
    await upsertScheduledJobDefinitions(pool, SCHEDULED_JOB_DEFINITIONS)
    const runtimeRecord = await resolveRuntimeRecord(pool, definition)
    const jobConfig = normalizeJobConfig(definition, runtimeRecord.jobConfig || definition.defaultJobConfig)
    const started = await recordScheduledJobRunStarted(pool, definition, { triggeredBy, correlationId, adminUser })
    runId = started.runId
    active.runId = runId
    logScheduledJob('scheduled_job_run_started', { correlationId, jobId: definition.id, jobName: definition.name, runId, triggeredBy, adminUserId: adminUser?.id || null, adminUserEmail: adminUser?.email || null, schedule: runtimeRecord.schedule, jobConfig })
    logApi('scheduled_job_run_started', { correlationId, jobId: definition.id, jobName: definition.name, runId, triggeredBy, adminUserId: adminUser?.id || null })

    throwIfJobCancelled(controller.signal)
    const output = await definition.run({ pool, correlationId, triggeredBy, logApi, logError, logScheduledJob, signal: controller.signal, jobConfig })
    throwIfJobCancelled(controller.signal)
    const nextRunAt = await resolveNextRun(pool, definition)
    await recordScheduledJobRunCompleted(pool, definition, { runId, status: 'success', output, nextRunAt })
    logScheduledJob('scheduled_job_run_completed', { correlationId, jobId: definition.id, jobName: definition.name, runId, triggeredBy, status: 'success', output, nextRunAt: nextRunAt?.toISOString?.() || null })
    logApi('scheduled_job_run_completed', { correlationId, jobId: definition.id, jobName: definition.name, runId, triggeredBy, status: 'success' })
    return { job: definition, runId, status: 'success', output, nextRunAt }
  } catch (error) {
    const nextRunAt = await resolveNextRun(pool, definition).catch(() => null)
    if (isScheduledJobCancellation(error, controller.signal)) {
      const output = error?.output || {
        cancelled: true,
        message: error?.message || 'Scheduled job cancellation requested',
      }
      if (runId) {
        await recordScheduledJobRunCompleted(pool, definition, { runId, status: 'cancelled', output, nextRunAt })
      }
      logScheduledJob('scheduled_job_run_cancelled', {
        correlationId,
        requestCorrelationId: active.cancelRequestCorrelationId || null,
        jobId: definition.id,
        jobName: definition.name,
        runId,
        triggeredBy,
        status: 'cancelled',
        output,
        nextRunAt: nextRunAt?.toISOString?.() || null,
      })
      logApi('scheduled_job_run_cancelled', {
        correlationId,
        requestCorrelationId: active.cancelRequestCorrelationId || null,
        jobId: definition.id,
        jobName: definition.name,
        runId,
        triggeredBy,
        status: 'cancelled',
      })
      return { job: definition, runId, status: 'cancelled', output, nextRunAt }
    }

    const errorMessage = error?.message || String(error)
    const failureOutput = error?.output || null
    if (runId) {
      await recordScheduledJobRunCompleted(pool, definition, { runId, status: 'failed', output: failureOutput, errorMessage, nextRunAt })
    }
    logScheduledJob('scheduled_job_run_failed', { correlationId, jobId: definition.id, jobName: definition.name, runId, triggeredBy, status: 'failed', output: failureOutput, error: errorMessage, nextRunAt: nextRunAt?.toISOString?.() || null })
    logError('Scheduled job run failed', { correlationId, jobId: definition.id, jobName: definition.name, runId, triggeredBy, error })
    throw error
  } finally {
    if (activeJobRuns.get(jobId) === active) activeJobRuns.delete(jobId)
  }
}

export function startScheduledJobRunner(getPool, {
  logApi = () => {},
  logError = () => {},
  logInfo = () => {},
  logScheduledJob = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => new Date(),
} = {}) {
  let stopped = false
  const timers = new Map()
  const scheduleTokens = new Map()

  const clearDefinitionTimer = (jobId) => {
    const existing = timers.get(jobId)
    if (existing) clearTimer(existing)
    timers.delete(jobId)
  }

  const scheduleDefinition = async (definition) => {
    if (stopped) return null
    clearDefinitionTimer(definition.id)
    const token = Symbol(definition.id)
    scheduleTokens.set(definition.id, token)

    try {
      const db = getPool()
      const record = await resolveRuntimeRecord(db, definition)
      if (stopped || scheduleTokens.get(definition.id) !== token) return null

      const current = now()
      const nextRun = getNextRunForDefinition(definition, record.schedule, current)
      await updateScheduledJobNextRun(db, definition, nextRun)
      if (stopped || scheduleTokens.get(definition.id) !== token) return nextRun

      const scheduleDetails = {
        correlationId: null,
        jobId: definition.id,
        jobName: definition.name,
        schedule: record.scheduleLabel || scheduleLabel(record.schedule),
        timeZone: definition.scheduleTimeZone || null,
        nextRunAt: nextRun?.toISOString?.() || null,
      }

      if (!nextRun) {
        logInfo('Scheduled job set to manual mode', scheduleDetails)
        logScheduledJob('scheduled_job_manual_mode', scheduleDetails)
        return null
      }

      logInfo('Scheduled job scheduled', scheduleDetails)
      logScheduledJob('scheduled_job_scheduled', scheduleDetails)

      const requestedDelayMs = Math.max(0, nextRun.getTime() - current.getTime())
      const delayMs = Math.min(requestedDelayMs, MAX_TIMER_DELAY_MS)
      const timer = setTimer(async () => {
        if (stopped || scheduleTokens.get(definition.id) !== token) return
        timers.delete(definition.id)

        const firedAt = now()
        if (firedAt.getTime() + 1000 < nextRun.getTime()) {
          await scheduleDefinition(definition)
          return
        }

        const correlationId = `scheduled-job-${definition.id}-${randomUUID()}`
        try {
          await runScheduledJob(getPool(), definition.id, { triggeredBy: 'scheduled', correlationId, logApi, logError, logScheduledJob })
        } catch (error) {
          if (error?.code === 'SCHEDULED_JOB_ALREADY_RUNNING') {
            logScheduledJob('scheduled_job_timer_skipped_already_running', { correlationId, jobId: definition.id, jobName: definition.name, level: 'warn' })
          } else {
            logError('Scheduled job timer run failed', { correlationId, jobId: definition.id, error })
          }
        } finally {
          if (!stopped) await scheduleDefinition(definition)
        }
      }, delayMs)

      if (typeof timer?.unref === 'function') timer.unref()
      timers.set(definition.id, timer)
      return nextRun
    } catch (error) {
      logError('Scheduled job scheduling failed', { correlationId: null, jobId: definition.id, error })
      logScheduledJob('scheduled_job_scheduling_failed', { correlationId: null, jobId: definition.id, jobName: definition.name, level: 'error', error: error?.message || String(error) })
      return null
    }
  }

  for (const definition of SCHEDULED_JOB_DEFINITIONS) void scheduleDefinition(definition)

  return {
    async reschedule(jobId) {
      const definition = findScheduledJobDefinition(jobId)
      if (!definition) throw new Error(`Scheduled job not found: ${jobId}`)
      return scheduleDefinition(definition)
    },
    stop() {
      stopped = true
      for (const timer of timers.values()) clearTimer(timer)
      timers.clear()
      scheduleTokens.clear()
    },
  }
}
