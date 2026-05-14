import { api } from './api'
import type { Team } from '../types'

export type HostAccountInput = {
  golfCourseName: string
  contactName: string
  phone?: string | null
  websiteUrl?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  notes?: string | null
}

export type OrganizerAccountInput = {
  organizationName: string
  contactName: string
  phone?: string | null
  websiteUrl?: string | null
  notes?: string | null
}

export type TournamentInput = {
  name: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  hostAccountId?: string | null
  status?: string
  isPublic?: boolean
  organizerEmail?: string | null
  teamId?: string | null
  teamName?: string | null
  teamMembers?: Array<{ id?: string | null; name: string; email: string; registered?: boolean; verified?: boolean; registrationId?: string | null; registrationAuthUserId?: string | null; registeredAt?: string | null }> | null
  templateKey?: string | null
  templateBackgroundImageUrl?: string | null
  templateData?: Record<string, unknown> | null
  teamSlotLimit?: number | null
}


export type HostAccount = HostAccountInput & {
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

export type TournamentRegistration = {
  id: string
  tournamentId: string
  authUserId?: string | null
  email: string
  name: string
  status: string
  registeredAt?: string | null
  updatedAt?: string | null
  teamId?: string | null
  teamName?: string | null
  teamMembers?: Array<{ id?: string | null; name: string; email: string; registered?: boolean; verified?: boolean; registrationId?: string | null; registrationAuthUserId?: string | null; registeredAt?: string | null }>
}

export type Tournament = {
  id: string
  organizerAccountId: string | null
  hostAccountId?: string | null
  name: string
  tournamentIdentifier?: string | null
  organizerEmail?: string | null
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  status: string
  isPublic: boolean
  organizerName?: string | null
  hostGolfCourseName?: string | null
  hostGolfCourseAddress?: string | null
  portalPath?: string | null
  portalUrl?: string | null
  registrationUrl?: string | null
  registrationCount?: number
  registrations?: TournamentRegistration[]
  inviteId?: string | null
  inviteStatus?: string | null
  inviteUrl?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  activityAt?: string | null
  templateKey?: string | null
  templateBackgroundImageUrl?: string | null
  templateData?: Record<string, unknown> | null
  teamSlotLimit?: number | null
  registeredTeamCount?: number
  verifiedUserCount?: number
  openTeamSlotCount?: number
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

export type OrganizerTournamentInvite = {
  id: string
  tournamentId: string
  organizerEmail: string
  inviteUrl?: string | null
  status: string
  sentAt?: string | null
  acceptedAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export type AdminPortalSummary = {
  users: AdminUser[]
  roleAssignments: RoleAssignment[]
  hostAccounts: HostAccount[]
  organizerAccounts: OrganizerAccount[]
  tournaments: Tournament[]
}

export type OrganizerPortalSummary = {
  organizerAccount: OrganizerAccount | null
  tournaments: Tournament[]
}

export type TournamentPortal = {
  tournament: Tournament
  registrationCount?: number
  teamSlotLimit?: number | null
  registeredTeamCount?: number
  verifiedUserCount?: number
  openTeamSlotCount?: number
  registrations?: TournamentRegistration[]
  isViewerRegistered?: boolean
  viewerRegistration?: TournamentRegistration | null
}

export type UserRegisteredTournament = Tournament & {
  registration: TournamentRegistration
}

export type UserTournamentsSummary = {
  tournaments: UserRegisteredTournament[]
}



export type TournamentRegistrationResult = {
  ok: boolean
  tournamentId: string
  status: string
  alreadyRegistered?: boolean
  registration?: TournamentRegistration | null
  teamAlreadyRegistered?: boolean
}

export type OrganizerInviteEligibility = {
  email: string
  eligible: boolean
  inviteCount: number
  hasOrganizerAccount: boolean
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

export function fetchHostProfile() {
  return api<HostAccount>('/api/host/profile')
}

export function updateHostProfile(input: Partial<HostAccountInput>) {
  return api<HostAccount>('/api/host/profile', { method: 'PUT', body: JSON.stringify(input) })
}

export function fetchOrganizerProfile() {
  return api<OrganizerAccount>('/api/organizer/profile')
}

export function updateOrganizerProfile(input: Partial<OrganizerAccountInput>) {
  return api<OrganizerAccount>('/api/organizer/profile', { method: 'PUT', body: JSON.stringify(input) })
}


export function fetchGolfCourses(state?: string) {
  const query = state ? `?state=${encodeURIComponent(state)}` : ''
  return api<HostAccount[]>(`/api/golf-courses${query}`)
}

export function fetchTournaments() {
  return api<Tournament[]>('/api/tournaments')
}

export function createTournamentRecord(input: TournamentInput) {
  return api<Tournament>('/api/tournaments', { method: 'POST', body: JSON.stringify(input) })
}

export function updateOrganizerTournamentRecord(tournamentId: string, input: TournamentInput) {
  return api<Tournament>(`/api/organizer/tournaments/${encodeURIComponent(tournamentId)}`, { method: 'PUT', body: JSON.stringify(input) })
}

export function updateHostTournamentRecord(tournamentId: string, input: TournamentInput) {
  return api<Tournament>(`/api/host/tournaments/${encodeURIComponent(tournamentId)}`, { method: 'PUT', body: JSON.stringify(input) })
}


export function createHostTournament(input: TournamentInput) {
  return api<{ tournament: Tournament }>('/api/host/tournaments', { method: 'POST', body: JSON.stringify(input) })
}

export function sendHostTournamentInvite(tournamentId: string, input: { organizerEmail: string; message?: string | null }) {
  return api<{ invite: OrganizerTournamentInvite; organizerUrl: string }>(`/api/host/tournaments/${encodeURIComponent(tournamentId)}/invite`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function fetchOrganizerPortal() {
  return api<OrganizerPortalSummary>('/api/organizer/portal')
}

export function fetchOrganizerInviteEligibility(email: string) {
  const query = new URLSearchParams({ email }).toString()
  return api<OrganizerInviteEligibility>(`/api/organizer/invite-eligibility?${query}`)
}

export function fetchUserTournaments() {
  return api<UserTournamentsSummary>('/api/users/tournaments')
}

export function fetchTournamentPortal(id: string) {
  return api<TournamentPortal>(`/api/tournament-portals/${encodeURIComponent(id)}`)
}

export function registerForTournament(id: string, input: { teamId?: string | null; teamName?: string | null; teamMembers?: Array<{ id?: string | null; name: string; email: string; registered?: boolean; verified?: boolean; registrationId?: string | null; registrationAuthUserId?: string | null; registeredAt?: string | null }> } = {}) {
  return api<TournamentRegistrationResult>(`/api/tournament-portals/${encodeURIComponent(id)}/register`, { method: 'POST', body: JSON.stringify(input) })
}

export function fetchMyTeams() {
  return api<Team[]>('/api/teams?mine=1')
}

export function fetchAdminPortal() {
  return api<AdminPortalSummary>('/api/admin/portal')
}

