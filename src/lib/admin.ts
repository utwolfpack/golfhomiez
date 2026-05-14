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
    users: Array<Record<string, unknown>>
    appUsers: Array<Record<string, unknown>>
    teams: Array<Record<string, unknown>>
    scores: Array<Record<string, unknown>>
    requests: Array<Record<string, unknown>>
  }>('/api/admin/portal')
}

export async function approveHostAccountRequest(requestId: string) {
  return api<{ request: Record<string, unknown>; hostAccountId?: string | null; approved: true }>(`/api/admin/host-account-requests/${encodeURIComponent(requestId)}/approve`, {
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


export type ScheduledJobLastRun = {
  id: string
  triggeredBy?: string | null
  status?: string | null
  startedAt?: string | null
  completedAt?: string | null
  output?: unknown
  error?: string | null
  correlationId?: string | null
  adminUserEmail?: string | null
}

export type ScheduledJob = {
  id: string
  name: string
  description?: string | null
  scheduleLabel?: string | null
  scheduleTimeZone?: string | null
  createdAt?: string | null
  nextRunAt?: string | null
  updatedAt?: string | null
  lastRun?: ScheduledJobLastRun | null
}

export async function fetchScheduledJobs() {
  return api<{ jobs: ScheduledJob[] }>('/api/admin/scheduled-jobs')
}

export async function runScheduledJob(jobId: string) {
  return api<{ result: { jobId: string; runId: string; status: string; output?: unknown; nextRunAt?: string | null }; jobs: ScheduledJob[] }>(`/api/admin/scheduled-jobs/${encodeURIComponent(jobId)}/run`, {
    method: 'POST',
  })
}
