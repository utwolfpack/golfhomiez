import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PageHero from '../components/PageHero'
import GolfCourseInput from '../components/GolfCourseInput'
import {
  approveHostAccountRequest,
  createAdminAccount,
  deleteHostAccountRequest,
  createHostInvite,
  fetchAdminPortal,
  requestAdminPasswordReset,
} from '../lib/admin'
import { useAdminAuth } from '../context/AdminAuthContext'

type PortalState = Awaited<ReturnType<typeof fetchAdminPortal>>
type AdminIdentity = { id: string; username: string; email: string }
type RowRecord = Record<string, unknown>

function formatValue(value: unknown) {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function SummaryCards({ summary }: { summary: Record<string, number> }) {
  const items = [
    { label: 'Users', value: summary.userCount ?? 0 },
    { label: 'App users', value: summary.appUserCount ?? 0 },
    { label: 'Teams', value: summary.teamCount ?? 0 },
    { label: 'Scores', value: summary.scoreCount ?? 0 },
    { label: 'Hosts', value: summary.hostCount ?? 0 },
    { label: 'Invites', value: summary.inviteCount ?? 0 },
    { label: 'Pending requests', value: summary.hostAccountRequestCount ?? 0 },
  ]

  return (
    <div className="grid grid3">
      {items.map((item) => (
        <div key={item.label} className="card" style={{ padding: 18 }}>
          <div className="small" style={{ fontSize: 13 }}>{item.label}</div>
          <div style={{ fontSize: 30, fontWeight: 800, marginTop: 8 }}>{item.value}</div>
        </div>
      ))}
    </div>
  )
}

function DataTable({ title, rows, columns }: { title: string; rows: RowRecord[]; columns: Array<{ key: string; label: string }> }) {
  return (
    <section className="card" style={{ padding: 18, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className="pill">{rows.length} total</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row, index) => (
              <tr key={String(row.id ?? row.username ?? row.email ?? `${title}-${index}`)}>
                {columns.map((column) => (
                  <td key={column.key}>{formatValue(row[column.key])}</td>
                ))}
              </tr>
            )) : (
              <tr>
                <td colSpan={columns.length} className="small" style={{ padding: '18px 10px' }}>
                  No data available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RequestTable({ rows, approvingRequestId, deletingRequestId, onApprove, onDelete }: { rows: RowRecord[]; approvingRequestId: string | null; deletingRequestId: string | null; onApprove: (requestId: string) => Promise<void>; onDelete: (requestId: string) => Promise<void> }) {
  return (
    <section className="card" style={{ padding: 18, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Golf-course account requests</h2>
        <span className="pill">{rows.length} total</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Created</th>
              <th>First name</th>
              <th>Last name</th>
              <th>Email</th>
              <th>State</th>
              <th>Golf course</th>
              <th>Representative details</th>
              <th>Status</th>
              <th>Reviewed by</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row, index) => {
              const requestId = String(row.id ?? `request-${index}`)
              const pending = String(row.status ?? '').toLowerCase() === 'pending'
              const busy = approvingRequestId === requestId || deletingRequestId === requestId
              return (
                <tr key={requestId}>
                  <td>{formatValue(row.created_at)}</td>
                  <td>{formatValue(row.first_name)}</td>
                  <td>{formatValue(row.last_name)}</td>
                  <td>{formatValue(row.email)}</td>
                  <td>{formatValue(row.state_name)}</td>
                  <td>{formatValue(row.golf_course_name)}</td>
                  <td style={{ minWidth: 260 }}>{formatValue(row.representative_details)}</td>
                  <td>{formatValue(row.status)}</td>
                  <td>{formatValue(row.reviewed_by_email)}</td>
                  <td>
                    {pending ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button className="btn btnPrimary" type="button" disabled={busy} onClick={() => onApprove(requestId)}>
                          {approvingRequestId === requestId ? 'Approving…' : 'Approve request'}
                        </button>
                        <button className="btn" type="button" disabled={busy} onClick={() => onDelete(requestId)}>
                          {deletingRequestId === requestId ? 'Deleting…' : 'Delete request'}
                        </button>
                      </div>
                    ) : (
                      <span className="small">No action required</span>
                    )}
                  </td>
                </tr>
              )
            }) : (
              <tr>
                <td colSpan={10} className="small" style={{ padding: '18px 10px' }}>
                  No golf-course account requests available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function FormCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: 18 }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {subtitle ? <p className="small" style={{ margin: '6px 0 0' }}>{subtitle}</p> : null}
      </div>
      {children}
    </section>
  )
}

export default function AdminPortal() {
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [loginError, setLoginError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { adminUser, loading: adminLoading, loginAdmin, logoutAdmin } = useAdminAuth()
  const [portal, setPortal] = useState<PortalState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inviteForm, setInviteForm] = useState({ email: '', inviteeName: '', golfCourseName: '' })
  const [newAdminForm, setNewAdminForm] = useState({ username: '', email: '', password: '' })
  const [resetIdentifier, setResetIdentifier] = useState('')
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null)
  const [deletingRequestId, setDeletingRequestId] = useState<string | null>(null)

  async function loadPortal() {
    const portalData = await fetchAdminPortal()
    setPortal(portalData)
  }

  useEffect(() => {
    if (!adminUser) {
      setPortal(null)
      return
    }
    void loadPortal()
  }, [adminUser])

  async function onLogin(e: FormEvent) {
    e.preventDefault()
    setLoginError(null)
    setError(null)
    setMessage(null)
    try {
      await loginAdmin(loginForm.username, loginForm.password)
      await loadPortal()
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Admin login failed.')
    }
  }

  async function onLogout() {
    await logoutAdmin()
    setPortal(null)
    setLoginForm({ username: '', password: '' })
    setMessage('Signed out of admin portal.')
    navigate('/golfadmin', { replace: true })
  }

  async function onCreateInvite(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    setError(null)
    try {
      const result = await createHostInvite(inviteForm.email, inviteForm.inviteeName, inviteForm.golfCourseName)
      setMessage(`Invite created for ${result.invite.email}. Security key: ${result.invite.securityKey}. Registration link: ${result.invite.registerUrl}`)
      setInviteForm({ email: '', inviteeName: '', golfCourseName: '' })
      await loadPortal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create invite.')
    }
  }

  async function onCreateAdmin(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    setError(null)
    try {
      const result = await createAdminAccount(newAdminForm.username, newAdminForm.email, newAdminForm.password)
      setMessage(`Admin user ${result.adminUser.username} created.`)
      setNewAdminForm({ username: '', email: '', password: '' })
      await loadPortal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create admin account.')
    }
  }

  async function onResetRequest(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    setError(null)
    try {
      await requestAdminPasswordReset(resetIdentifier)
      setMessage('If that admin account exists, a reset link has been emailed from no-reply@golfhomiez.com.')
      setResetIdentifier('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request a reset link.')
    }
  }

  async function onApproveRequest(requestId: string) {
    setApprovingRequestId(requestId)
    setMessage(null)
    setError(null)
    try {
      await approveHostAccountRequest(requestId)
      setMessage('Golf-course account request approved. The requester has been emailed with next steps and host access details.')
      await loadPortal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve the golf-course account request.')
    } finally {
      setApprovingRequestId(null)
    }
  }


  async function onDeleteRequest(requestId: string) {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Delete this golf-course account request? This cannot be undone.')
      if (!confirmed) return
    }
    setDeletingRequestId(requestId)
    setMessage(null)
    setError(null)
    try {
      await deleteHostAccountRequest(requestId)
      setMessage('Golf-course account request deleted.')
      await loadPortal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the golf-course account request.')
    } finally {
      setDeletingRequestId(null)
    }
  }

  const adminRows = useMemo(() => (portal?.admins ?? []) as RowRecord[], [portal])
  const hostRows = useMemo(() => (portal?.hosts ?? []) as RowRecord[], [portal])
  const inviteRows = useMemo(() => (portal?.invites ?? []) as RowRecord[], [portal])
  const userRows = useMemo(() => (portal?.users ?? []) as RowRecord[], [portal])
  const requestRows = useMemo(() => (portal?.requests ?? []) as RowRecord[], [portal])

  if (adminLoading) {
    return <div className="container pageStack"><div className="card pageCardShell">Loading admin portal…</div></div>
  }

  if (!adminUser) {
    return (
      <div className="container pageStack" style={{ paddingTop: 28, paddingBottom: 28 }}>
        <div className="card pageCardShell" style={{ maxWidth: 760, width: '100%', margin: '0 auto', padding: 24 }}>
          <PageHero eyebrow="Direct admin access" title="GolfHomiez admin portal" subtitle="This portal has its own admin login and is not tied to the signed-in golfer account." />
          <div className="grid grid2" style={{ alignItems: 'start' }}>
            <FormCard title="Sign in" subtitle="Use your admin username and password to access the portal.">
              <form className="formStack" onSubmit={onLogin}>
                <div>
                  <label className="label">Username</label>
                  <input className="input" value={loginForm.username} onChange={(e) => setLoginForm((s) => ({ ...s, username: e.target.value }))} autoComplete="username" />
                </div>
                <div>
                  <label className="label">Password</label>
                  <input className="input" type="password" value={loginForm.password} onChange={(e) => setLoginForm((s) => ({ ...s, password: e.target.value }))} autoComplete="current-password" />
                </div>
                {loginError ? <p className="statusMessage statusError">{loginError}</p> : null}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btnPrimary" type="submit">Sign in to admin portal</button>
                  <Link className="btn" to="/">Back to app</Link>
                </div>
              </form>
            </FormCard>

            <FormCard title="Forgot password" subtitle="Reset emails are sent from no-reply@golfhomiez.com.">
              <form className="formStack" onSubmit={onResetRequest}>
                <div>
                  <label className="label">Admin username or email</label>
                  <input className="input" value={resetIdentifier} onChange={(e) => setResetIdentifier(e.target.value)} autoComplete="username" />
                </div>
                <button className="btn" type="submit">Send reset email</button>
              </form>
            </FormCard>
          </div>
          {message ? <p className="statusMessage statusSuccess">{message}</p> : null}
          {error ? <p className="statusMessage statusError">{error}</p> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="container pageStack" style={{ paddingTop: 28, paddingBottom: 28 }}>
      <div className="card pageCardShell" style={{ padding: 24 }}>
        <PageHero eyebrow="Administration" title="GolfHomiez admin portal" subtitle="Manage golf-course host invites, review account requests, and keep the platform roster in sync." />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="small">Signed in as <strong>{adminUser.username}</strong> ({adminUser.email})</div>
          <button className="btn" type="button" onClick={onLogout}>Sign out</button>
        </div>
        {message ? <p className="statusMessage statusSuccess">{message}</p> : null}
        {error ? <p className="statusMessage statusError">{error}</p> : null}
        <SummaryCards summary={portal?.summary ?? {}} />
        <RequestTable rows={requestRows} approvingRequestId={approvingRequestId} deletingRequestId={deletingRequestId} onApprove={onApproveRequest} onDelete={onDeleteRequest} />
        <div className="grid grid2" style={{ alignItems: 'start' }}>
          <FormCard title="Create host invite" subtitle="Manual invites remain available when you want to onboard a course contact directly.">
            <form className="formStack" onSubmit={onCreateInvite}>
              <div>
                <label className="label">Invitee email</label>
                <input className="input" type="email" value={inviteForm.email} onChange={(e) => setInviteForm((s) => ({ ...s, email: e.target.value }))} />
              </div>
              <div>
                <label className="label">Invitee name</label>
                <input className="input" value={inviteForm.inviteeName} onChange={(e) => setInviteForm((s) => ({ ...s, inviteeName: e.target.value }))} />
              </div>
              <GolfCourseInput
                label="Golf-course account name"
                value={inviteForm.golfCourseName}
                onChange={(value) => setInviteForm((s) => ({ ...s, golfCourseName: value }))}
                datalistId="admin-portal-host-invite-courses"
                helperText="Search the imported golf course catalog and select the course for the host account."
              />
              <button className="btnPrimary" type="submit">Create host invite</button>
            </form>
          </FormCard>

          <FormCard title="Create admin user" subtitle="Provision another admin for the dedicated portal.">
            <form className="formStack" onSubmit={onCreateAdmin}>
              <div>
                <label className="label">Username</label>
                <input className="input" value={newAdminForm.username} onChange={(e) => setNewAdminForm((s) => ({ ...s, username: e.target.value }))} />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" value={newAdminForm.email} onChange={(e) => setNewAdminForm((s) => ({ ...s, email: e.target.value }))} />
              </div>
              <div>
                <label className="label">Password</label>
                <input className="input" type="password" value={newAdminForm.password} onChange={(e) => setNewAdminForm((s) => ({ ...s, password: e.target.value }))} />
              </div>
              <button className="btnPrimary" type="submit">Create admin user</button>
            </form>
          </FormCard>
        </div>
        <div className="grid grid2" style={{ alignItems: 'start' }}>
          <DataTable title="Admins" rows={adminRows} columns={[{ key: 'username', label: 'Username' }, { key: 'email', label: 'Email' }, { key: 'is_active', label: 'Active' }, { key: 'created_at', label: 'Created' }]} />
          <DataTable title="Golf-course accounts" rows={hostRows} columns={[{ key: 'email', label: 'Email' }, { key: 'account_name', label: 'Golf course' }, { key: 'created_at', label: 'Created' }]} />
        </div>
        <div className="grid grid2" style={{ alignItems: 'start' }}>
          <DataTable title="Host invites" rows={inviteRows} columns={[{ key: 'invitee_email', label: 'Invitee email' }, { key: 'invitee_name', label: 'Invitee name' }, { key: 'golf_course_name', label: 'Golf course' }, { key: 'expires_at', label: 'Expires' }, { key: 'consumed_at', label: 'Consumed' }]} />
          <DataTable title="Recent users" rows={userRows} columns={[{ key: 'email', label: 'Email' }, { key: 'name', label: 'Name' }, { key: 'emailVerified', label: 'Verified' }, { key: 'createdAt', label: 'Created' }]} />
        </div>
      </div>
    </div>
  )
}
