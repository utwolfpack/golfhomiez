import { randomUUID } from 'node:crypto'

function toMysqlDateTime(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function serializePublication(row) {
  if (!row) return null
  return {
    id: row.id,
    scheduledJobRunId: row.scheduled_job_run_id,
    jobId: row.job_id,
    platform: row.platform,
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    sourceFileRelativePath: row.source_file_relative_path,
    title: row.title || null,
    caption: row.caption || null,
    platformMediaId: row.platform_media_id || null,
    platformPostId: row.platform_post_id || null,
    platformUrl: row.platform_url || null,
    errorMessage: row.error_message || null,
    nextAttemptAt: row.next_attempt_at || null,
    publishedAt: row.published_at || null,
    correlationId: row.correlation_id || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

export async function getSocialPublication(db, runId, platform) {
  const [rows] = await db.execute(
    'SELECT * FROM social_publications WHERE scheduled_job_run_id = ? AND platform = ? LIMIT 1',
    [String(runId || '').trim(), String(platform || '').trim()],
  )
  return serializePublication(rows?.[0] || null)
}

export async function ensureSocialPublication(db, input) {
  const existing = await getSocialPublication(db, input.scheduledJobRunId, input.platform)
  if (existing) return existing
  const id = randomUUID()
  await db.execute(
    `INSERT INTO social_publications
      (id, scheduled_job_run_id, job_id, platform, status, attempt_count, source_file_relative_path,
       title, caption, next_attempt_at, correlation_id)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [
      id,
      input.scheduledJobRunId,
      input.jobId,
      input.platform,
      input.status || 'pending',
      input.sourceFileRelativePath,
      input.title || null,
      input.caption || null,
      toMysqlDateTime(input.nextAttemptAt),
      input.correlationId || null,
    ],
  )
  return getSocialPublication(db, input.scheduledJobRunId, input.platform)
}

export async function updateSocialPublication(db, id, input = {}) {
  const mapping = {
    status: 'status',
    attemptCount: 'attempt_count',
    platformMediaId: 'platform_media_id',
    platformPostId: 'platform_post_id',
    platformUrl: 'platform_url',
    errorMessage: 'error_message',
    nextAttemptAt: 'next_attempt_at',
    publishedAt: 'published_at',
    correlationId: 'correlation_id',
    title: 'title',
    caption: 'caption',
  }
  const assignments = []
  const values = []
  for (const [key, column] of Object.entries(mapping)) {
    if (!(key in input)) continue
    assignments.push(`${column} = ?`)
    values.push(key.endsWith('At') ? toMysqlDateTime(input[key]) : input[key])
  }
  if (!assignments.length) return null
  values.push(id)
  await db.execute(`UPDATE social_publications SET ${assignments.join(', ')} WHERE id = ?`, values)
  const [rows] = await db.execute('SELECT * FROM social_publications WHERE id = ? LIMIT 1', [id])
  return serializePublication(rows?.[0] || null)
}

export async function listSocialPublicationsForRuns(db, runIds = []) {
  const ids = [...new Set((runIds || []).map((value) => String(value || '').trim()).filter(Boolean))]
  const result = new Map()
  if (!ids.length) return result
  const placeholders = ids.map(() => '?').join(', ')
  const [rows] = await db.execute(
    `SELECT * FROM social_publications WHERE scheduled_job_run_id IN (${placeholders}) ORDER BY created_at ASC`,
    ids,
  )
  for (const row of rows || []) {
    const publication = serializePublication(row)
    if (!result.has(publication.scheduledJobRunId)) result.set(publication.scheduledJobRunId, [])
    result.get(publication.scheduledJobRunId).push(publication)
  }
  return result
}

export async function listRetryableSocialPublications(db, { limit = 20 } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit || 20)))
  const [rows] = await db.execute(
    `SELECT * FROM social_publications
      WHERE status = 'retry_pending'
        AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
      ORDER BY COALESCE(next_attempt_at, created_at) ASC
      LIMIT ${safeLimit}`,
  )
  return (rows || []).map(serializePublication)
}

export async function listSocialPublicationsForRun(db, runId) {
  const [rows] = await db.execute(
    'SELECT * FROM social_publications WHERE scheduled_job_run_id = ? ORDER BY platform ASC',
    [String(runId || '').trim()],
  )
  return (rows || []).map(serializePublication)
}
