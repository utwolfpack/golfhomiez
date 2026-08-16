import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import PageHero from '../components/PageHero'
import {
  cancelScheduledJob,
  fetchScheduledJobs,
  runScheduledJob,
  updateScheduledJobSchedule,
  type ScheduledJob,
  type ScheduledJobSchedule,
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

  const sortedJobs = useMemo(() => [...jobs].sort((a, b) => a.name.localeCompare(b.name)), [jobs])

  async function loadJobs() {
    setError(null)
    try {
      logFrontendEvent({ category: 'admin.scheduled_jobs', message: 'scheduled_jobs_load_started', data: { route: '/golfadmin/scheduled-jobs' } })
      const result = await fetchScheduledJobs()
      setJobs(result.jobs || [])
      logFrontendEvent({ category: 'admin.scheduled_jobs', message: 'scheduled_jobs_load_completed', data: { jobCount: result.jobs?.length || 0 } })
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
      const jobConfig = scheduleJob.id === 'scrubTournaments'
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
        <section className="card" style={{ padding: 18, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <h2 style={{ margin: 0 }}>All scheduled jobs</h2>
            <span className="pill">{sortedJobs.length} total</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Scheduled job</th>
                  <th>Description</th>
                  <th>Created</th>
                  <th>Completed</th>
                  <th>Next scheduled run</th>
                  <th>Last run</th>
                  <th>Last output/status</th>
                  <th>Actions</th>
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
                      <td>
                        <strong>{job.name}</strong>
                        <div className="small">{job.scheduleLabel || 'Manual'}{job.scheduleTimeZone ? ` · ${job.scheduleTimeZone}` : ''}</div>
                        {job.id === 'scrubTournaments' ? <div className="small">{job.jobConfig?.matchValues?.length || 0} scrub value(s)</div> : null}
                        {job.id === 'getGolfCourseData' ? (
                          <>
                            <div className="small">All US states + DC · fast mode · {String(job.jobConfig?.courseConcurrency || 8)} concurrent courses · bulk metadata + holes/tees enrichment</div>
                            <div className="small">Target: ~{String(job.jobConfig?.targetRunHours || 12)} hours. A full US run needs roughly two REST calls per course plus state validation, so use an OpenGolfAPI key with enough daily quota; the run output reports the exact estimate.</div>
                          </>
                        ) : null}
                      </td>
                      <td style={{ minWidth: 260 }}>{job.description || '—'}</td>
                      <td>{formatDate(job.createdAt)}</td>
                      <td style={{ minWidth: 150 }}>
                        <div>{formatDate(lastRun?.completedAt)}</div>
                        {lastRun?.completedAt ? <div className="small">Ran for {formatDuration(lastRun.durationMs)}</div> : null}
                      </td>
                      <td>{job.schedule?.type === 'manual' ? 'Manual' : formatDate(job.nextRunAt)}</td>
                      <td>
                        {lastRun ? (
                          <div>
                            <div>{formatDate(lastRun.startedAt)}</div>
                            <div className="small">Triggered by {lastRun.triggeredBy || '—'}{lastRun.adminUserEmail ? ` · ${lastRun.adminUserEmail}` : ''}</div>
                            <div className="small">Correlation ID: {lastRun.correlationId || '—'}</div>
                          </div>
                        ) : '—'}
                      </td>
                      <td style={{ minWidth: 300 }}>
                        <div className={statusClass(lastRun?.status)} style={{ margin: 0 }}>{lastRun?.status || 'Never run'}</div>
                        {lastRun?.error ? <div className="small" style={{ color: '#b91c1c', marginTop: 6 }}>{lastRun.error}</div> : null}
                        <pre className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto', margin: '8px 0 0' }}>{formatRunOutput(lastRun?.output)}</pre>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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

            {scheduleJob.id === 'scrubTournaments' ? (
              <div className="scheduledJobScrubConfig">
                <h3 style={{ margin: 0 }}>Tournament-name scrub values</h3>
                <p className="small">When scrubTournaments runs, any discovered tournament whose tournament_name contains one of these literal values is deleted.</p>
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
                    placeholder="Example: junior league"
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
