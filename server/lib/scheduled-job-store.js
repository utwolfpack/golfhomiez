import { randomUUID } from 'crypto'
import { databaseScheduleFromRow, scheduleDatabaseValues } from './scheduled-job-schedule.js'

function toMysqlDateTime(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function safeJson(value) {
  if (value == null) return null
  try {
    return JSON.stringify(value)
  } catch (error) {
    return JSON.stringify({ serializationError: error?.message || String(error) })
  }
}

function parseJson(value) {
  if (value == null || value === '') return null
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function durationMs(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null
  const start = new Date(startedAt).getTime()
  const end = new Date(completedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return end - start
}

function defaultJobConfig(definition) {
  return definition.defaultJobConfig && typeof definition.defaultJobConfig === 'object'
    ? definition.defaultJobConfig
    : {}
}

function serializeJobRow(row, definition = null) {
  const fallbackSchedule = definition?.defaultSchedule || { type: 'manual' }
  const schedule = databaseScheduleFromRow(row, fallbackSchedule)
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    scheduleLabel: row.schedule_label,
    scheduleTimeZone: row.schedule_time_zone,
    schedule,
    jobConfig: parseJson(row.job_config_json) || defaultJobConfig(definition),
    createdAt: row.created_at,
    nextRunAt: row.next_run_at,
    updatedAt: row.updated_at,
    lastRun: row.last_run_id ? {
      id: row.last_run_id,
      triggeredBy: row.last_run_triggered_by,
      status: row.last_run_status,
      startedAt: row.last_run_started_at,
      completedAt: row.last_run_completed_at,
      durationMs: durationMs(row.last_run_started_at, row.last_run_completed_at),
      output: parseJson(row.last_run_output_json),
      error: row.last_run_error,
      correlationId: row.run_correlation_id || null,
      adminUserEmail: row.run_admin_user_email || null,
    } : null,
  }
}

export async function ensureScheduledJobsSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id VARCHAR(80) NOT NULL PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      description TEXT NULL,
      schedule_label VARCHAR(191) NOT NULL,
      schedule_time_zone VARCHAR(64) NULL,
      schedule_type VARCHAR(16) NOT NULL DEFAULT 'manual',
      schedule_time TIME NULL,
      schedule_day_of_week TINYINT UNSIGNED NULL,
      schedule_day_of_month TINYINT UNSIGNED NULL,
      job_config_json LONGTEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      next_run_at DATETIME NULL,
      last_run_id VARCHAR(64) NULL,
      last_run_triggered_by VARCHAR(32) NULL,
      last_run_status VARCHAR(32) NULL,
      last_run_started_at DATETIME NULL,
      last_run_completed_at DATETIME NULL,
      last_run_output_json LONGTEXT NULL,
      last_run_error TEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_scheduled_jobs_next_run_at (next_run_at),
      INDEX idx_scheduled_jobs_last_status (last_run_status),
      INDEX idx_scheduled_jobs_schedule_type (schedule_type)
    );

    CREATE TABLE IF NOT EXISTS scheduled_job_runs (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      job_id VARCHAR(80) NOT NULL,
      triggered_by VARCHAR(32) NOT NULL,
      status VARCHAR(32) NOT NULL,
      correlation_id VARCHAR(128) NULL,
      admin_user_id VARCHAR(191) NULL,
      admin_user_email VARCHAR(191) NULL,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME NULL,
      output_json LONGTEXT NULL,
      error_message TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_scheduled_job_runs_job_started (job_id, started_at),
      INDEX idx_scheduled_job_runs_correlation_id (correlation_id)
    );
  `)
}

export async function upsertScheduledJobDefinition(db, definition, nextRunAt = null) {
  await ensureScheduledJobsSchema(db)
  const scheduleValues = scheduleDatabaseValues(definition.defaultSchedule || { type: 'manual' })
  await db.execute(
    `INSERT INTO scheduled_jobs
      (id, name, description, schedule_label, schedule_time_zone, schedule_type, schedule_time,
       schedule_day_of_week, schedule_day_of_month, job_config_json, next_run_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       description = VALUES(description),
       schedule_time_zone = VALUES(schedule_time_zone)`,
    [
      definition.id,
      definition.name,
      definition.description,
      definition.defaultScheduleLabel || scheduleValues.label,
      definition.scheduleTimeZone || null,
      scheduleValues.type,
      scheduleValues.time,
      scheduleValues.dayOfWeek,
      scheduleValues.dayOfMonth,
      safeJson(defaultJobConfig(definition)),
      toMysqlDateTime(nextRunAt),
    ],
  )
}

export async function upsertScheduledJobDefinitions(db, definitions, now = new Date()) {
  await ensureScheduledJobsSchema(db)
  for (const definition of definitions) {
    const nextRunAt = typeof definition.getDefaultNextRunAt === 'function' ? definition.getDefaultNextRunAt(now) : null
    await upsertScheduledJobDefinition(db, definition, nextRunAt)
  }
}

export async function getScheduledJobRecord(db, definition) {
  await upsertScheduledJobDefinition(db, definition)
  const result = await db.execute(
    `SELECT j.*,
            r.correlation_id AS run_correlation_id,
            r.admin_user_email AS run_admin_user_email
       FROM scheduled_jobs j
       LEFT JOIN scheduled_job_runs r ON r.id = j.last_run_id
      WHERE j.id = ?
      LIMIT 1`,
    [definition.id],
  )
  const rows = Array.isArray(result?.[0]) ? result[0] : []
  const row = rows[0]
  return row ? serializeJobRow(row, definition) : null
}

export async function updateScheduledJobConfiguration(db, definition, { schedule, jobConfig, nextRunAt = null } = {}) {
  await upsertScheduledJobDefinition(db, definition)
  const values = scheduleDatabaseValues(schedule || definition.defaultSchedule || { type: 'manual' })
  await db.execute(
    `UPDATE scheduled_jobs
        SET schedule_label = ?,
            schedule_type = ?,
            schedule_time = ?,
            schedule_day_of_week = ?,
            schedule_day_of_month = ?,
            job_config_json = ?,
            next_run_at = ?
      WHERE id = ?`,
    [
      values.label,
      values.type,
      values.time,
      values.dayOfWeek,
      values.dayOfMonth,
      safeJson(jobConfig || {}),
      toMysqlDateTime(nextRunAt),
      definition.id,
    ],
  )
  return getScheduledJobRecord(db, definition)
}

export async function updateScheduledJobNextRun(db, definition, nextRunAt = null) {
  await upsertScheduledJobDefinition(db, definition)
  await db.execute(
    `UPDATE scheduled_jobs SET next_run_at = ? WHERE id = ?`,
    [toMysqlDateTime(nextRunAt), definition.id],
  )
}

export async function recordScheduledJobRunStarted(db, definition, { triggeredBy, correlationId, adminUser = null } = {}) {
  await ensureScheduledJobsSchema(db)
  const runId = randomUUID()
  const startedAt = new Date()
  await db.execute(
    `INSERT INTO scheduled_job_runs (id, job_id, triggered_by, status, correlation_id, admin_user_id, admin_user_email, started_at)
     VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
    [
      runId,
      definition.id,
      triggeredBy || 'scheduled',
      correlationId || null,
      adminUser?.id || null,
      adminUser?.email || null,
      toMysqlDateTime(startedAt),
    ],
  )
  await db.execute(
    `UPDATE scheduled_jobs
        SET last_run_id = ?,
            last_run_triggered_by = ?,
            last_run_status = 'running',
            last_run_started_at = ?,
            last_run_completed_at = NULL,
            last_run_output_json = NULL,
            last_run_error = NULL
      WHERE id = ?`,
    [runId, triggeredBy || 'scheduled', toMysqlDateTime(startedAt), definition.id],
  )
  return { runId, startedAt }
}

