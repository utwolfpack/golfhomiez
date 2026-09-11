import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import PageHero from '../components/PageHero'
import {
  cancelScheduledJob,
  fetchScheduledJobs,
  fetchSocialPublishingStatus,
  retrySocialPublications,
  runScheduledJob,
  updateScheduledJobSchedule,
  type ScheduledJob,
  type ScheduledJobSchedule,
  type SocialPublishingStatus,
} from '../lib/admin'
import { logFrontendEvent } from '../lib/frontend-logger'
import { formatFriendlyDateTime } from '../lib/time-format'
import { useAdminAuth } from '../context/AdminAuthContext'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function formatDate(value?: string | null) {
  return value ? formatFriendlyDateTime(value) : '—'
}

function formatDuration(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value < 0) return '—'
  const totalSeconds = Math.max(0, Math.round(value / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatRunOutput(output: unknown) {
  if (output == null || output === '') return '—'
  if (typeof output === 'string') return output
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

function statusClass(status?: string | null) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'success') return 'statusMessage statusSuccess'
  if (normalized === 'failed' || normalized === 'error') return 'statusMessage statusError'
  return 'statusMessage'
}


function formatBytes(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value < 0) return '—'
  if (value < 1024) return `${Math.round(value)} B`
  const kb = value / 1024
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
}

function formatCount(value?: number | null) {
  return value == null || !Number.isFinite(value) ? '—' : Math.max(0, Math.round(value)).toLocaleString()
}

function latestCommercialOutput(job: ScheduledJob) {
  const output = job.commercialMetadata?.latestSuccessfulRun?.output
  return output && typeof output === 'object' ? output : null
}

