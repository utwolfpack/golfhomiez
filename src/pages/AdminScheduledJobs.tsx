import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { fetchScheduledJobs, runScheduledJob, type ScheduledJob } from '../lib/admin'
import { logFrontendEvent } from '../lib/frontend-logger'
import { formatFriendlyDateTime } from '../lib/time-format'
import { useAdminAuth } from '../context/AdminAuthContext'

function formatDate(value?: string | null) {
  return value ? formatFriendlyDateTime(value) : '—'
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

export default function AdminScheduledJobs() {
  const { adminUser } = useAdminAuth()
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [runningJobId, setRunningJobId] = useState<string | null>(null)

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
      setMessage(`${job.name} completed with status: ${result.result.status}.`)
      logFrontendEvent({ category: 'admin.scheduled_jobs', message: 'scheduled_job_manual_run_completed', data: { jobId: job.id, jobName: job.name, status: result.result.status, runId: result.result.runId } })
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not run scheduled job.'
      setError(text)
      logFrontendEvent({ category: 'admin.scheduled_jobs', level: 'error', message: 'scheduled_job_manual_run_failed', data: { jobId: job.id, jobName: job.name, error: text } })
    } finally {
      setRunningJobId(null)
    }
  }

  return (
    <div className="container pageStack" style={{ paddingTop: 28, paddingBottom: 28 }}>
      <div className="card pageCardShell" style={{ padding: 24 }}>
        <PageHero eyebrow="Administration" title="Scheduled jobs" subtitle="Review scheduled app jobs, inspect the last run, and manually run jobs for troubleshooting." />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div className="small">Signed in as <strong>{adminUser?.username}</strong> ({adminUser?.email})</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => void loadJobs()} disabled={loading || Boolean(runningJobId)}>{loading ? 'Refreshing…' : 'Refresh jobs'}</button>
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
                  <th>Next scheduled run</th>
                  <th>Last run</th>
                  <th>Last output/status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="small" style={{ padding: '18px 10px' }}>Loading scheduled jobs…</td></tr>
                ) : sortedJobs.length ? sortedJobs.map((job) => {
                  const lastRun = job.lastRun
                  const isRunning = runningJobId === job.id
                  return (
                    <tr key={job.id}>
                      <td>
                        <strong>{job.name}</strong>
                        <div className="small">{job.scheduleLabel || 'Schedule not configured'}{job.scheduleTimeZone ? ` · ${job.scheduleTimeZone}` : ''}</div>
                      </td>
                      <td style={{ minWidth: 260 }}>{job.description || '—'}</td>
                      <td>{formatDate(job.createdAt)}</td>
                      <td>{formatDate(job.nextRunAt)}</td>
                      <td>
                        {lastRun ? (
                          <div>
                            <div>{formatDate(lastRun.completedAt || lastRun.startedAt)}</div>
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
                        <button className="btnPrimary" type="button" onClick={() => void onRunJob(job)} disabled={Boolean(runningJobId)}>
                          {isRunning ? 'Running…' : 'Run now'}
                        </button>
                      </td>
                    </tr>
                  )
                }) : (
                  <tr><td colSpan={7} className="small" style={{ padding: '18px 10px' }}>No scheduled jobs are registered.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
