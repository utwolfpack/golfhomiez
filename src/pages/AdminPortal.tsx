import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import GolfCourseInput from '../components/GolfCourseInput'
import {
  adminLogin,
  adminLogout,
  createAdminAccount,
  createHostInvite,
  fetchAdminPortal,
  fetchAdminSession,
  requestAdminPasswordReset,
} from '../lib/admin'

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

function DataTable({
  title,
  rows,
  columns,
}: {
  title: string
  rows: RowRecord[]
  columns: Array<{ key: string; label: string }>
}) {
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
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={String(row.id ?? row.username ?? row.email ?? `${title}-${index}`)}>
                  {columns.map((column) => (
                    <td key={column.key}>{formatValue(row[column.key])}</td>
                  ))}
                </tr>
              ))
            ) : (
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
  const [checkingSession, setCheckingSession] = useState(true)
  const [adminUser, setAdminUser] = useState<AdminIdentity | null>(null)
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [loginError, setLoginError] = useState<string | null>(null)
  const [portal, setPortal] = useState<PortalState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inviteForm, setInviteForm] = useState({ email: '', inviteeName: '', golfCourseName: '' })
  const [newAdminForm, setNewAdminForm] = useState({ username: '', email: '', password: '' })
  const [resetIdentifier, setResetIdentifier] = useState('')

  async function loadPortal() {
    const [me, portalData] = await Promise.all([fetchAdminSession(), fetchAdminPortal()])
    setAdminUser(me.adminUser)
    setPortal(portalData)
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        await loadPortal()
      } catch {
        if (active) {
          setAdminUser(null)
          setPortal(null)
        }
      } finally {
        if (active) setCheckingSession(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  async function onLogin(e: FormEvent) {
    e.preventDefault()
    setLoginError(null)
    setError(null)
    setMessage(null)
    try {
      await adminLogin(loginForm.username, loginForm.password)
      await loadPortal()
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Admin login failed.')
    }
  }

  async function onLogout() {
    await adminLogout()
    setAdminUser(null)
    setPortal(null)
    setLoginForm({ username: '', password: '' })
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

  const adminRows = useMemo(() => (portal?.admins ?? []) as RowRecord[], [portal])
  const hostRows = useMemo(() => (portal?.hosts ?? []) as RowRecord[], [portal])
  const inviteRows = useMemo(() => (portal?.invites ?? []) as RowRecord[], [portal])
  const userRows = useMemo(() => (portal?.users ?? []) as RowRecord[], [portal])

  if (checkingSession) {
    return <div className="container pageStack"><div className="card pageCardShell">Loading admin portal…</div></div>
  }

  if (!adminUser) {
    return (
      <div className="container pageStack" style={{ paddingTop: 28, paddingBottom: 28 }}>
        <div className="card pageCardShell" style={{ maxWidth: 760, width: '100%', margin: '0 auto', padding: 24 }}>
          <PageHero
            eyebrow="Direct admin access"
            title="GolfHomiez admin portal"
            subtitle="This portal has its own admin login and is not tied to the signed-in golfer account."
          />

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
      <div className="pageStack" style={{ gap: 18 }}>
        <div className="card pageCardShell" style={{ padding: 24 }}>
          <PageHero
            eyebrow="Admin portal"
            title="GolfHomiez admin portal"
            subtitle={`Signed in as ${adminUser.username}`}
            actions={<button className="btn" onClick={onLogout}>Sign out</button>}
          />
          {message ? <p className="statusMessage statusSuccess">{message}</p> : null}
          {error ? <p className="statusMessage statusError">{error}</p> : null}
        </div>

        <SummaryCards summary={portal?.summary ?? {}} />

        <div className="grid grid2" style={{ alignItems: 'start' }}>
          <FormCard title="Create host invite" subtitle="Send an invite with a security key and registration link.">
            <form className="formStack" onSubmit={onCreateInvite}>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" value={inviteForm.email} onChange={(e) => setInviteForm((s) => ({ ...s, email: e.target.value }))} />
              </div>
              <div>
                <label className="label">Invitee name</label>
                <input className="input" value={inviteForm.inviteeName} onChange={(e) => setInviteForm((s) => ({ ...s, inviteeName: e.target.value }))} />
              </div>
              <GolfCourseInput
                label="Golf course name"
                value={inviteForm.golfCourseName}
                onChange={(next) => setInviteForm((s) => ({ ...s, golfCourseName: next }))}
                datalistId="admin-host-invite-course-options"
                helperText="Search the imported golf course catalog before creating the invite."
              />
              <button className="btnPrimary" type="submit">Send host invite</button>
            </form>
          </FormCard>

          <FormCard title="Create admin account" subtitle="Add another direct admin user for the portal.">
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
              <button className="btnPrimary" type="submit">Create admin</button>
            </form>
          </FormCard>
        </div>

        <DataTable
          title="Admins"
          rows={adminRows}
          columns={[
            { key: 'username', label: 'Username' },
            { key: 'email', label: 'Email' },
            { key: 'is_active', label: 'Active' },
            { key: 'created_at', label: 'Created' },
          ]}
        />

        <DataTable
          title="Hosts"
          rows={hostRows}
          columns={[
            { key: 'golf_course_name', label: 'Golf course' },
            { key: 'email', label: 'Email' },
            { key: 'is_validated', label: 'Validated' },
            { key: 'validated_at', label: 'Validated at' },
            { key: 'created_at', label: 'Created' },
          ]}
        />

        <DataTable
          title="Invites"
          rows={inviteRows}
          columns={[
            { key: 'email', label: 'Email' },
            { key: 'invitee_name', label: 'Invitee' },
            { key: 'golf_course_name', label: 'Golf course' },
            { key: 'consumed_at', label: 'Consumed' },
            { key: 'created_at', label: 'Created' },
          ]}
        />

        <DataTable
          title="Users"
          rows={userRows}
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email' },
            { key: 'created_at', label: 'Created' },
          ]}
        />
      </div>
    </div>
  )
}