function outputNumber(output: Record<string, unknown> | null, key: string) {
  const value = output?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function outputString(output: Record<string, unknown> | null, key: string) {
  const value = output?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function CommercialJobMetadata({ job, onRetrySocial, retryingRunId }: { job: ScheduledJob; onRetrySocial: (job: ScheduledJob) => void; retryingRunId: string | null }) {
  const metadata = job.commercialMetadata
  if (!metadata) return null
  const quota = metadata.pexelsQuota
  const latest = metadata.latestOutput
  const output = latestCommercialOutput(job)
  const videos = Array.isArray(output?.videos) ? output.videos.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object')) : []
  const pexelsVideoCount = outputNumber(output, 'pexelsVideoCount') ?? videos.filter((video) => video.provider === 'Pexels').length
  const pexelsVisualCount = outputNumber(output, 'pexelsVisualCount') ?? 0
  const pexelsPhotoCount = outputNumber(output, 'pexelsPhotoCount') ?? 0
  const isGreatShots = job.id === 'createShortFormGreatShotsSmall'
  const isFunnyShots = job.id === 'createShortFormFunnyShotsSmall'
  const isCurrentEvents = job.id === 'createShortFormCurrentEventsSmall'
  const socialPublications = Array.isArray(metadata.socialPublications) ? metadata.socialPublications : []
  const retryableSocial = socialPublications.some((publication) => ['failed', 'retry_pending'].includes(String(publication.status || '').toLowerCase()))

  return (
    <div className="small" style={{ marginTop: 10, padding: 10, border: '1px solid rgba(15, 23, 42, 0.14)', borderRadius: 8, minWidth: 260, maxWidth: 390, background: 'rgba(248, 250, 252, 0.82)' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Commercial metadata</div>
      {metadata.pexelsConfigured ? (
        quota?.remaining != null || quota?.limit != null ? (
          <>
            <div><strong>Pexels:</strong> {formatCount(quota.remaining)} / {formatCount(quota.limit)} requests remaining</div>
            {quota.used != null ? <div>{formatCount(quota.used)} requests used in the current monthly period.</div> : null}
            {quota.resetAt ? <div>Quota resets {formatDate(quota.resetAt)}.</div> : null}
            {quota.capturedAt ? <div>Usage checked {formatDate(quota.capturedAt)}.</div> : null}
          </>
        ) : <div><strong>Pexels:</strong> configured; usage will appear after the next successful Pexels API request.</div>
      ) : <div><strong>Pexels:</strong> not configured. Add <code>PEXELS_API_KEY</code> to the server .env file.</div>}

      {latest ? (
        <div style={{ marginTop: 8 }}>
          <div><strong>Latest MP4:</strong> {latest.fileName}</div>
          <div>{latest.durationSeconds ? `${latest.durationSeconds}s` : 'Duration —'}{latest.resolution ? ` · ${latest.resolution}` : ''}{latest.bytes ? ` · ${formatBytes(latest.bytes)}` : ''}</div>
          {latest.completedAt ? <div>Generated {formatDate(latest.completedAt)}.</div> : null}
          <a
            className="btn btnSmall"
            href={latest.downloadUrl}
            style={{ display: 'inline-block', marginTop: 7 }}
            onClick={() => logFrontendEvent({ category: 'admin.scheduled_jobs', message: 'scheduled_job_latest_mp4_download_clicked', data: { jobId: job.id, jobName: job.name, runId: latest.runId || null, fileName: latest.fileName } })}
          >
            Download latest MP4
          </a>
        </div>
      ) : <div style={{ marginTop: 8 }}><strong>Latest MP4:</strong> none generated successfully yet.</div>}

      {(isGreatShots || isFunnyShots) && output ? (
        <div style={{ marginTop: 8 }}>
          <div><strong>Selection:</strong> {outputString(output, 'selectionMode') || '—'}</div>
          <div><strong>Pexels clips:</strong> {formatCount(pexelsVideoCount)}</div>
          {isFunnyShots ? <div><strong>Content:</strong> funny golf shots</div> : null}
          {output?.backgroundMusic && typeof output.backgroundMusic === 'object' ? <div><strong>Music:</strong> Golf Homiez for Golf Courses</div> : null}
          {videos.length ? <div><strong>Providers:</strong> {[...new Set(videos.map((video) => String(video.provider || '')).filter(Boolean))].join(', ')}</div> : null}
        </div>
      ) : null}

      {isCurrentEvents && output ? (
        <div style={{ marginTop: 8 }}>
          <div><strong>Topic:</strong> {outputString(output, 'topic') || 'GolfHomiez golf theme'}</div>
          <div><strong>Pexels visuals:</strong> {formatCount(pexelsVisualCount)} ({formatCount(pexelsPhotoCount)} photo, {formatCount(outputNumber(output, 'pexelsVideoCount') ?? 0)} video)</div>
          <div><strong>News sources:</strong> {formatCount(outputNumber(output, 'successfulSourceCount'))} successful</div>
        </div>
      ) : null}

      <div style={{ marginTop: 8 }}>
        <div><strong>Social publishing:</strong> {metadata.socialAutoPublishEnabled ? 'automatic (.env credentials)' : 'disabled'}</div>
        {Object.values(metadata.socialProviderConfiguration || {}).map((provider) => (
          <div key={provider.platform}>
            <strong>{provider.label} config:</strong>{' '}
            {provider.enabled ? (provider.configured ? `configured (${provider.credentialSource || 'server .env'})` : `missing ${provider.missing.join(', ')}`) : 'disabled'}
          </div>
        ))}
        {socialPublications.length ? socialPublications.map((publication) => (
          <div key={publication.platform} style={{ marginTop: 3 }}>
            <strong>{publication.platform.charAt(0).toUpperCase() + publication.platform.slice(1)}:</strong>{' '}
            {publication.status || 'pending'}
            {publication.platformUrl ? <> · <a href={publication.platformUrl} target="_blank" rel="noreferrer">View post</a></> : null}
            {publication.nextAttemptAt ? <> · retry {formatDate(publication.nextAttemptAt)}</> : null}
            {publication.errorMessage ? <div style={{ color: '#b91c1c' }}>{publication.errorMessage}</div> : null}
          </div>
        )) : metadata.socialAutoPublishEnabled && latest ? <div>Waiting for connected social accounts or the first publish attempt.</div> : null}
        {retryableSocial && latest?.runId ? (
          <button className="btn btnSmall" type="button" style={{ marginTop: 6 }} onClick={() => onRetrySocial(job)} disabled={retryingRunId === latest.runId}>
            {retryingRunId === latest.runId ? 'Retrying…' : 'Retry failed social posts'}
          </button>
        ) : null}
      </div>

      <div style={{ marginTop: 8 }}>
        <a href="https://www.pexels.com" target="_blank" rel="noreferrer">Media provided by Pexels</a>
      </div>
    </div>
  )
}

function SocialPublishingConfiguration({ status }: { status: SocialPublishingStatus | null }) {
  if (!status) return null
  const rows = Object.values(status.providers)

  return (
    <section className="card" style={{ padding: 18, marginBottom: 16 }}>
      <div>
        <h2 style={{ margin: 0 }}>Social publishing configuration</h2>
        <div className="small">
          Automatic publishing is <strong>{status.autoPublishEnabled ? 'enabled' : 'disabled'}</strong>. Credentials are read from the server .env file and secret values are never returned to this page.
        </div>
      </div>
      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        {rows.map((row) => {
          return (
            <div key={row.platform} style={{ borderTop: '1px solid rgba(15, 23, 42, 0.10)', paddingTop: 10 }}>
              <div>
                <strong>{row.label}</strong>{' '}
                <span className="small">{!row.enabled ? 'Disabled' : row.configured ? 'Configured' : 'Configuration incomplete'}</span>
                {row.accountName ? <div className="small">{row.accountName}</div> : null}
                {row.accountId ? <div className="small">Account ID: {row.accountId}</div> : null}
                {row.configured && row.credentialSource ? <div className="small">Credential source: {row.credentialSource}</div> : null}
                {!row.configured ? <div className="small">Missing server .env value: {row.missing.join(', ') || 'provider credentials'}</div> : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function initialSchedule(job: ScheduledJob): ScheduledJobSchedule {
  if (job.schedule) return job.schedule
  return { type: 'manual', time: null, dayOfWeek: null, dayOfMonth: null }
}

export default function AdminScheduledJobs() {
  const { adminUser } = useAdminAuth()
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [runningJobId, setRunningJobId] = useState<string | null>(null)
  const [cancelingJobId, setCancelingJobId] = useState<string | null>(null)
  const [scheduleJob, setScheduleJob] = useState<ScheduledJob | null>(null)
  const [schedule, setSchedule] = useState<ScheduledJobSchedule>({ type: 'manual', time: '02:00', dayOfWeek: 0, dayOfMonth: 1 })
  const [scrubValues, setScrubValues] = useState<string[]>([])
  const [scrubValueInput, setScrubValueInput] = useState('')
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [socialStatus, setSocialStatus] = useState<SocialPublishingStatus | null>(null)
  const [retryingSocialRunId, setRetryingSocialRunId] = useState<string | null>(null)

  const sortedJobs = useMemo(() => [...jobs].sort((a, b) => a.name.localeCompare(b.name)), [jobs])

  async function loadJobs() {
    setError(null)
    try {
      logFrontendEvent({ category: 'admin.scheduled_jobs', message: 'scheduled_jobs_load_started', data: { route: '/golfadmin/scheduled-jobs' } })
      const [result, social] = await Promise.all([fetchScheduledJobs(), fetchSocialPublishingStatus()])
      setJobs(result.jobs || [])
      setSocialStatus(social)
      logFrontendEvent({ category: 'admin.scheduled_jobs', message: 'scheduled_jobs_load_completed', data: { jobCount: result.jobs?.length || 0, socialAutoPublishEnabled: social.autoPublishEnabled } })
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not load scheduled jobs.'
      setError(text)
      logFrontendEvent({ category: 'admin.scheduled_jobs', level: 'error', message: 'scheduled_jobs_load_failed', data: { error: text } })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadJobs()
  }, [])

  async function onRetrySocial(job: ScheduledJob) {
    const runId = job.commercialMetadata?.latestOutput?.runId
    if (!runId) return
    setRetryingSocialRunId(runId)
    setError(null)
    try {
      logFrontendEvent({ category: 'admin.social_publishing', message: 'social_retry_started', data: { jobId: job.id, runId } })
      const result = await retrySocialPublications(runId)
      setJobs(result.jobs || [])
      setMessage(`Social publishing retry completed for ${job.name}.`)
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not retry social publications.'
      setError(text)
      logFrontendEvent({ category: 'admin.social_publishing', level: 'error', message: 'social_retry_failed', data: { jobId: job.id, runId, error: text } })
    } finally {
      setRetryingSocialRunId(null)
      void loadJobs()
    }
  }

  async function onRunJob(job: ScheduledJob) {
    const confirmed = typeof window === 'undefined' ? true : window.confirm(`Run scheduled job now: ${job.name}?`)
    if (!confirmed) return
    setRunningJobId(job.id)
    setError(null)
    setMessage(null)
    try {
      logFrontendEvent({ category: 'admin.scheduled_jobs', message: 'scheduled_job_manual_run_started', data: { jobId: job.id, jobName: job.name } })
      const result = await runScheduledJob(job.id)
      setJobs(result.jobs || [])
      if (result.result.status === 'running') {
        setMessage(`${job.name} started in the background. Refresh jobs to monitor progress or use Cancel job to stop it.`)
        logFrontendEvent({ category: 'admin.scheduled_jobs', message: 'scheduled_job_background_run_accepted', data: { jobId: job.id, jobName: job.name, status: result.result.status, runId: result.result.runId, correlationId: result.result.correlationId } })
      } else {
        setMessage(`${job.name} completed with status: ${result.result.status}.`)
        logFrontendEvent({ category: 'admin.scheduled_jobs', message: 'scheduled_job_manual_run_completed', data: { jobId: job.id, jobName: job.name, status: result.result.status, runId: result.result.runId, correlationId: result.result.correlationId } })
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not run scheduled job.'
      setError(text)
      logFrontendEvent({ category: 'admin.scheduled_jobs', level: 'error', message: 'scheduled_job_manual_run_failed', data: { jobId: job.id, jobName: job.name, error: text } })
    } finally {
      setRunningJobId(null)
      setCancelingJobId(null)
      void loadJobs()
    }
  }

  async function onCancelJob(job: ScheduledJob) {
    const confirmed = typeof window === 'undefined' ? true : window.confirm(`Cancel the running job: ${job.name}?`)
    if (!confirmed) return
    setCancelingJobId(job.id)
    setError(null)
    setMessage(null)
    try {
      logFrontendEvent({ category: 'admin.scheduled_jobs', message: 'scheduled_job_cancel_started', data: { jobId: job.id, jobName: job.name, runId: job.activeRunId || job.lastRun?.id || null } })
      const result = await cancelScheduledJob(job.id)
      setJobs(result.jobs || [])
      setMessage(`Cancellation requested for ${job.name}. The job will stop at the next safe cancellation point.`)
      logFrontendEvent({ category: 'admin.scheduled_jobs', message: 'scheduled_job_cancel_requested', data: { jobId: job.id, jobName: job.name, status: result.result.status, runId: result.result.runId || null } })
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not cancel scheduled job.'
      setError(text)
      logFrontendEvent({ category: 'admin.scheduled_jobs', level: 'error', message: 'scheduled_job_cancel_failed', data: { jobId: job.id, jobName: job.name, error: text } })
    } finally {
      setCancelingJobId(null)
    }
  }

  function openSchedule(job: ScheduledJob) {
    const current = initialSchedule(job)
    setSchedule({
      type: current.type,
      time: current.time || '02:00',
      dayOfWeek: current.dayOfWeek ?? 0,
      dayOfMonth: current.dayOfMonth ?? 1,
    })
    setScrubValues(Array.isArray(job.jobConfig?.matchValues) ? job.jobConfig.matchValues.filter((value): value is string => typeof value === 'string') : [])
    setScrubValueInput('')
    setScheduleJob(job)
    setError(null)
    setMessage(null)
    logFrontendEvent({ category: 'admin.scheduled_jobs', message: 'scheduled_job_schedule_opened', data: { jobId: job.id, jobName: job.name, scheduleType: current.type } })
  }

  function addScrubValue() {
    const value = scrubValueInput.replace(/\s+/g, ' ').trim()
    if (!value) return
    if (!scrubValues.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      setScrubValues((current) => [...current, value])
    }
    setScrubValueInput('')
  }

  async function saveSchedule() {
    if (!scheduleJob) return
    setSavingSchedule(true)
    setError(null)
    try {
      const normalizedSchedule: ScheduledJobSchedule = {
        type: schedule.type,
        time: schedule.type === 'manual' ? null : schedule.time || '00:00',
        dayOfWeek: schedule.type === 'weekly' ? Number(schedule.dayOfWeek ?? 0) : null,
        dayOfMonth: schedule.type === 'monthly' ? Number(schedule.dayOfMonth ?? 1) : null,
      }
      const jobConfig = ['scrubTournaments', 'scrubGolfCourseEmails'].includes(scheduleJob.id)
        ? { ...(scheduleJob.jobConfig || {}), matchValues: scrubValues }
        : (scheduleJob.jobConfig || {})
      logFrontendEvent({ category: 'admin.scheduled_jobs', message: 'scheduled_job_schedule_save_started', data: { jobId: scheduleJob.id, jobName: scheduleJob.name, schedule: normalizedSchedule, scrubValueCount: scrubValues.length } })
      const result = await updateScheduledJobSchedule(scheduleJob.id, { schedule: normalizedSchedule, jobConfig })
      setJobs(result.jobs || [])
      setMessage(`${scheduleJob.name} schedule updated.`)
      logFrontendEvent({ category: 'admin.scheduled_jobs', message: 'scheduled_job_schedule_saved', data: { jobId: scheduleJob.id, jobName: scheduleJob.name, schedule: normalizedSchedule, scrubValueCount: scrubValues.length } })
      setScheduleJob(null)
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not update scheduled job schedule.'
      setError(text)
      logFrontendEvent({ category: 'admin.scheduled_jobs', level: 'error', message: 'scheduled_job_schedule_save_failed', data: { jobId: scheduleJob.id, jobName: scheduleJob.name, error: text } })
    } finally {
      setSavingSchedule(false)
    }
  }

  return (
    <div className="container pageStack" style={{ paddingTop: 28, paddingBottom: 28 }}>
      <div className="card pageCardShell" style={{ padding: 24 }}>
        <PageHero eyebrow="Administration" title="Scheduled jobs" subtitle="Review scheduled app jobs, configure schedules, inspect completed runtimes, manually run jobs, and cancel active jobs." />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div className="small">Signed in as <strong>{adminUser?.username}</strong> ({adminUser?.email})</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => void loadJobs()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh jobs'}</button>
            <Link className="btn" to="/golfadmin">Back to admin portal</Link>
          </div>
        </div>
        {message ? <p className="statusMessage statusSuccess">{message}</p> : null}
        {error ? <p className="statusMessage statusError">{error}</p> : null}
        <SocialPublishingConfiguration status={socialStatus} />
        <section className="card" style={{ padding: 18, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <h2 style={{ margin: 0 }}>All scheduled jobs</h2>
            <span className="pill">{sortedJobs.length} total</span>
          </div>
          <div className="scheduledJobsTableWrap">
            <table className="table scheduledJobsTable">
              <thead>
                <tr>
                  <th>Scheduled job</th>
                  <th>Actions</th>
                  <th>Description</th>
                  <th>Created</th>
                  <th>Completed</th>
                  <th>Next scheduled run</th>
                  <th>Last run</th>
                  <th>Last output/status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="small" style={{ padding: '18px 10px' }}>Loading scheduled jobs…</td></tr>
                ) : sortedJobs.length ? sortedJobs.map((job) => {
                  const lastRun = job.lastRun
                  const isCanceling = cancelingJobId === job.id || String(lastRun?.status || '').toLowerCase() === 'cancel_requested'
                  const isRunning = runningJobId === job.id || Boolean(job.canCancel) || isCanceling
                  return (
                    <tr key={job.id}>
                      <td data-label="Scheduled job" className="scheduledJobsNameCell">
                        <strong>{job.name}</strong>
                        <div className="small">{job.scheduleLabel || 'Manual'}{job.scheduleTimeZone ? ` · ${job.scheduleTimeZone}` : ''}</div>
                        {['scrubTournaments', 'scrubGolfCourseEmails'].includes(job.id) ? <div className="small">{job.jobConfig?.matchValues?.length || 0} scrub value(s)</div> : null}
                        {job.id === 'getGolfCourseData' ? (
                          <>
                            <div className="small">All US states + DC · fast mode · {String(job.jobConfig?.courseConcurrency || 8)} concurrent courses · bulk metadata + holes/tees enrichment</div>
                            <div className="small">Target: ~{String(job.jobConfig?.targetRunHours || 12)} hours. A full US run needs roughly two REST calls per course plus state validation, so use an OpenGolfAPI key with enough daily quota; the run output reports the exact estimate.</div>
                          </>
                        ) : null}
                        {job.commercialMetadata ? <CommercialJobMetadata job={job} onRetrySocial={(selected) => void onRetrySocial(selected)} retryingRunId={retryingSocialRunId} /> : null}
                      </td>
                      <td data-label="Actions" className="scheduledJobsActionsCell">
                        <div className="scheduledJobsActions">
                          {isRunning ? (
                            <button className="btnDanger" type="button" onClick={() => void onCancelJob(job)} disabled={isCanceling}>
                              {isCanceling ? 'Cancelling…' : 'Cancel job'}
                            </button>
                          ) : (
                            <button className="btnPrimary" type="button" onClick={() => void onRunJob(job)} disabled={Boolean(runningJobId) || Boolean(cancelingJobId)}>
                              Run now
                            </button>
                          )}
                          <button className="btn" type="button" onClick={() => openSchedule(job)}>Schedule</button>
                        </div>
                      </td>
                      <td data-label="Description">{job.description || '—'}</td>
                      <td data-label="Created">{formatDate(job.createdAt)}</td>
                      <td data-label="Completed">
                        <div>{formatDate(lastRun?.completedAt)}</div>
                        {lastRun?.completedAt ? <div className="small">Ran for {formatDuration(lastRun.durationMs)}</div> : null}
                      </td>
                      <td data-label="Next scheduled run">{job.schedule?.type === 'manual' ? 'Manual' : formatDate(job.nextRunAt)}</td>
                      <td data-label="Last run">
                        {lastRun ? (
                          <div>
                            <div>{formatDate(lastRun.startedAt)}</div>
                            <div className="small">Triggered by {lastRun.triggeredBy || '—'}{lastRun.adminUserEmail ? ` · ${lastRun.adminUserEmail}` : ''}</div>
                            <div className="small">Correlation ID: {lastRun.correlationId || '—'}</div>
                          </div>
                        ) : '—'}
                      </td>
                      <td data-label="Last output/status" className="scheduledJobsOutputCell">
                        <div className={statusClass(lastRun?.status)} style={{ margin: 0 }}>{lastRun?.status || 'Never run'}</div>
                        {lastRun?.error ? <div className="small" style={{ color: '#b91c1c', marginTop: 6 }}>{lastRun.error}</div> : null}
                        <pre className="small scheduledJobsOutput">{formatRunOutput(lastRun?.output)}</pre>
                      </td>
                    </tr>
                  )
                }) : (
                  <tr><td colSpan={8} className="small" style={{ padding: '18px 10px' }}>No scheduled jobs are registered.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {scheduleJob ? (
        <div className="modalOverlay" role="presentation" onClick={() => !savingSchedule && setScheduleJob(null)}>
          <section className="modalCard scheduledJobScheduleModal" role="dialog" aria-modal="true" aria-labelledby="scheduled-job-schedule-title" onClick={(event) => event.stopPropagation()}>
            <div className="scheduledJobScheduleHeader">
              <div>
                <h2 id="scheduled-job-schedule-title" style={{ margin: 0 }}>Schedule {scheduleJob.name}</h2>
                <p className="small" style={{ margin: '6px 0 0' }}>Times use {scheduleJob.scheduleTimeZone || 'the configured job time zone'}.</p>
              </div>
              <button className="btn btnSmall" type="button" onClick={() => setScheduleJob(null)} disabled={savingSchedule}>Close</button>
            </div>

            <div className="scheduledJobScheduleGrid">
              <label className="field">
                <span>Schedule</span>
                <select className="input" value={schedule.type} onChange={(event) => setSchedule((current) => ({ ...current, type: event.target.value as ScheduledJobSchedule['type'] }))}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="manual">Manual</option>
                </select>
              </label>

              {schedule.type !== 'manual' ? (
                <label className="field">
                  <span>Time</span>
                  <input className="input" type="time" value={schedule.time || '02:00'} onChange={(event) => setSchedule((current) => ({ ...current, time: event.target.value }))} required />
                </label>
              ) : null}

              {schedule.type === 'weekly' ? (
                <label className="field">
                  <span>Day of week</span>
                  <select className="input" value={schedule.dayOfWeek ?? 0} onChange={(event) => setSchedule((current) => ({ ...current, dayOfWeek: Number(event.target.value) }))}>
                    {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
                  </select>
                </label>
              ) : null}

              {schedule.type === 'monthly' ? (
                <label className="field">
                  <span>Day of month</span>
                  <input className="input" type="number" min={1} max={31} value={schedule.dayOfMonth ?? 1} onChange={(event) => setSchedule((current) => ({ ...current, dayOfMonth: Number(event.target.value) }))} required />
                </label>
              ) : null}
            </div>

            {schedule.type === 'manual' ? <div className="small scheduledJobManualHint">Manual does not schedule the job. Use Run now to execute it.</div> : null}

            {['scrubTournaments', 'scrubGolfCourseEmails'].includes(scheduleJob.id) ? (
              <div className="scheduledJobScrubConfig">
                <h3 style={{ margin: 0 }}>{scheduleJob.id === 'scrubGolfCourseEmails' ? 'Email-address scrub values' : 'Tournament-name scrub values'}</h3>
                <p className="small">
                  {scheduleJob.id === 'scrubGolfCourseEmails'
                    ? 'When Scrub Golf Course Emails runs, each golfCourseEmails.csv record is checked and the row is deleted when Email Address contains any configured literal value.'
                    : 'When scrubTournaments runs, any discovered tournament whose tournament_name contains one of these literal values is deleted.'}
                </p>
                <div className="scheduledJobScrubAddRow">
                  <input
                    className="input"
                    value={scrubValueInput}
                    onChange={(event) => setScrubValueInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        addScrubValue()
                      }
                    }}
                    placeholder={scheduleJob.id === 'scrubGolfCourseEmails' ? 'Example: noreply@' : 'Example: junior league'}
                    maxLength={191}
                  />
                  <button className="btn" type="button" onClick={addScrubValue}>Add value</button>
                </div>
                <div className="scheduledJobScrubValues" aria-live="polite">
                  {scrubValues.length ? scrubValues.map((value) => (
                    <span className="scheduledJobScrubValue" key={value.toLowerCase()}>
                      <span>{value}</span>
                      <button type="button" aria-label={`Remove ${value}`} onClick={() => setScrubValues((current) => current.filter((candidate) => candidate !== value))}>×</button>
                    </span>
                  )) : <span className="small">No scrub values configured.</span>}
                </div>
              </div>
            ) : null}

            <div className="scheduledJobScheduleActions">
              <button className="btn" type="button" onClick={() => setScheduleJob(null)} disabled={savingSchedule}>Cancel</button>
              <button className="btnPrimary" type="button" onClick={() => void saveSchedule()} disabled={savingSchedule}>{savingSchedule ? 'Saving…' : 'Save schedule'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
