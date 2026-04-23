import { requestJson } from './request'

export type HostAccount = {
  id: string
  email: string
  golfCourseName: string
  isValidated: boolean
  validatedAt: string | null
}

export type HostAccountRequestPayload = {
  firstName: string
  lastName: string
  email: string
  stateCode: string
  stateName: string
  golfCourseName: string
  representativeDetails: string
  password: string
}

export async function getHostSession() {
  return requestJson<{ hostAccount: HostAccount | null }>('/api/host/session')
}

export async function requestHostAccount(payload: HostAccountRequestPayload) {
  return requestJson<{ request: { id: string; status: string } }>('/api/host/account-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function registerHostAccount(payload: { email: string; golfCourseName: string; securityKey: string; password: string }) {
  return requestJson<{ hostAccount: HostAccount }>('/api/host/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}


export async function redeemHostInviteAccount(payload: { email: string; golfCourseName: string; securityKey: string; password: string }) {
  return registerHostAccount(payload)
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
  return requestJson<{ account: HostAccount & { createdAt?: string | null; updatedAt?: string | null }; invites: Array<{ id: string; email: string; inviteeName: string | null; golfCourseName: string | null; createdAt: string | null; consumedAt: string | null; expiresAt: string | null }> }>('/api/host/portal')
}
