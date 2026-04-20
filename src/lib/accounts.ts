import { api } from './api'

export type HostAccountInput = {
  golfCourseName: string
  contactName: string
  phone?: string
  websiteUrl?: string
  city?: string
  state?: string
  postalCode?: string
  notes?: string
  securityKey?: string
}

export type OrganizerAccountInput = {
  organizationName: string
  contactName: string
  phone?: string
  websiteUrl?: string
  notes?: string
}

export type TournamentInput = {
  name: string
  description?: string
  startDate: string
  endDate?: string
  hostAccountId?: string
  status?: string
  isPublic?: boolean
}

export type HostInviteInput = {
  email: string
  message?: string
  expiresInDays?: number
}

export type HostAccount = Omit<HostAccountInput, 'securityKey'> & {
  id: string
  roleAssignmentId: string
  authUserId: string
  email: string
  role: string
  createdAt?: string | null
  updatedAt?: string | null
}

export type OrganizerAccount = OrganizerAccountInput & {
  id: string
  roleAssignmentId: string
  authUserId: string
  email: string
  role: string
  createdAt?: string | null
  updatedAt?: string | null
}

export type Tournament = {
  id: string
  organizerAccountId: string
  hostAccountId?: string | null
  name: string
  description?: string | null
  startDate: string
  endDate?: string | null
  status: string
  isPublic: boolean
  organizerName?: string | null
  hostGolfCourseName?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export type AdminUser = {
  id: string
  authUserId: string
  email: string
  name?: string | null
  primaryCity?: string | null
  primaryState?: string | null
  primaryZipCode?: string | null
  alcoholPreference?: string | null
  cannabisPreference?: string | null
  sobrietyPreference?: string | null
  profileEnrichedAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export type RoleAssignment = {
  id: string
  authUserId: string
  email: string
  role: string
  status: string
  createdAt?: string | null
  updatedAt?: string | null
}

export type HostInvite = {
  id: string
  email: string
  inviteType: string
  inviteUrl?: string | null
  invitedByAuthUserId?: string | null
  invitedByEmail?: string | null
  status: string
  expiresAt?: string | null
  consumedAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  securityKey?: string
}

export type AdminPortalSummary = {
  users: AdminUser[]
  roleAssignments: RoleAssignment[]
  hostAccounts: HostAccount[]
  organizerAccounts: OrganizerAccount[]
  tournaments: Tournament[]
  hostInvites: HostInvite[]
}

export type RbacSummary = {
  roles: string[]
  canCreateHostAccount: boolean
  canCreateOrganizerAccount: boolean
  canAccessAdminPortal?: boolean
  hostAccount: HostAccount | null
  organizerAccount: OrganizerAccount | null
}

export function fetchRbacSummary() {
  return api<RbacSummary>('/api/rbac/me')
}

export function fetchHostAccount() {
  return api<HostAccount | null>('/api/accounts/host')
}

export function createHostAccount(input: HostAccountInput) {
  return api<HostAccount>('/api/accounts/host', { method: 'POST', body: JSON.stringify(input) })
}

export function fetchOrganizerAccount() {
  return api<OrganizerAccount | null>('/api/accounts/organizer')
}

export function createOrganizerAccount(input: OrganizerAccountInput) {
  return api<OrganizerAccount>('/api/accounts/organizer', { method: 'POST', body: JSON.stringify(input) })
}

export function fetchGolfCourses() {
  return api<HostAccount[]>('/api/golf-courses')
}

export function fetchTournaments() {
  return api<Tournament[]>('/api/tournaments')
}

export function createTournamentRecord(input: TournamentInput) {
  return api<Tournament>('/api/tournaments', { method: 'POST', body: JSON.stringify(input) })
}

export function fetchAdminPortal() {
  return api<AdminPortalSummary>('/api/admin/portal')
}

export function createHostInviteRecord(input: HostInviteInput) {
  return api<HostInvite>('/api/admin/host-invites', { method: 'POST', body: JSON.stringify(input) })
}
