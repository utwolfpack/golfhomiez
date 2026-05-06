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

export async function fetchOrganizerSessionPortal() {
  return requestJson<OrganizerPortalSummary>('/api/organizer/portal')
}
