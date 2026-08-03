import { requestJson } from './request'
import type { OrganizerAccount, OrganizerPortalSummary } from './accounts'

export async function getOrganizerSession() {
  return requestJson<{ organizerAccount: OrganizerAccount | null }>('/api/organizer/session')
}

export async function loginOrganizerAccount(payload: { email: string; password: string }) {
  return requestJson<{ organizerAccount: OrganizerAccount }>('/api/organizer/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function registerOrganizerAccount(payload: { firstName: string; lastName: string; email: string; password: string }) {
  return requestJson<{ organizerAccount: OrganizerAccount }>('/api/organizer/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function logoutOrganizerAccount() {
  return requestJson<null>('/api/organizer/logout', { method: 'POST' })
}

export async function requestOrganizerPasswordReset(email: string) {
  return requestJson<{ ok: boolean }>('/api/organizer/request-password-reset', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function resetOrganizerPassword(token: string, password: string) {
  return requestJson<{ ok: boolean }>('/api/organizer/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })
}

export async function fetchOrganizerSessionPortal() {
  return requestJson<OrganizerPortalSummary>('/api/organizer/portal')
}