export async function recordScheduledJobRunCancellationRequested(db, definition, { runId } = {}) {
  if (!runId) return { cancellationRequested: false }
  await ensureScheduledJobsSchema(db)
  const [runResult] = await db.execute(
    `UPDATE scheduled_job_runs
        SET status = 'cancel_requested'
      WHERE id = ? AND job_id = ? AND status = 'running'`,
    [runId, definition.id],
  )
  await db.execute(
    `UPDATE scheduled_jobs
        SET last_run_status = 'cancel_requested'
      WHERE id = ? AND last_run_id = ? AND last_run_status = 'running'`,
    [definition.id, runId],
  )
  return { cancellationRequested: Number(runResult?.affectedRows || 0) > 0 }
}

export async function recordScheduledJobRunCompleted(db, definition, { runId, status, output = null, errorMessage = null, nextRunAt = null } = {}) {
  await ensureScheduledJobsSchema(db)
  const completedAt = new Date()
  const outputJson = safeJson(output)
  await db.execute(
    `UPDATE scheduled_job_runs
        SET status = ?, completed_at = ?, output_json = ?, error_message = ?
      WHERE id = ?`,
    [status, toMysqlDateTime(completedAt), outputJson, errorMessage || null, runId],
  )
  await db.execute(
    `UPDATE scheduled_jobs
        SET last_run_status = ?,
            last_run_completed_at = ?,
            last_run_output_json = ?,
            last_run_error = ?,
            next_run_at = ?
      WHERE id = ?`,
    [status, toMysqlDateTime(completedAt), outputJson, errorMessage || null, toMysqlDateTime(nextRunAt), definition.id],
  )
  return { completedAt }
}

export async function listScheduledJobRecords(db, definitions, now = new Date()) {
  await upsertScheduledJobDefinitions(db, definitions, now)
  const [rows] = await db.execute(
    `SELECT j.*,
            r.correlation_id AS run_correlation_id,
            r.admin_user_email AS run_admin_user_email
       FROM scheduled_jobs j
       LEFT JOIN scheduled_job_runs r ON r.id = j.last_run_id
      ORDER BY j.name ASC`,
  )
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))
  return rows
    .filter((row) => definitionsById.has(row.id))
    .map((row) => serializeJobRow(row, definitionsById.get(row.id)))
}
