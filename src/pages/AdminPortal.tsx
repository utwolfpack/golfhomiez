import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PageHero from '../components/PageHero'
import {
  approveHostAccountRequest,
  createAdminAccount,
  deleteAdminAccount,
  deleteHostAccountRequest,
  fetchAdminPortal,
  requestAdminPasswordReset,
} from '../lib/admin'
import { useAdminAuth } from '../context/AdminAuthContext'
import { formatFriendlyDateTime } from '../lib/time-format'
import { logFrontendEvent } from '../lib/frontend-logger'

type PortalState = Awaited<ReturnType<typeof fetchAdminPortal>>
type RowRecord = Record<string, unknown>
type DetailColumn = { key: string; label: string }
type DetailModalState = { title: string; rows: RowRecord[]; columns: DetailColumn[] } | null

function isDateKey(key?: string) {
  return Boolean(key && /(^|_)(created|updated|expires|consumed|validated|reviewed|started|completed)_?at$|createdAt|updatedAt|expiresAt|consumedAt/i.test(key))
}

function formatValue(value: unknown, key?: string) {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (isDateKey(key)) return formatFriendlyDateTime(String(value))
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function DetailModal({ modal, onClose }: { modal: DetailModalState; onClose: () => void }) {
  if (!modal) return null
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={modal.title} onClick={onClose}>
      <section className="modalCard adminMetadataModal" onClick={(event) => event.stopPropagation()}>
        <div className="adminSectionHeader">
          <div>
            <h2 style={{ margin: 0 }}>{modal.title}</h2>
            <p className="small" style={{ margin: '6px 0 0' }}>{modal.rows.length} records available for review.</p>
          </div>
          <button className="btn" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="adminTableScroll">
          <table className="table adminCompactTable">
            <thead>
              <tr>
                {modal.columns.map((column) => <th key={column.key}>{column.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {modal.rows.length ? modal.rows.map((row, index) => (
                <tr key={String(row.id ?? row.email ?? row.name ?? `${modal.title}-${index}`)}>
                  {modal.columns.map((column) => <td key={column.key}>{formatValue(row[column.key], column.key)}</td>)}
                </tr>
              )) : (
                <tr>
                  <td colSpan={modal.columns.length} className="small" style={{ padding: '18px 10px' }}>No records available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function MetricButton({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button className="card cardClickable adminSummaryButton" type="button" onClick={onClick} aria-label={`Review ${label} records`}>
      <div className="small" style={{ fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, marginTop: 8 }}>{value}</div>
    </button>
  )
}

function SummaryCards({ portal, onOpenDetails }: { portal: PortalState | null; onOpenDetails: (title: string, rows: RowRecord[], columns: DetailColumn[]) => void }) {
  const summary = portal?.summary ?? {}
  const items = [
    { label: 'Users', value: summary.userCount ?? 0, rows: portal?.users ?? [], columns: userColumns },
    { label: 'App users', value: summary.appUserCount ?? 0, rows: portal?.appUsers ?? [], columns: appUserColumns },
    { label: 'Teams', value: summary.teamCount ?? 0, rows: portal?.teams ?? [], columns: teamColumns },
    { label: 'Scores', value: summary.scoreCount ?? 0, rows: portal?.scores ?? [], columns: scoreColumns },
    { label: 'Hosts', value: summary.hostCount ?? 0, rows: portal?.hosts ?? [], columns: hostColumns },
    { label: 'Organizers', value: summary.organizerCount ?? 0, rows: portal?.organizers ?? [], columns: organizerColumns },
    { label: 'Tournaments', value: summary.tournamentCount ?? 0, rows: portal?.tournaments ?? [], columns: tournamentColumns },
    { label: 'Pending requests', value: summary.hostAccountRequestCount ?? 0, rows: portal?.requests ?? [], columns: requestColumns },
  ]

  return (
    <div className="grid grid4 adminSummaryGrid">
      {items.map((item) => (
        <MetricButton
          key={item.label}
          label={item.label}
          value={Number(item.value || 0)}
          onClick={() => onOpenDetails(`${item.label} metadata`, item.rows as RowRecord[], item.columns)}
        />
      ))}
    </div>
  )
}

function DataTable({ title, rows, columns, emptyMessage = 'No data available.' }: { title: string; rows: RowRecord[]; columns: DetailColumn[]; emptyMessage?: string }) {
  return (
    <section className="card adminPanel" style={{ padding: 14, overflow: 'hidden' }}>
      <div className="adminSectionHeader">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className="pill">{rows.length} total</span>
      </div>
      <div className="adminTableScroll">
        <table className="table adminCompactTable">
          <thead>
            <tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row, index) => (
              <tr key={String(row.id ?? row.username ?? row.email ?? `${title}-${index}`)}>
                {columns.map((column) => <td key={column.key}>{formatValue(row[column.key], column.key)}</td>)}
              </tr>
            )) : (
              <tr><td colSpan={columns.length} className="small" style={{ padding: '18px 10px' }}>{emptyMessage}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RequestTable({ rows, approvingRequestId, deletingRequestId, onApprove, onDelete }: { rows: RowRecord[]; approvingRequestId: string | null; deletingRequestId: string | null; onApprove: (requestId: string) => Promise<void>; onDelete: (requestId: string) => Promise<void> }) {
  return (
    <section className="card adminPanel" style={{ padding: 14, overflow: 'hidden' }}>
      <div className="adminSectionHeader">
        <h2 style={{ margin: 0 }}>Golf-course account requests</h2>
        <span className="pill">{rows.length} total</span>
      </div>
      <div className="adminTableScroll adminRequestTableScroll">
        <table className="table adminCompactTable">
          <thead>
            <tr>
              <th>Created</th>
              <th>Name</th>
              <th>Email</th>
              <th>Golf course</th>
              <th>Status</th>
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
                  <td>{formatValue(row.created_at, 'created_at')}</td>
                  <td>{`${formatValue(row.first_name)} ${formatValue(row.last_name)}`.trim()}</td>
                  <td>{formatValue(row.email)}</td>
                  <td>{formatValue(row.golf_course_name)}</td>
                  <td>{formatValue(row.status)}</td>
                  <td>
                    {pending ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button className="btn btnPrimary" type="button" disabled={busy} onClick={() => onApprove(requestId)}>{approvingRequestId === requestId ? 'Approving…' : 'Approve request'}</button>
                        <button className="btn" type="button" disabled={busy} onClick={() => onDelete(requestId)}>{deletingRequestId === requestId ? 'Deleting…' : 'Delete request'}</button>
                      </div>
                    ) : <span className="small">No action required</span>}
                  </td>
                </tr>
              )
            }) : (
              <tr><td colSpan={6} className="small" style={{ padding: '18px 10px' }}>No golf-course account requests available.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function AdminUsersTable({ rows, currentAdminUserId, deletingAdminUserId, onDelete }: { rows: RowRecord[]; currentAdminUserId?: string | null; deletingAdminUserId: string | null; onDelete: (adminUserId: string) => Promise<void> }) {
  return (
    <section className="card adminPanel" style={{ padding: 14, overflow: 'hidden' }}>
      <div className="adminSectionHeader">
        <div>
          <h2 style={{ margin: 0 }}>Admins</h2>
          <p className="small" style={{ margin: '6px 0 0' }}>Create or delete dedicated golfadmin portal users.</p>
        </div>
        <span className="pill">{rows.length} total</span>
      </div>
      <div className="adminTableScroll">
        <table className="table adminCompactTable">
          <thead>
            <tr>{adminColumns.map((column) => <th key={column.key}>{column.label}</th>)}<th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row, index) => {
              const adminUserId = String(row.id ?? `admin-${index}`)
              const isCurrent = adminUserId === currentAdminUserId
              const busy = deletingAdminUserId === adminUserId
              return (
                <tr key={adminUserId}>
                  {adminColumns.map((column) => <td key={column.key}>{formatValue(row[column.key], column.key)}</td>)}
                  <td>
                    <button className="btn" type="button" disabled={isCurrent || busy} onClick={() => onDelete(adminUserId)}>
                      {busy ? 'Deleting…' : isCurrent ? 'Current user' : 'Delete admin'}
                    </button>
                  </td>
                </tr>
              )
            }) : (
              <tr><td colSpan={adminColumns.length + 1} className="small" style={{ padding: '18px 10px' }}>No admin users available.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function FormCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card adminPanel" style={{ padding: 14 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {subtitle ? <p className="small" style={{ margin: '6px 0 0' }}>{subtitle}</p> : null}
      </div>
      {children}
    </section>
  )
}

function AccountSummarySection({ portal, onOpenDetails }: { portal: PortalState | null; onOpenDetails: (title: string, rows: RowRecord[], columns: DetailColumn[]) => void }) {
  const summary = portal?.summary ?? {}
  return (
    <section className="card adminPanel" style={{ padding: 14 }}>
      <div className="adminSectionHeader">
        <div>
          <h2 style={{ margin: 0 }}>Host and organizer accounts</h2>
          <p className="small" style={{ margin: '6px 0 0' }}>Account counts by type with metadata review.</p>
        </div>
      </div>
      <div className="adminAccountMetricGrid">
        <MetricButton label="Host accounts" value={Number(summary.hostCount || 0)} onClick={() => onOpenDetails('Host account metadata', (portal?.hosts ?? []) as RowRecord[], hostColumns)} />
        <MetricButton label="Organizer accounts" value={Number(summary.organizerCount || 0)} onClick={() => onOpenDetails('Organizer account metadata', (portal?.organizers ?? []) as RowRecord[], organizerColumns)} />
      </div>
    </section>
  )
}

function TournamentSection({ portal, onOpenDetails }: { portal: PortalState | null; onOpenDetails: (title: string, rows: RowRecord[], columns: DetailColumn[]) => void }) {
  const counts = (portal?.tournamentStatusCounts ?? []) as RowRecord[]
  const tournaments = (portal?.tournaments ?? []) as RowRecord[]
  return (
    <section className="card adminPanel" style={{ padding: 14 }}>
      <div className="adminSectionHeader">
        <div>
          <h2 style={{ margin: 0 }}>Tournament information</h2>
          <p className="small" style={{ margin: '6px 0 0' }}>Created tournament totals, creators, creation date, and golf-course metadata.</p>
        </div>
        <button className="btn" type="button" onClick={() => onOpenDetails('Tournament metadata', tournaments, tournamentColumns)}>Review all</button>
      </div>
      <div className="adminStatusGrid">
        {counts.length ? counts.map((row) => {
          const status = String(row.status || 'unknown')
          const filtered = tournaments.filter((tournament) => String(tournament.status || 'unknown') === status)
          return (
            <button className="pill adminStatusPill" type="button" key={status} onClick={() => onOpenDetails(`${status} tournament metadata`, filtered, tournamentColumns)}>
              <strong>{status}</strong> {formatValue(row.count)}
            </button>
          )
        }) : <span className="small">No tournaments created yet.</span>}
      </div>
      <div className="adminTableScroll adminTournamentTableScroll">
        <table className="table adminCompactTable">
          <thead>
            <tr>{tournamentColumns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
          </thead>
          <tbody>
            {tournaments.length ? tournaments.slice(0, 12).map((row, index) => (
              <tr key={String(row.id ?? `tournament-${index}`)}>
                {tournamentColumns.map((column) => <td key={column.key}>{formatValue(row[column.key], column.key)}</td>)}
              </tr>
            )) : <tr><td colSpan={tournamentColumns.length} className="small" style={{ padding: '18px 10px' }}>No tournament metadata available.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const userColumns: DetailColumn[] = [
  { key: 'email', label: 'Email' },
  { key: 'name', label: 'Name' },
  { key: 'emailVerified', label: 'Verified' },
  { key: 'createdAt', label: 'Created' },
]
const appUserColumns: DetailColumn[] = [
  { key: 'email', label: 'Email' },
  { key: 'display_name', label: 'Display name' },
  { key: 'primary_state', label: 'State' },
  { key: 'created_at', label: 'Created' },
]
const teamColumns: DetailColumn[] = [
  { key: 'name', label: 'Team' },
  { key: 'created_by_email', label: 'Created by' },
  { key: 'created_at', label: 'Created' },
  { key: 'updated_at', label: 'Updated' },
]
const scoreColumns: DetailColumn[] = [
  { key: 'mode', label: 'Mode' },
  { key: 'course', label: 'Golf course' },
  { key: 'created_by_email', label: 'Created by' },
  { key: 'created_at', label: 'Created' },
]
const hostColumns: DetailColumn[] = [
  { key: 'email', label: 'Email' },
  { key: 'account_name', label: 'Golf course' },
  { key: 'contact_name', label: 'Contact' },
  { key: 'created_at', label: 'Created' },
]
const organizerColumns: DetailColumn[] = [
  { key: 'email', label: 'Email' },
  { key: 'organization_name', label: 'Organization' },
  { key: 'contact_name', label: 'Contact' },
  { key: 'created_at', label: 'Created' },
]
const tournamentColumns: DetailColumn[] = [
  { key: 'name', label: 'Tournament' },
  { key: 'status', label: 'Status' },
  { key: 'creator', label: 'Created by' },
  { key: 'created_at', label: 'Created' },
  { key: 'golf_course_name', label: 'Golf course' },
]
const requestColumns: DetailColumn[] = [
  { key: 'created_at', label: 'Created' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'email', label: 'Email' },
  { key: 'state_name', label: 'State' },
  { key: 'golf_course_name', label: 'Golf course' },
  { key: 'status', label: 'Status' },
  { key: 'reviewed_by_email', label: 'Reviewed by' },
]
const adminColumns: DetailColumn[] = [
  { key: 'username', label: 'Username' },
  { key: 'email', label: 'Email' },
  { key: 'is_active', label: 'Active' },
  { key: 'created_at', label: 'Created' },
]

export default function AdminPortal() {
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [loginError, setLoginError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { adminUser, loading: adminLoading, loginAdmin, logoutAdmin } = useAdminAuth()
  const [portal, setPortal] = useState<PortalState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newAdminForm, setNewAdminForm] = useState({ username: '', email: '', password: '' })
  const [resetIdentifier, setResetIdentifier] = useState('')
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null)
  const [deletingRequestId, setDeletingRequestId] = useState<string | null>(null)
  const [deletingAdminUserId, setDeletingAdminUserId] = useState<string | null>(null)
  const [detailModal, setDetailModal] = useState<DetailModalState>(null)

  async function loadPortal() {
    logFrontendEvent({ category: 'admin.portal', message: 'admin_portal_metadata_load_started' })
    const portalData = await fetchAdminPortal()
    setPortal(portalData)
    logFrontendEvent({ category: 'admin.portal', message: 'admin_portal_metadata_loaded', data: { summary: portalData.summary } })
  }

  useEffect(() => {
    if (!adminUser) {
      setPortal(null)
      return
    }
    void loadPortal()
  }, [adminUser])

  function openDetails(title: string, rows: RowRecord[], columns: DetailColumn[]) {
    logFrontendEvent({ category: 'admin.portal.metadata', message: 'admin_metadata_modal_opened', data: { title, recordCount: rows.length } })
    setDetailModal({ title, rows, columns })
  }

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

  async function onCreateAdmin(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    setError(null)
    try {
      logFrontendEvent({ category: 'admin.portal.admin_user', message: 'admin_user_create_started', data: { email: newAdminForm.email } })
      const result = await createAdminAccount(newAdminForm.username, newAdminForm.email, newAdminForm.password)
      setMessage(`Admin user ${result.adminUser.username} created.`)
      setNewAdminForm({ username: '', email: '', password: '' })
      await loadPortal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create admin account.')
    }
  }

  async function onDeleteAdmin(adminUserId: string) {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Delete this admin user? This cannot be undone.')
      if (!confirmed) return
    }
    setDeletingAdminUserId(adminUserId)
    setMessage(null)
    setError(null)
    try {
      logFrontendEvent({ category: 'admin.portal.admin_user', message: 'admin_user_delete_started', data: { adminUserId } })
      await deleteAdminAccount(adminUserId)
      setMessage('Admin user deleted.')
      await loadPortal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete admin account.')
    } finally {
      setDeletingAdminUserId(null)
    }
  }

  async function onResetRequest(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    setError(null)
    try {
      logFrontendEvent({ category: 'admin.portal.password_reset', message: 'admin_password_reset_request_started', data: { identifier: resetIdentifier } })
      await requestAdminPasswordReset(resetIdentifier)
      logFrontendEvent({ category: 'admin.portal.password_reset', message: 'admin_password_reset_request_completed' })
      setMessage('If that admin account exists, a reset link has been emailed from no-reply@golfhomiez.com.')
      setResetIdentifier('')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not request a reset link.'
      logFrontendEvent({ category: 'admin.portal.password_reset', level: 'error', message: 'admin_password_reset_request_failed', data: { error: message } })
      setError(message)
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
    <div className="container pageStack adminPortalContainer">
      <div className="card pageCardShell adminPortalShell">
        <div className="adminPortalHeader">
          <PageHero eyebrow="Administration" title="GolfHomiez admin portal" subtitle="Review platform records, tournaments, account requests, scheduled jobs, and admin users from one compact dashboard." />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div className="small">Signed in as <strong>{adminUser.username}</strong> ({adminUser.email})</div>
            <button className="btn" type="button" onClick={onLogout}>Sign out</button>
          </div>
          {message ? <p className="statusMessage statusSuccess">{message}</p> : null}
          {error ? <p className="statusMessage statusError">{error}</p> : null}
          <SummaryCards portal={portal} onOpenDetails={openDetails} />
        </div>

        <div className="adminPortalReviewGrid">
          <div className="adminReviewColumn">
            <AccountSummarySection portal={portal} onOpenDetails={openDetails} />
            <RequestTable rows={requestRows} approvingRequestId={approvingRequestId} deletingRequestId={deletingRequestId} onApprove={onApproveRequest} onDelete={onDeleteRequest} />
          </div>
          <div className="adminReviewColumn">
            <TournamentSection portal={portal} onOpenDetails={openDetails} />
            <div className="grid grid2 adminCompactForms" style={{ alignItems: 'start' }}>
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
              <AdminUsersTable rows={adminRows} currentAdminUserId={adminUser.id} deletingAdminUserId={deletingAdminUserId} onDelete={onDeleteAdmin} />
            </div>
          </div>
        </div>
      </div>
      <DetailModal modal={detailModal} onClose={() => setDetailModal(null)} />
    </div>
  )
}
