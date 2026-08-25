import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import PageHero from '../components/PageHero'
import PasswordCriteria from '../components/PasswordCriteria'
import {
  approveHostAccountRequest,
  createAdminAccount,
  deleteAdminAccount,
  deleteHostAccountRequest,
  fetchAdminPortal,
  fetchExternalApiCallReport,
  requestAdminPasswordReset,
  type ExternalApiCallFilters,
  type ExternalApiCallReport,
} from '../lib/admin'
import { useAdminAuth } from '../context/AdminAuthContext'
import { formatFriendlyDateTime } from '../lib/time-format'
import { getUserTodayISO } from '../lib/date'
import { logFrontendEvent } from '../lib/frontend-logger'
import { createAdminMarketingVideoSection, DEFAULT_HOME_MARKETING_SETTINGS, deleteAdminMarketingVideoSection, fetchAdminHomeMarketingSettings, fetchAdminMarketingVideoSections, MARKETING_VIDEO_AUDIENCES, saveAdminHomeMarketingSettings, type CreateMarketingVideoSectionInput, type HomeMarketingSettings, type MarketingVideoSection } from '../lib/marketing'
import { assertPasswordPolicy } from '../lib/password-policy'

type PortalState = Awaited<ReturnType<typeof fetchAdminPortal>>
type RowRecord = Record<string, unknown>
type DetailColumn = { key: string; label: string }
type DetailModalState = { title: string; rows: RowRecord[]; columns: DetailColumn[] } | null
type AdminPortalPage = 'golf' | 'tournaments' | 'api' | 'marketing' | 'admin'

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

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="card adminSummaryButton adminMetricCard" aria-label={`${label}: ${value}`}>
      <div className="small" style={{ fontSize: 13 }}>{label}</div>
      <div className="adminMetricValue">{value}</div>
      {detail ? <div className="small adminMetricDetail">{detail}</div> : null}
    </div>
  )
}

function AdminPortalTabs({ activePage, onSelect }: { activePage: AdminPortalPage; onSelect: (page: AdminPortalPage) => void }) {
  const pages: Array<{ id: AdminPortalPage; label: string }> = [
    { id: 'golf', label: 'Golf' },
    { id: 'tournaments', label: 'Tournaments' },
    { id: 'api', label: 'API Usage' },
    { id: 'marketing', label: 'Marketing' },
    { id: 'admin', label: 'Admin' },
  ]
  return (
    <nav className="adminPortalPageTabs" aria-label="GolfHomiez admin portal pages">
      {pages.map((page) => (
        <button
          key={page.id}
          className={`adminPortalPageTab${activePage === page.id ? ' adminPortalPageTab--active' : ''}`}
          type="button"
          aria-current={activePage === page.id ? 'page' : undefined}
          onClick={() => onSelect(page.id)}
        >
          {page.label}
        </button>
      ))}
    </nav>
  )
}

function apiTypeLabel(apiType?: string) {
  const normalized = String(apiType || '').toLowerCase()
  if (normalized === 'brevo') return 'Brevo'
  if (normalized === 'opengolfapi') return 'OpenGolfAPI'
  if (normalized === 'other') return 'Other external APIs'
  return 'All external APIs'
}

function apiTypePillClass(apiType?: string) {
  const normalized = String(apiType || '').toLowerCase()
  if (normalized === 'brevo') return 'pill adminApiTypePill adminApiTypePill--brevo'
  if (normalized === 'opengolfapi') return 'pill adminApiTypePill adminApiTypePill--opengolfapi'
  return 'pill adminApiTypePill adminApiTypePill--other'
}

