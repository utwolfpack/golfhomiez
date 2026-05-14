import { randomUUID } from 'crypto'
import {
  CANCELLED_TOURNAMENT_CLEANUP_TIME_ZONE,
  deleteCancelledTournaments,
  nextCancelledTournamentCleanupRun,
} from './cancelled-tournament-cleanup.js'
import {
  listScheduledJobRecords,
  recordScheduledJobRunCompleted,
  recordScheduledJobRunStarted,
  upsertScheduledJobDefinition,
  upsertScheduledJobDefinitions,
} from './scheduled-job-store.js'

export const SCHEDULED_JOB_DEFINITIONS = [
  {
    id: 'cancelled-tournament-cleanup',
    name: 'Cancelled tournament cleanup',
    description: 'Deletes tournaments marked cancelled and safely removes tournament registration and organizer invite records that belong to those tournaments.',
    scheduleLabel: 'Sunday 18:00 MT',
    scheduleTimeZone: CANCELLED_TOURNAMENT_CLEANUP_TIME_ZONE,
    getNextRunAt: nextCancelledTournamentCleanupRun,
    async run({ pool, correlationId, logApi, logError }) {
      return deleteCancelledTournaments(pool, { correlationId, logApi, logError })
    },
  },
]

function findScheduledJobDefinition(jobId) {
  return SCHEDULED_JOB_DEFINITIONS.find((definition) => definition.id === jobId) || null
}

function getNextRunForDefinition(definition, now = new Date()) {
  return typeof definition.getNextRunAt === 'function' ? definition.getNextRunAt(now) : null
}

export async function listScheduledJobs(pool, now = new Date()) {
  return listScheduledJobRecords(pool, SCHEDULED_JOB_DEFINITIONS, now)
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

  await upsertScheduledJobDefinitions(pool, SCHEDULED_JOB_DEFINITIONS)
  const { runId } = await recordScheduledJobRunStarted(pool, definition, { triggeredBy, correlationId, adminUser })
  logScheduledJob('scheduled_job_run_started', { correlationId, jobId: definition.id, jobName: definition.name, runId, triggeredBy, adminUserId: adminUser?.id || null, adminUserEmail: adminUser?.email || null })
  logApi('scheduled_job_run_started', { correlationId, jobId: definition.id, jobName: definition.name, runId, triggeredBy, adminUserId: adminUser?.id || null })

  try {
    const output = await definition.run({ pool, correlationId, logApi, logError, logScheduledJob })
    const nextRunAt = getNextRunForDefinition(definition)
    await recordScheduledJobRunCompleted(pool, definition, { runId, status: 'success', output, nextRunAt })
    logScheduledJob('scheduled_job_run_completed', { correlationId, jobId: definition.id, jobName: definition.name, runId, triggeredBy, status: 'success', output, nextRunAt: nextRunAt?.toISOString?.() || null })
    logApi('scheduled_job_run_completed', { correlationId, jobId: definition.id, jobName: definition.name, runId, triggeredBy, status: 'success' })
    return { job: definition, runId, status: 'success', output, nextRunAt }
  } catch (error) {
    const nextRunAt = getNextRunForDefinition(definition)
    const errorMessage = error?.message || String(error)
    await recordScheduledJobRunCompleted(pool, definition, { runId, status: 'failed', errorMessage, nextRunAt })
    logScheduledJob('scheduled_job_run_failed', { correlationId, jobId: definition.id, jobName: definition.name, runId, triggeredBy, status: 'failed', error: errorMessage, nextRunAt: nextRunAt?.toISOString?.() || null })
    logError('Scheduled job run failed', { correlationId, jobId: definition.id, jobName: definition.name, runId, triggeredBy, error })
    throw error
  }
}

export function startScheduledJobRunner(getPool, { logApi = () => {}, logError = () => {}, logInfo = () => {}, logScheduledJob = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, now = () => new Date() } = {}) {
  let stopped = false
  const timers = new Map()

  const scheduleDefinition = (definition) => {
    if (stopped) return
    const current = now()
    const nextRun = getNextRunForDefinition(definition, current)
    const delayMs = nextRun ? Math.max(0, nextRun.getTime() - current.getTime()) : 0

    Promise.resolve()
      .then(async () => upsertScheduledJobDefinition(getPool(), definition, nextRun))
      .catch((error) => logError('Scheduled job metadata update failed', { correlationId: null, jobId: definition.id, error }))

    logInfo('Scheduled job scheduled', {
      correlationId: null,
      jobId: definition.id,
      jobName: definition.name,
      schedule: definition.scheduleLabel,
      timeZone: definition.scheduleTimeZone || null,
      nextRunAt: nextRun?.toISOString?.() || null,
    })
    logScheduledJob('scheduled_job_scheduled', {
      correlationId: null,
      jobId: definition.id,
      jobName: definition.name,
      schedule: definition.scheduleLabel,
      timeZone: definition.scheduleTimeZone || null,
      nextRunAt: nextRun?.toISOString?.() || null,
    })

    const timer = setTimer(async () => {
      const correlationId = `scheduled-job-${definition.id}-${randomUUID()}`
      try {
        await runScheduledJob(getPool(), definition.id, { triggeredBy: 'scheduled', correlationId, logApi, logError, logScheduledJob })
      } catch (error) {
        logError('Scheduled job timer run failed', { correlationId, jobId: definition.id, error })
      } finally {
        scheduleDefinition(definition)
      }
    }, delayMs)

    if (typeof timer?.unref === 'function') timer.unref()
    timers.set(definition.id, timer)
  }

  for (const definition of SCHEDULED_JOB_DEFINITIONS) scheduleDefinition(definition)

  return {
    stop() {
      stopped = true
      for (const timer of timers.values()) clearTimer(timer)
      timers.clear()
    },
  }
}
