import { api } from './api'

export type AdminUser = {
  id: string
  username: string
  email: string
  is_active?: number
  created_at?: string
  updated_at?: string
}

export type HostInvite = {
  id: string
  email: string
  inviteeName?: string | null
  golfCourseName: string
  securityKey: string
  registerUrl: string
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
    invites: Array<Record<string, unknown>>
    users: Array<Record<string, unknown>>
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
  return api<{ adminUser: AdminUser }>('/api/admin/admin-users', {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
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

export async function createHostInvite(email: string, inviteeName: string, golfCourseName: string) {
  return api<{ invite: HostInvite }>('/api/admin/host-invites', {
    method: 'POST',
    body: JSON.stringify({ email, inviteeName, golfCourseName }),
  })
}