function ExternalApiCallsSection({
  report,
  filters,
  loading,
  error,
  onFilterChange,
  onApply,
  onReset,
  onRefresh,
  refreshedAt,
}: {
  report: ExternalApiCallReport | null
  filters: ExternalApiCallFilters
  loading: boolean
  error: string | null
  onFilterChange: (filters: ExternalApiCallFilters) => void
  onApply: () => void
  onReset: () => void
  onRefresh: () => void
  refreshedAt: string | null
}) {
  const rows = report?.rows ?? []
  const endpoints = report?.endpoints ?? []
  const apiTypes = report?.apiTypes ?? []
  const displayedTotalCalls = Number(report?.totalCalls ?? 0).toLocaleString()
  const displayedApiTime = refreshedAt ? formatFriendlyDateTime(refreshedAt) : '—'

  return (
    <section className="card adminPanel" style={{ padding: 14, overflow: 'hidden' }}>
      <div className="adminSectionHeader">
        <div>
          <h2 style={{ margin: 0 }}>External API calls</h2>
          <p className="small" style={{ margin: '6px 0 0' }}>Persistent counts for outbound APIs that are not GolfHomiez application calls.</p>
        </div>
        <div className="adminApiCallHeaderActions" aria-label="External API call view status">
          <div className="adminApiCallViewSummary">
            <span>API time - {displayedApiTime}</span>
            <strong>View cumulative - {displayedTotalCalls} calls</strong>
          </div>
          <button
            className="adminApiRefreshButton"
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh external API calls"
            title="Refresh external API calls"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
              <path d="M20 6v5h-5M4 18v-5h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M18.2 9A7 7 0 0 0 6.3 6.1L4 8.5M5.8 15A7 7 0 0 0 17.7 17.9L20 15.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <form
        className="adminApiCallFilters"
        onSubmit={(event) => {
          event.preventDefault()
          onApply()
        }}
      >
        <div>
          <label className="label">Start date</label>
          <input className="input" type="date" value={filters.fromDate} onChange={(event) => onFilterChange({ ...filters, fromDate: event.target.value })} />
        </div>
        <div>
          <label className="label">End date</label>
          <input className="input" type="date" value={filters.toDate} onChange={(event) => onFilterChange({ ...filters, toDate: event.target.value })} />
        </div>
        <div>
          <label className="label">API type</label>
          <select className="select" value={filters.apiType || ''} onChange={(event) => onFilterChange({ ...filters, apiType: event.target.value })}>
            <option value="">All external APIs</option>
            <option value="brevo">Brevo</option>
            <option value="opengolfapi">OpenGolfAPI</option>
            <option value="other">Other external APIs</option>
          </select>
        </div>
        <div>
          <label className="label">Endpoint</label>
          <select className="select" value={filters.endpoint || ''} onChange={(event) => onFilterChange({ ...filters, endpoint: event.target.value })}>
            <option value="">All endpoints</option>
            {endpoints.map((entry) => (
              <option key={entry.endpoint} value={entry.endpoint}>{entry.endpoint} ({entry.callCount})</option>
            ))}
          </select>
        </div>
        <div className="adminApiCallFilterActions">
          <button className="btnPrimary" type="submit" disabled={loading}>{loading ? 'Loading…' : 'Apply filters'}</button>
          <button className="btn" type="button" onClick={onReset} disabled={loading}>Current day</button>
        </div>
      </form>

      {error ? <p className="statusMessage statusError">{error}</p> : null}

      <div className="adminApiMetricGrid" aria-label="API usage summary metrics">
        <MetricCard label="Total calls" value={Number(report?.totalCalls ?? 0).toLocaleString()} />
        <MetricCard label="Successful" value={Number(report?.successCount ?? 0).toLocaleString()} />
        <MetricCard label="Failed" value={Number(report?.failureCount ?? 0).toLocaleString()} />
        <MetricCard label="Success rate" value={`${Number(report?.successRatePercent ?? 0).toFixed(1)}%`} />
        <MetricCard label="Average latency" value={report?.averageDurationMs == null ? '—' : `${Number(report.averageDurationMs).toLocaleString()} ms`} />
        <MetricCard label="Endpoints" value={Number(report?.distinctEndpointCount ?? 0).toLocaleString()} />
      </div>

      <div className="adminStatusGrid" style={{ marginTop: 12 }}>
        {apiTypes.length ? apiTypes.map((entry) => (
          <span className={apiTypePillClass(entry.apiType)} key={entry.apiType}><strong>{apiTypeLabel(entry.apiType)}</strong> {entry.callCount}</span>
        )) : <span className="small">No external API calls are recorded for this date range.</span>}
      </div>

      <div className="adminTableScroll adminApiCallTableScroll">
        <table className="table adminCompactTable">
          <thead>
            <tr>
              <th>API type</th>
              <th>Endpoint</th>
              <th>Calls</th>
              <th>Success</th>
              <th>Failed</th>
              <th>Avg ms</th>
              <th>Last call</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={`${row.apiType}:${row.endpoint}`}>
                <td><span className={apiTypePillClass(row.apiType)}>{apiTypeLabel(row.apiType)}</span></td>
                <td className="adminApiEndpointCell">{row.endpoint}</td>
                <td>{row.callCount}</td>
                <td>{row.successCount}</td>
                <td>{row.failureCount}</td>
                <td>{row.averageDurationMs ?? '—'}</td>
                <td>{formatValue(row.lastCallAt, 'updated_at')}</td>
              </tr>
            )) : (
              <tr><td colSpan={7} className="small" style={{ padding: '18px 10px' }}>No external API call metrics match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
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


function GolfDashboardSection({ portal, onOpenDetails }: { portal: PortalState | null; onOpenDetails: (title: string, rows: RowRecord[], columns: DetailColumn[]) => void }) {
  const summary = portal?.summary ?? {}
  return (
    <div className="adminPageContent" data-admin-page="golf">
      <section className="adminPageIntro">
        <h2>GolfHomiez usage</h2>
        <p className="small">Platform usage metrics for golfers, teams, rounds, tournaments, and challenges.</p>
      </section>
      <div className="adminMetricGrid">
        <MetricButton label="Users" value={Number(summary.userCount || 0)} onClick={() => onOpenDetails('User metadata', (portal?.users ?? []) as RowRecord[], userColumns)} />
        <MetricCard label="Verified users" value={Number(summary.verifiedUserCount || 0)} />
        <MetricButton label="Teams" value={Number(summary.teamCount || 0)} onClick={() => onOpenDetails('Team metadata', (portal?.teams ?? []) as RowRecord[], teamColumns)} />
        <MetricButton label="Rounds / scores" value={Number(summary.scoreCount || 0)} onClick={() => onOpenDetails('Score metadata', (portal?.scores ?? []) as RowRecord[], scoreColumns)} />
        <MetricButton label="Tournaments" value={Number(summary.tournamentCount || 0)} onClick={() => onOpenDetails('Tournament metadata', (portal?.tournaments ?? []) as RowRecord[], tournamentColumns)} />
        <MetricButton label="Challenges" value={Number(summary.challengeCount || 0)} onClick={() => onOpenDetails('Challenge metadata', (portal?.challenges ?? []) as RowRecord[], challengeColumns)} />
        <MetricCard label="Active challenges" value={Number(summary.activeChallengeCount || 0)} />
        <MetricCard label="Completed challenges" value={Number(summary.completedChallengeCount || 0)} />
      </div>
      <div className="adminPortalReviewGrid adminPortalReviewGrid--balanced">
        <DataTable title="Recent users" rows={(portal?.users ?? []).slice(0, 12) as RowRecord[]} columns={userColumns} />
        <DataTable title="Recent teams" rows={(portal?.teams ?? []).slice(0, 12) as RowRecord[]} columns={teamColumns} />
      </div>
    </div>
  )
}

function TournamentDashboardSection({ portal, onOpenDetails }: { portal: PortalState | null; onOpenDetails: (title: string, rows: RowRecord[], columns: DetailColumn[]) => void }) {
  const summary = portal?.summary ?? {}
  return (
    <div className="adminPageContent" data-admin-page="tournaments">
      <section className="adminPageIntro">
        <h2>Tournaments</h2>
        <p className="small">Host, organizer, registration, scoring, and tournament status metrics.</p>
      </section>
      <div className="adminMetricGrid">
        <MetricButton label="Tournaments" value={Number(summary.tournamentCount || 0)} onClick={() => onOpenDetails('Tournament metadata', (portal?.tournaments ?? []) as RowRecord[], tournamentColumns)} />
        <MetricButton label="Host accounts" value={Number(summary.hostCount || 0)} onClick={() => onOpenDetails('Host account metadata', (portal?.hosts ?? []) as RowRecord[], hostColumns)} />
        <MetricCard label="Validated hosts" value={Number(summary.validatedHostCount || 0)} />
        <MetricButton label="Organizer accounts" value={Number(summary.organizerCount || 0)} onClick={() => onOpenDetails('Organizer account metadata', (portal?.organizers ?? []) as RowRecord[], organizerColumns)} />
        <MetricCard label="Hosts with tournaments" value={Number(summary.tournamentHostCount || 0)} />
        <MetricCard label="Registrations" value={Number(summary.tournamentRegistrationCount || 0)} />
        <MetricCard label="Tournaments with registrations" value={Number(summary.tournamentsWithRegistrationsCount || 0)} />
        <MetricCard label="Scored tournament teams" value={Number(summary.scoredTournamentTeamCount || 0)} />
      </div>
      <div className="adminPortalReviewGrid">
        <div className="adminReviewColumn">
          <TournamentSection portal={portal} onOpenDetails={onOpenDetails} />
        </div>
        <div className="adminReviewColumn">
          <AccountSummarySection portal={portal} onOpenDetails={onOpenDetails} />
        </div>
      </div>
    </div>
  )
}

function AdminDashboardSection({
  portal,
  adminUser,
  adminRows,
  requestRows,
  newAdminForm,
  setNewAdminForm,
  onCreateAdmin,
  currentAdminUserId,
  deletingAdminUserId,
  onDeleteAdmin,
  approvingRequestId,
  deletingRequestId,
  onApproveRequest,
  onDeleteRequest,
}: {
  portal: PortalState | null
  adminUser: { id?: string; username: string; email: string }
  adminRows: RowRecord[]
  requestRows: RowRecord[]
  newAdminForm: { username: string; email: string; password: string }
  setNewAdminForm: React.Dispatch<React.SetStateAction<{ username: string; email: string; password: string }>>
  onCreateAdmin: (event: FormEvent) => Promise<void>
  currentAdminUserId?: string | null
  deletingAdminUserId: string | null
  onDeleteAdmin: (adminUserId: string) => Promise<void>
  approvingRequestId: string | null
  deletingRequestId: string | null
  onApproveRequest: (requestId: string) => Promise<void>
  onDeleteRequest: (requestId: string) => Promise<void>
}) {
  const summary = portal?.summary ?? {}
  return (
    <div className="adminPageContent" data-admin-page="admin">
      <section className="adminPageIntro adminPageIntro--actions">
        <div>
          <h2>Admin</h2>
          <p className="small">Admin accounts, golf-course access approvals, and operational administration.</p>
        </div>
        <Link className="btn" to="/golfadmin/scheduled-jobs">Scheduled jobs</Link>
      </section>
      <div className="adminMetricGrid">
        <MetricCard label="Admin users" value={Number(summary.adminCount || adminRows.length)} />
        <MetricCard label="Active admins" value={Number(summary.activeAdminCount || 0)} />
        <MetricCard label="Pending requests" value={Number(summary.hostAccountRequestCount || 0)} />
        <MetricCard label="Signed in admin" value={adminUser.username} detail={adminUser.email} />
      </div>
      <div className="adminPortalReviewGrid">
        <div className="adminReviewColumn">
          <RequestTable rows={requestRows} approvingRequestId={approvingRequestId} deletingRequestId={deletingRequestId} onApprove={onApproveRequest} onDelete={onDeleteRequest} />
        </div>
        <div className="adminReviewColumn">
          <div className="grid grid2 adminCompactForms" style={{ alignItems: 'start' }}>
            <FormCard title="Create admin user" subtitle="Provision another admin for the dedicated portal.">
              <form className="formStack" onSubmit={onCreateAdmin}>
                <div><label className="label">Username</label><input className="input" value={newAdminForm.username} onChange={(e) => setNewAdminForm((state) => ({ ...state, username: e.target.value }))} /></div>
                <div><label className="label">Email</label><input className="input" type="email" value={newAdminForm.email} onChange={(e) => setNewAdminForm((state) => ({ ...state, email: e.target.value }))} /></div>
                <div>
                  <label className="label">Password</label>
                  <input className="input" type="password" minLength={10} autoComplete="new-password" value={newAdminForm.password} onChange={(e) => setNewAdminForm((state) => ({ ...state, password: e.target.value }))} />
                  <PasswordCriteria password={newAdminForm.password} />
                </div>
                <button className="btnPrimary" type="submit">Create admin user</button>
              </form>
            </FormCard>
            <AdminUsersTable rows={adminRows} currentAdminUserId={currentAdminUserId} deletingAdminUserId={deletingAdminUserId} onDelete={onDeleteAdmin} />
          </div>
        </div>
      </div>
    </div>
  )
}

const userColumns: DetailColumn[] = [
  { key: 'email', label: 'Email' },
  { key: 'name', label: 'Name' },
  { key: 'emailVerified', label: 'Verified' },
  { key: 'createdAt', label: 'Created' },
]
const teamColumns: DetailColumn[] = [
  { key: 'name', label: 'Team' },
  { key: 'created_by_email', label: 'Created by' },
  { key: 'team_member_emails', label: 'Team member emails' },
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
const challengeColumns: DetailColumn[] = [
  { key: 'message_type', label: 'Type' },
  { key: 'challenge_status', label: 'Status' },
  { key: 'proposer_team_name', label: 'Proposer' },
  { key: 'challenged_team_name', label: 'Challenged' },
  { key: 'challenge_course', label: 'Golf course' },
  { key: 'challenge_date', label: 'Challenge date' },
  { key: 'created_at', label: 'Created' },
]
const adminColumns: DetailColumn[] = [
  { key: 'username', label: 'Username' },
  { key: 'email', label: 'Email' },
  { key: 'is_active', label: 'Active' },
  { key: 'created_at', label: 'Created' },
]

function MarketingDashboardSection({
  form,
  loading,
  saving,
  sections,
  sectionForm,
  sectionSaving,
  deletingSectionId,
  onChange,
  onSave,
  onSectionFormChange,
  onAddSection,
  onDeleteSection,
}: {
  form: HomeMarketingSettings
  loading: boolean
  saving: boolean
  sections: MarketingVideoSection[]
  sectionForm: CreateMarketingVideoSectionInput
  sectionSaving: boolean
  deletingSectionId: string | null
  onChange: (next: HomeMarketingSettings) => void
  onSave: (event: FormEvent) => void
  onSectionFormChange: (next: CreateMarketingVideoSectionInput) => void
  onAddSection: (event: FormEvent) => void
  onDeleteSection: (section: MarketingVideoSection) => void
}) {
  const userSections = sections.filter((section) => section.audience === MARKETING_VIDEO_AUDIENCES.golfHomiez)
  const courseSections = sections.filter((section) => section.audience === MARKETING_VIDEO_AUDIENCES.golfHomiezCourses)

  function renderSectionList(title: string, pagePath: string, pageSections: MarketingVideoSection[]) {
    return (
      <section className="adminMarketingVideoGroup" aria-label={`${title} helper videos`}>
        <div className="adminMarketingVideoGroupHeader">
          <div>
            <h3>{title}</h3>
            <Link to={pagePath} target="_blank" rel="noreferrer">Open video page</Link>
          </div>
          <span className="pill">{pageSections.length} sections</span>
        </div>
        {pageSections.length ? (
          <div className="adminMarketingVideoSectionList">
            {pageSections.map((section) => (
              <article key={section.id} className="adminMarketingVideoSectionRow">
                <div className="adminMarketingVideoSectionDetails">
                  <strong>{section.name}</strong>
                  <span className="small">{section.youtubeUrl}</span>
                  <Link className="adminMarketingRelativeLink" to={section.relativeLink} target="_blank" rel="noreferrer">
                    {section.relativeLink}
                  </Link>
                </div>
                <button
                  className="btn btnDanger"
                  type="button"
                  disabled={loading || sectionSaving || deletingSectionId === section.id}
                  onClick={() => onDeleteSection(section)}
                >
                  {deletingSectionId === section.id ? 'Deleting…' : 'Delete'}
                </button>
              </article>
            ))}
          </div>
        ) : <p className="small">No helper video sections are configured for this page.</p>}
      </section>
    )
  }

  return (
    <div className="adminPageContent" data-admin-page="marketing">
      <section className="adminPageIntro">
        <h2>Marketing</h2>
        <p className="small">Manage the home-page commercial videos and the directly linkable GolfHomiez helper-video libraries.</p>
      </section>

      <section className="card adminPanel adminMarketingPanel">
        <div className="adminMarketingPanelHeading">
          <h3>Home page videos</h3>
          <p className="small">These are the two videos shown directly on the GolfHomiez home page.</p>
        </div>
        <form className="formStack" onSubmit={onSave}>
          <div>
            <label className="label" htmlFor="golf-homiez-video-url">Golf Homiez YouTube URL</label>
            <input
              id="golf-homiez-video-url"
              className="input"
              type="url"
              inputMode="url"
              value={form.golfHomiezVideoUrl}
              onChange={(event) => onChange({ ...form, golfHomiezVideoUrl: event.target.value })}
              placeholder={DEFAULT_HOME_MARKETING_SETTINGS.golfHomiezVideoUrl}
              disabled={loading || saving}
              required
            />
            <div className="small adminMarketingHelp">Displayed in the Golf Homiez section on the home page. Its title links to /golfhomiezvideos.</div>
          </div>
          <div>
            <label className="label" htmlFor="golf-homiez-courses-video-url">Golf Homiez Courses YouTube URL</label>
            <input
              id="golf-homiez-courses-video-url"
              className="input"
              type="url"
              inputMode="url"
              value={form.golfHomiezCoursesVideoUrl}
              onChange={(event) => onChange({ ...form, golfHomiezCoursesVideoUrl: event.target.value })}
              placeholder={DEFAULT_HOME_MARKETING_SETTINGS.golfHomiezCoursesVideoUrl}
              disabled={loading || saving}
              required
            />
            <div className="small adminMarketingHelp">Displayed in the Golf Homiez Courses section on the home page. Its title links to /golfhomiezcoursevideos.</div>
          </div>
          <div className="adminMarketingActions">
            <button className="btnPrimary" type="submit" disabled={loading || saving}>
              {saving ? 'Saving…' : loading ? 'Loading…' : 'Save home videos'}
            </button>
          </div>
        </form>
      </section>

      <section className="card adminPanel adminMarketingPanel">
        <div className="adminMarketingPanelHeading">
          <h3>Helper video sections</h3>
          <p className="small">Add a named YouTube section to either video page. GolfHomiez automatically creates a stable relative link that can be used from anywhere in the application.</p>
        </div>
        <form className="adminMarketingSectionForm" onSubmit={onAddSection}>
          <div>
            <label className="label" htmlFor="marketing-video-audience">Video page</label>
            <select
              id="marketing-video-audience"
              className="select"
              value={sectionForm.audience}
              onChange={(event) => onSectionFormChange({ ...sectionForm, audience: event.target.value as CreateMarketingVideoSectionInput['audience'] })}
              disabled={loading || sectionSaving}
            >
              <option value={MARKETING_VIDEO_AUDIENCES.golfHomiez}>Golf Homiez Users</option>
              <option value={MARKETING_VIDEO_AUDIENCES.golfHomiezCourses}>Golf Homiez Courses</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="marketing-video-section-name">Section name</label>
            <input
              id="marketing-video-section-name"
              className="input"
              type="text"
              maxLength={160}
              value={sectionForm.name}
              onChange={(event) => onSectionFormChange({ ...sectionForm, name: event.target.value })}
              placeholder="Example: Register for a tournament"
              disabled={loading || sectionSaving}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="marketing-video-section-url">YouTube URL</label>
            <input
              id="marketing-video-section-url"
              className="input"
              type="url"
              inputMode="url"
              value={sectionForm.youtubeUrl}
              onChange={(event) => onSectionFormChange({ ...sectionForm, youtubeUrl: event.target.value })}
              placeholder="https://www.youtube.com/shorts/..."
              disabled={loading || sectionSaving}
              required
            />
          </div>
          <div className="adminMarketingActions">
            <button className="btnPrimary" type="submit" disabled={loading || sectionSaving}>
              {sectionSaving ? 'Adding…' : 'Add video section'}
            </button>
          </div>
        </form>

        <div className="adminMarketingVideoGroups">
          {renderSectionList('Golf Homiez Users', '/golfhomiezvideos', userSections)}
          {renderSectionList('Golf Homiez Courses', '/golfhomiezcoursevideos', courseSections)}
        </div>
      </section>
    </div>
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
  const [newAdminForm, setNewAdminForm] = useState({ username: '', email: '', password: '' })
  const [resetIdentifier, setResetIdentifier] = useState('')
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null)
  const [deletingRequestId, setDeletingRequestId] = useState<string | null>(null)
  const [deletingAdminUserId, setDeletingAdminUserId] = useState<string | null>(null)
  const [detailModal, setDetailModal] = useState<DetailModalState>(null)
  const [activePage, setActivePage] = useState<AdminPortalPage>('golf')
  const [apiCallFilters, setApiCallFilters] = useState<ExternalApiCallFilters>(() => {
    const today = getUserTodayISO()
    return { fromDate: today, toDate: today, apiType: '', endpoint: '' }
  })
  const [apiCallReport, setApiCallReport] = useState<ExternalApiCallReport | null>(null)
  const [apiCallLoading, setApiCallLoading] = useState(false)
  const [apiCallError, setApiCallError] = useState<string | null>(null)
  const [apiCallRefreshedAt, setApiCallRefreshedAt] = useState<string | null>(null)
  const [marketingForm, setMarketingForm] = useState<HomeMarketingSettings>(DEFAULT_HOME_MARKETING_SETTINGS)
  const [marketingLoading, setMarketingLoading] = useState(false)
  const [marketingSaving, setMarketingSaving] = useState(false)
  const [marketingLoaded, setMarketingLoaded] = useState(false)
  const [marketingSections, setMarketingSections] = useState<MarketingVideoSection[]>([])
  const [marketingSectionForm, setMarketingSectionForm] = useState<CreateMarketingVideoSectionInput>({
    audience: MARKETING_VIDEO_AUDIENCES.golfHomiez,
    name: '',
    youtubeUrl: '',
  })
  const [marketingSectionSaving, setMarketingSectionSaving] = useState(false)
  const [deletingMarketingSectionId, setDeletingMarketingSectionId] = useState<string | null>(null)

  async function loadPortal() {
    logFrontendEvent({ category: 'admin.portal', message: 'admin_portal_metadata_load_started' })
    const portalData = await fetchAdminPortal()
    setPortal(portalData)
    logFrontendEvent({ category: 'admin.portal', message: 'admin_portal_metadata_loaded', data: { summary: portalData.summary, teamsWithMemberEmails: (portalData.teams || []).filter((team) => team.team_member_emails).length } })
  }

  async function loadExternalApiCalls(filters: ExternalApiCallFilters = apiCallFilters) {
    setApiCallLoading(true)
    setApiCallError(null)
    try {
      logFrontendEvent({ category: 'admin.portal.api_calls', message: 'external_api_call_metrics_load_started', data: { filters } })
      const report = await fetchExternalApiCallReport(filters)
      setApiCallReport(report)
      setApiCallRefreshedAt(report.generatedAt || new Date().toISOString())
      logFrontendEvent({ category: 'admin.portal.api_calls', message: 'external_api_call_metrics_loaded', data: { filters: report.filters, totalCalls: report.totalCalls, rowCount: report.rows.length } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load external API call metrics.'
      setApiCallError(message)
      logFrontendEvent({ category: 'admin.portal.api_calls', level: 'error', message: 'external_api_call_metrics_load_failed', data: { filters, error: message } })
    } finally {
      setApiCallLoading(false)
    }
  }

  async function loadMarketingSettings() {
    setMarketingLoading(true)
    setError(null)
    try {
      logFrontendEvent({ category: 'admin.portal.marketing', message: 'marketing_content_load_started' })
      const [settings, sections] = await Promise.all([
        fetchAdminHomeMarketingSettings(),
        fetchAdminMarketingVideoSections(),
      ])
      setMarketingForm(settings)
      setMarketingSections(sections)
      setMarketingLoaded(true)
      logFrontendEvent({
        category: 'admin.portal.marketing',
        message: 'marketing_content_loaded',
        data: { updatedAt: settings.updatedAt || null, sectionCount: sections.length },
      })
    } catch (err) {
      const loadError = err instanceof Error ? err.message : 'Could not load marketing content.'
      setError(loadError)
      logFrontendEvent({ category: 'admin.portal.marketing', level: 'error', message: 'marketing_content_load_failed', data: { error: loadError } })
    } finally {
      setMarketingLoading(false)
    }
  }

  async function onSaveMarketing(event: FormEvent) {
    event.preventDefault()
    setMarketingSaving(true)
    setMessage(null)
    setError(null)
    try {
      logFrontendEvent({ category: 'admin.portal.marketing', message: 'home_marketing_settings_save_started' })
      const settings = await saveAdminHomeMarketingSettings({
        golfHomiezVideoUrl: marketingForm.golfHomiezVideoUrl,
        golfHomiezCoursesVideoUrl: marketingForm.golfHomiezCoursesVideoUrl,
      })
      setMarketingForm(settings)
      setMarketingLoaded(true)
      setMessage('Home page marketing videos saved.')
      logFrontendEvent({ category: 'admin.portal.marketing', message: 'home_marketing_settings_saved', data: { updatedAt: settings.updatedAt || null } })
    } catch (err) {
      const saveError = err instanceof Error ? err.message : 'Could not save home marketing settings.'
      setError(saveError)
      logFrontendEvent({ category: 'admin.portal.marketing', level: 'error', message: 'home_marketing_settings_save_failed', data: { error: saveError } })
    } finally {
      setMarketingSaving(false)
    }
  }

  async function onAddMarketingSection(event: FormEvent) {
    event.preventDefault()
    setMarketingSectionSaving(true)
    setMessage(null)
    setError(null)
    try {
      logFrontendEvent({
        category: 'admin.portal.marketing',
        message: 'marketing_video_section_create_started',
        data: { audience: marketingSectionForm.audience, name: marketingSectionForm.name },
      })
      const section = await createAdminMarketingVideoSection(marketingSectionForm)
      setMarketingSections((current) => [...current, section].sort((a, b) => a.audience.localeCompare(b.audience) || a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)))
      setMarketingSectionForm((current) => ({ ...current, name: '', youtubeUrl: '' }))
      setMessage(`Video section "${section.name}" added.`)
      logFrontendEvent({
        category: 'admin.portal.marketing',
        message: 'marketing_video_section_created',
        data: { sectionId: section.id, audience: section.audience, relativeLink: section.relativeLink },
      })
    } catch (err) {
      const createError = err instanceof Error ? err.message : 'Could not add marketing video section.'
      setError(createError)
      logFrontendEvent({ category: 'admin.portal.marketing', level: 'error', message: 'marketing_video_section_create_failed', data: { error: createError } })
    } finally {
      setMarketingSectionSaving(false)
    }
  }

  async function onDeleteMarketingSection(section: MarketingVideoSection) {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(`Delete the video section "${section.name}"?`)
      if (!confirmed) return
    }
    setDeletingMarketingSectionId(section.id)
    setMessage(null)
    setError(null)
    try {
      logFrontendEvent({
        category: 'admin.portal.marketing',
        message: 'marketing_video_section_delete_started',
        data: { sectionId: section.id, audience: section.audience, relativeLink: section.relativeLink },
      })
      await deleteAdminMarketingVideoSection(section.id)
      setMarketingSections((current) => current.filter((entry) => entry.id !== section.id))
      setMessage(`Video section "${section.name}" deleted.`)
      logFrontendEvent({ category: 'admin.portal.marketing', message: 'marketing_video_section_deleted', data: { sectionId: section.id } })
    } catch (err) {
      const deleteError = err instanceof Error ? err.message : 'Could not delete marketing video section.'
      setError(deleteError)
      logFrontendEvent({ category: 'admin.portal.marketing', level: 'error', message: 'marketing_video_section_delete_failed', data: { sectionId: section.id, error: deleteError } })
    } finally {
      setDeletingMarketingSectionId(null)
    }
  }

  useEffect(() => {
    if (!adminUser) {
      setPortal(null)
      setApiCallReport(null)
      setMarketingForm(DEFAULT_HOME_MARKETING_SETTINGS)
      setMarketingSections([])
      setMarketingSectionForm({ audience: MARKETING_VIDEO_AUDIENCES.golfHomiez, name: '', youtubeUrl: '' })
      setMarketingLoaded(false)
      setActivePage('golf')
      return
    }
    void loadPortal()
  }, [adminUser])

  function selectAdminPage(page: AdminPortalPage) {
    setActivePage(page)
    logFrontendEvent({ category: 'admin.portal.navigation', message: 'admin_portal_page_selected', data: { page } })
    if (page === 'api' && !apiCallReport && !apiCallLoading) void loadExternalApiCalls(apiCallFilters)
    if (page === 'marketing' && !marketingLoaded && !marketingLoading) void loadMarketingSettings()
  }

  function openDetails(title: string, rows: RowRecord[], columns: DetailColumn[]) {
    logFrontendEvent({ category: 'admin.portal.metadata', message: 'admin_metadata_modal_opened', data: { title, recordCount: rows.length } })
    setDetailModal({ title, rows, columns })
  }

  function resetExternalApiCallFilters() {
    const today = getUserTodayISO()
    const nextFilters = { fromDate: today, toDate: today, apiType: '', endpoint: '' }
    setApiCallFilters(nextFilters)
    void loadExternalApiCalls(nextFilters)
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
    setMarketingLoaded(false)
    setMarketingForm(DEFAULT_HOME_MARKETING_SETTINGS)
    setMarketingSections([])
    setMarketingSectionForm({ audience: MARKETING_VIDEO_AUDIENCES.golfHomiez, name: '', youtubeUrl: '' })
    setActivePage('golf')
    setLoginForm({ username: '', password: '' })
    setMessage('Signed out of admin portal.')
    navigate('/golfadmin', { replace: true })
  }

  async function onCreateAdmin(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    setError(null)
    try {
      assertPasswordPolicy(newAdminForm.password)
      logFrontendEvent({ category: 'admin.portal.admin_user', message: 'admin_user_create_started', data: { email: newAdminForm.email } })
      const result = await createAdminAccount(newAdminForm.username, newAdminForm.email, newAdminForm.password)
      setMessage(`Admin user ${result.adminUser.username} created.`)
      logFrontendEvent({ category: 'admin.portal.admin_user', message: 'admin_user_create_succeeded', data: { adminUserId: result.adminUser.id || null, email: result.adminUser.email } })
      setNewAdminForm({ username: '', email: '', password: '' })
      await loadPortal()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create admin account.'
      setError(message)
      logFrontendEvent({ category: 'admin.portal.admin_user', level: 'error', message: 'admin_user_create_failed', data: { email: newAdminForm.email, error: message } })
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
      logFrontendEvent({ category: 'admin.portal.host_approval', message: 'host_account_approval_started', data: { requestId } })
      const result = await approveHostAccountRequest(requestId)
      logFrontendEvent({
        category: 'admin.portal.host_approval',
        message: 'host_account_approval_completed',
        data: { requestId, hostAccountId: result.hostAccountId || null, publicPageSlug: result.publicPage?.slug || null },
      })
      setMessage(result.publicPage?.url
        ? `Golf-course account request approved. The public course page was created at ${result.publicPage.url}.`
        : 'Golf-course account request approved. The requester has been emailed with next steps and host access details.')
      await loadPortal()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not approve the golf-course account request.'
      logFrontendEvent({ category: 'admin.portal.host_approval', level: 'error', message: 'host_account_approval_failed', data: { requestId, error: message } })
      setError(message)
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
          <PageHero eyebrow="Administration" title="GolfHomiez admin portal" subtitle="Golf usage, tournament operations, API usage, and administration are separated into focused pages." />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div className="small">Signed in as <strong>{adminUser.username}</strong> ({adminUser.email})</div>
            <button className="btn" type="button" onClick={onLogout}>Sign out</button>
          </div>
          {message ? <p className="statusMessage statusSuccess">{message}</p> : null}
          {error ? <p className="statusMessage statusError">{error}</p> : null}
          <AdminPortalTabs activePage={activePage} onSelect={selectAdminPage} />
        </div>

        <div className="adminPortalPageBody">
          {activePage === 'golf' ? <GolfDashboardSection portal={portal} onOpenDetails={openDetails} /> : null}
          {activePage === 'tournaments' ? <TournamentDashboardSection portal={portal} onOpenDetails={openDetails} /> : null}
          {activePage === 'api' ? (
            <div className="adminPageContent" data-admin-page="api">
              <section className="adminPageIntro"><h2>API Usage</h2><p className="small">External API volume, reliability, latency, endpoint, and provider metrics.</p></section>
              <ExternalApiCallsSection
                report={apiCallReport}
                filters={apiCallFilters}
                loading={apiCallLoading}
                error={apiCallError}
                onFilterChange={setApiCallFilters}
                onApply={() => void loadExternalApiCalls(apiCallFilters)}
                onReset={resetExternalApiCallFilters}
                onRefresh={() => void loadExternalApiCalls(apiCallFilters)}
                refreshedAt={apiCallRefreshedAt}
              />
            </div>
          ) : null}
          {activePage === 'marketing' ? (
            <MarketingDashboardSection
              form={marketingForm}
              loading={marketingLoading}
              saving={marketingSaving}
              sections={marketingSections}
              sectionForm={marketingSectionForm}
              sectionSaving={marketingSectionSaving}
              deletingSectionId={deletingMarketingSectionId}
              onChange={setMarketingForm}
              onSave={onSaveMarketing}
              onSectionFormChange={setMarketingSectionForm}
              onAddSection={onAddMarketingSection}
              onDeleteSection={onDeleteMarketingSection}
            />
          ) : null}
          {activePage === 'admin' ? (
            <AdminDashboardSection
              portal={portal}
              adminUser={adminUser}
              adminRows={adminRows}
              requestRows={requestRows}
              newAdminForm={newAdminForm}
              setNewAdminForm={setNewAdminForm}
              onCreateAdmin={onCreateAdmin}
              currentAdminUserId={adminUser.id}
              deletingAdminUserId={deletingAdminUserId}
              onDeleteAdmin={onDeleteAdmin}
              approvingRequestId={approvingRequestId}
              deletingRequestId={deletingRequestId}
              onApproveRequest={onApproveRequest}
              onDeleteRequest={onDeleteRequest}
            />
          ) : null}
        </div>
      </div>
      <DetailModal modal={detailModal} onClose={() => setDetailModal(null)} />
    </div>
  )
}
