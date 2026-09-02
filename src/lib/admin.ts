import { api } from './api'

export type AdminUser = {
  id: string
  username: string
  email: string
  is_active?: number
  created_at?: string
  updated_at?: string
}

export async function adminLogin(username: string, password: string) {
  return api<{ adminUser: AdminUser }>('/api/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export async function adminLogout() {
  return api<{ ok: boolean }>('/api/admin/auth/logout', { method: 'POST' })
}

export async function fetchAdminSession() {
  return api<{ adminUser: AdminUser }>('/api/admin/session')
}

export async function fetchAdminPortal() {
  return api<{
    summary: Record<string, number>
    admins: AdminUser[]
    hosts: Array<Record<string, unknown>>
    organizers: Array<Record<string, unknown>>
    tournaments: Array<Record<string, unknown>>
    tournamentStatusCounts: Array<Record<string, unknown>>
    challenges: Array<Record<string, unknown>>
    challengeStatusCounts: Array<Record<string, unknown>>
    users: Array<Record<string, unknown>>
    appUsers: Array<Record<string, unknown>>
    teams: Array<Record<string, unknown>>
    scores: Array<Record<string, unknown>>
    requests: Array<Record<string, unknown>>
    homieTokenUsers: Array<Record<string, unknown>>
    paidHomies: Array<Record<string, unknown>>
  }>('/api/admin/portal')
}

export async function approveHostAccountRequest(requestId: string) {
  return api<{ request: Record<string, unknown>; hostAccountId?: string | null; publicPage?: { slug: string; path: string; url: string } | null; approved: true }>(`/api/admin/host-account-requests/${encodeURIComponent(requestId)}/approve`, {
    method: 'POST',
  })
}


export async function deleteHostAccountRequest(requestId: string) {
  return api<{ deleted: true; requestId: string }>(`/api/admin/host-account-requests/${encodeURIComponent(requestId)}`, {
    method: 'DELETE',
  })
}

export async function createAdminAccount(username: string, email: string, password: string) {
  return api<{ adminUser: AdminUser; adminUsers?: AdminUser[] }>('/api/admin/admin-users', {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  })
}

export async function deleteAdminAccount(adminUserId: string) {
  return api<{ deleted: true; adminUser: AdminUser; adminUsers?: AdminUser[] }>(`/api/admin/admin-users/${encodeURIComponent(adminUserId)}`, {
    method: 'DELETE',
  })
}

export async function requestAdminPasswordReset(identifier: string) {
  return api<{ ok: boolean }>('/api/admin/request-password-reset', {
    method: 'POST',
    body: JSON.stringify({ identifier, username: identifier, email: identifier }),
  })
}

export async function resetAdminPassword(token: string, password: string) {
  return api<{ ok: boolean }>('/api/admin/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })
}


export type ExternalApiCallFilters = {
  fromDate: string
  toDate: string
  apiType?: string
  endpoint?: string
}

export type ExternalApiCallSummaryRow = {
  apiType: string
  endpoint: string
  callCount: number
  successCount: number
  failureCount: number
  averageDurationMs?: number | null
  firstCallAt?: string | null
  lastCallAt?: string | null
}

export type ExternalApiCallReport = {
  filters: Required<ExternalApiCallFilters>
  generatedAt: string
  totalCalls: number
  successCount: number
  failureCount: number
  successRatePercent: number
  averageDurationMs?: number | null
  distinctEndpointCount: number
  rows: ExternalApiCallSummaryRow[]
  apiTypes: Array<{ apiType: string; callCount: number }>
  endpoints: Array<{ endpoint: string; callCount: number }>
}

export async function fetchExternalApiCallReport(filters: ExternalApiCallFilters) {
  const params = new URLSearchParams()
  if (filters.fromDate) params.set('fromDate', filters.fromDate)
  if (filters.toDate) params.set('toDate', filters.toDate)
  if (filters.apiType) params.set('apiType', filters.apiType)
  if (filters.endpoint) params.set('endpoint', filters.endpoint)
  const query = params.toString()
  return api<ExternalApiCallReport>(`/api/admin/external-api-calls${query ? `?${query}` : ''}`)
}


export type ScheduledJobLastRun = {
  id: string
  triggeredBy?: string | null
  status?: string | null
  startedAt?: string | null
  completedAt?: string | null
  durationMs?: number | null
  output?: unknown
  error?: string | null
  correlationId?: string | null
  adminUserEmail?: string | null
}

export type ScheduledJobSchedule = {
  type: 'manual' | 'daily' | 'weekly' | 'monthly'
  time?: string | null
  dayOfWeek?: number | null
  dayOfMonth?: number | null
}

export type ScheduledJob = {
  id: string
  name: string
  description?: string | null
  scheduleLabel?: string | null
  scheduleTimeZone?: string | null
  schedule?: ScheduledJobSchedule
  jobConfig?: { matchValues?: string[]; [key: string]: unknown }
  createdAt?: string | null
  nextRunAt?: string | null
  updatedAt?: string | null
  lastRun?: ScheduledJobLastRun | null
  canCancel?: boolean
  activeRunId?: string | null
}

export async function fetchScheduledJobs() {
  return api<{ jobs: ScheduledJob[] }>('/api/admin/scheduled-jobs')
}

export async function runScheduledJob(jobId: string) {
  return api<{ result: { jobId: string; runId: string | null; status: string; output?: unknown; nextRunAt?: string | null; correlationId?: string | null }; jobs: ScheduledJob[] }>(`/api/admin/scheduled-jobs/${encodeURIComponent(jobId)}/run`, {
    method: 'POST',
  })
}

export async function updateScheduledJobSchedule(jobId: string, input: { schedule: ScheduledJobSchedule; jobConfig?: Record<string, unknown> }) {
  return api<{ job: ScheduledJob; jobs: ScheduledJob[] }>(`/api/admin/scheduled-jobs/${encodeURIComponent(jobId)}/schedule`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function cancelScheduledJob(jobId: string) {
  return api<{ result: { jobId: string; runId?: string | null; status: string; correlationId?: string | null; requestCorrelationId?: string | null }; jobs: ScheduledJob[] }>(`/api/admin/scheduled-jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  })
}

export type BillingAccessCodeRedemption = { id: string; redeemedAt: string; userId?: string | null; email?: string | null; name?: string | null }
export type BillingAccessCode = { id: string; code: string; homieToken: string; codeLastFour: string; label?: string | null; maxRedemptions?: number | null; redemptionCount: number; expiresAt?: string | null; active: boolean; createdAt: string; redemptions: BillingAccessCodeRedemption[] }
export const fetchBillingAccessCodes = () => api<{ codes: BillingAccessCode[] }>('/api/admin/billing/access-codes')
export const createBillingAccessCode = (input: { homieToken: string; label?: string; maxRedemptions?: number | null; expiresAt?: string | null }) => api<{ created: { id: string; code: string; homieToken: string; codeLastFour: string }; codes: BillingAccessCode[] }>('/api/admin/billing/access-codes', { method: 'POST', body: JSON.stringify(input) })
export const updateBillingAccessCode = (id: string, input: { active?: boolean; maxRedemptions?: number | null; expiresAt?: string | null }) => api<{ codes: BillingAccessCode[] }>(`/api/admin/billing/access-codes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
