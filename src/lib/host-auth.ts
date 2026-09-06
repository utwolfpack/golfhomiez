import { requestJson } from './request'

export type HostAccount = {
  id: string
  email: string
  golfCourseName: string
  golfCourseId?: string | null
  contactName?: string | null
  phone?: string | null
  websiteUrl?: string | null
  notes?: string | null
  golfCourseAddress?: string | null
  defaultTournamentLocation?: string | null
  isCourseAdmin?: boolean
  createdByHostAccountId?: string | null
  isValidated: boolean
  validatedAt: string | null
}

export type HostAccountRequestPayload = {
  firstName: string
  lastName: string
  email: string
  stateCode: string
  stateName: string
  golfCourseId: string
  golfCourseName: string
  representativeDetails: string
  password: string
}

export type HostPendingAccountRequest = {
  id: string
  firstName: string
  lastName: string
  email: string
  stateCode: string
  stateName: string
  golfCourseId?: string | null
  golfCourseName: string
  representativeDetails: string
  status: string
  approvalRoute: string
  routedHostAccountId?: string | null
  routedHostEmail?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export async function getHostSession() {
  return requestJson<{ hostAccount: HostAccount | null }>('/api/host/session')
}

export async function requestHostAccount(payload: HostAccountRequestPayload) {
  return requestJson<{ request: { id: string; status: string; approvalRoute?: string; routedHostAccountId?: string | null; routedHostEmail?: string | null; primaryHostName?: string | null } }>('/api/host/account-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}


export async function loginHostAccount(payload: { email: string; password: string }) {
  return requestJson<{ hostAccount: HostAccount }>('/api/host/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function logoutHostAccount() {
  return requestJson<null>('/api/host/logout', { method: 'POST' })
}

export async function requestHostPasswordReset(email: string) {
  return requestJson<{ ok: boolean }>('/api/host/request-password-reset', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function resetHostPassword(token: string, password: string) {
  return requestJson<{ ok: boolean }>('/api/host/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })
}

export async function fetchHostPortal() {
  return requestJson<{
    account: HostAccount & { createdAt?: string | null; updatedAt?: string | null }
    hostAccounts: Array<HostAccount & { createdAt?: string | null; updatedAt?: string | null }>
    invites: Array<{ id: string; email: string; inviteeName: string | null; golfCourseName: string | null; createdAt: string | null; consumedAt: string | null; expiresAt: string | null }>
    tournaments: Array<{ id: string; name: string; tournamentIdentifier?: string | null; organizerEmail?: string | null; inviteStatus?: string | null; inviteUrl?: string | null; startDate?: string | null; endDate?: string | null; status?: string | null }>
    pendingHostAccountRequests: HostPendingAccountRequest[]
  }>('/api/host/portal')
}

export async function reviewHostAccountRequest(requestId: string, decision: 'approve' | 'deny') {
  return requestJson<{ approved: boolean; denied: boolean; decision: 'approve' | 'deny'; hostAccountId?: string | null }>(`/api/host/account-requests/${encodeURIComponent(requestId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  })
}


export async function createAdditionalHostAccount(payload: { email: string; contactName: string; password: string }) {
  return requestJson<{ hostAccount: HostAccount }>('/api/host/accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function transferHostAdmin(payload: { targetHostAccountId: string; deleteCurrentAdmin?: boolean }) {
  return requestJson<{ targetHostAccountId: string; deletedCurrentAdmin: boolean }>('/api/host/accounts/admin-transfer', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function deleteHostAccount(hostAccountId: string) {
  return requestJson<{ deleted: boolean; hostAccountId: string }>(`/api/host/accounts/${encodeURIComponent(hostAccountId)}`, {
    method: 'DELETE',
  })
}
