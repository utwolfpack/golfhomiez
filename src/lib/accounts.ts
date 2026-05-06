import { api } from './api'

export type HostAccountInput = {
  golfCourseName: string
  contactName: string
  phone?: string | null
  websiteUrl?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  notes?: string | null
  securityKey?: string | null
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
}

export type HostInviteInput = {
  email: string
  message?: string | null
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

export type TournamentRegistration = {
  id: string
  tournamentId: string
  authUserId?: string | null
  email: string
  name: string
  status: string
  registeredAt?: string | null
  updatedAt?: string | null
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
  hostInvites: HostInvite[]
}

export type OrganizerPortalSummary = {
  organizerAccount: OrganizerAccount | null
  tournaments: Tournament[]
}

export type TournamentPortal = {
  tournament: Tournament
  registrationCount: number
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

export function registerForTournament(id: string) {
  return api<TournamentRegistrationResult>(`/api/tournament-portals/${encodeURIComponent(id)}/register`, { method: 'POST', body: JSON.stringify({}) })
}

export function fetchAdminPortal() {
  return api<AdminPortalSummary>('/api/admin/portal')
}

export function createHostInviteRecord(input: HostInviteInput) {
  return api<HostInvite>('/api/admin/host-invites', { method: 'POST', body: JSON.stringify(input) })
}
