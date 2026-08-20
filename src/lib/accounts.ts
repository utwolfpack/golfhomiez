import { api } from './api'
import type { HoleScoreDetail, Team } from '../types'
import type { GolfCourseOption } from './golf-courses'

export type GolfCoursePublicPageTournament = {
  id: string
  tournamentIdentifier?: string | null
  name: string
  startDate?: string | null
  status?: string | null
  startType?: string | null
  startTime?: string | null
  golfCourseName?: string | null
  contactPerson?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  portalPath: string
}

export type GolfCoursePublicPageInput = {
  summary: string
  bannerImageUrl?: string | null
  bannerImageData?: string | null
  websiteUrl?: string | null
  contactPhone?: string | null
  addressLine1?: string | null
  city?: string | null
  stateCode: string
  postalCode?: string | null
  isPublished: boolean
}

export type GolfCoursePublicPage = GolfCoursePublicPageInput & {
  id: string
  hostAccountId: string
  golfCourseId?: string | null
  slug: string
  path: string
  url: string
  calendarAvailable: boolean
  calendarPath: string
  calendarUrl: string
  golfCourseName: string
  sourceWebsiteUrl?: string | null
  sourceLastSyncedAt?: string | null
  tournamentCount: number
  tournaments: GolfCoursePublicPageTournament[]
  createdAt?: string | null
  updatedAt?: string | null
}

export type HostAccountInput = {
  golfCourseName: string
  contactName: string
  phone?: string | null
  websiteUrl?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  notes?: string | null
  publicPage?: GolfCoursePublicPageInput | null
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
  catalogCourse?: {
    id: string
    name?: string | null
    phone?: string | null
    websiteUrl?: string | null
    addressLine1?: string | null
    city?: string | null
    stateCode?: string | null
    postalCode?: string | null
  } | null
  roleAssignmentId: string
  authUserId: string
  email: string
  role: string
  golfCourseId?: string | null
  publicPage?: GolfCoursePublicPage | null
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


export type TournamentStartAssignment = {
  id?: string | null
  tournamentId?: string | null
  teamKey: string
  registrationId?: string | null
  teamId?: string | null
  teamName: string
  startType: 'shotgun' | 'tee-times' | string
  startTime: string
  startingHole?: string | null
  sortOrder?: number
  notes?: string | null
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
  archivedAt?: string | null
  isPublic: boolean
  organizerName?: string | null
  hostGolfCourseName?: string | null
  hostGolfCourseCity?: string | null
  hostGolfCourseState?: string | null
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
  startAssignments?: TournamentStartAssignment[]
}


export type TournamentMessageRecipient = {
  userId?: string | null
  email: string
  name?: string | null
  inboxThreadId?: string | null
  createdAt?: string | null
}

export type TournamentMessageEntry = {
  id: string
  threadId: string
  senderUserId?: string | null
  senderEmail?: string | null
  senderName?: string | null
  senderRole: string
  body: string
  correlationId?: string | null
  createdAt?: string | null
}

export type TournamentMessageThread = {
  id: string
  tournamentId: string
  tournamentName: string
  eventDate?: string | null
  actionUrl?: string | null
  createdByUserId?: string | null
  createdByEmail?: string | null
  createdByName?: string | null
  createdByRole?: string | null
  hostUserId?: string | null
  hostEmail?: string | null
  hostName?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  recipients: TournamentMessageRecipient[]
  messages: TournamentMessageEntry[]
}

export type TournamentMessagesResponse = {
  threads: TournamentMessageThread[]
  unreadCount: number
  totalThreads: number
  totalMessages: number
  lastReadAt?: string | null
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

export type TournamentFinalLeaderboardRow = {
  position: number
  teamKey: string
  teamId?: string | null
  teamName: string
  totalScore?: number | null
  relativeToPar?: number | null
  roundLabel: string
  holesCompleted: number
  thru?: number | null
  updatedAt?: string | null
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
  startAssignments?: TournamentStartAssignment[]
  finalLeaderboard?: TournamentFinalLeaderboardRow[]
}

export type UserRegisteredTournament = Tournament & {
  registration: TournamentRegistration
  teamScore?: number | null
  teamScoreUpdatedAt?: string | null
}

export type UserTournamentsSummary = {
  tournaments: UserRegisteredTournament[]
}


export type GolfCourseTournamentSearchResult = {
  id: string
  golfCourseId?: string | null
  golfCourseName: string
  tournamentName?: string | null
  state: string
  city?: string | null
  zipCode?: string | null
  tournamentDate: string
  tournamentWebsite?: string | null
  golfCoursePagePath?: string | null
  golfCourseWebsiteUrl?: string | null
  sourceUrl?: string | null
  sourceType?: 'external' | 'golfhomiez' | string
  isGolfHomiezTournament?: boolean
  golfHomiezTournamentId?: string | null
  tournamentPath?: string | null
  isRegistered?: boolean
  firstSeenAt?: string | null
  lastSeenAt?: string | null
}

export type GolfCourseTournamentSearchFilters = {
  state?: string
  city?: string
  zipCode?: string
  golfCourseName?: string
  fromDate?: string
  toDate?: string
}

export type GolfCourseTournamentSearchResponse = {
  filters: Required<Pick<GolfCourseTournamentSearchFilters, 'state' | 'city' | 'zipCode' | 'golfCourseName' | 'fromDate' | 'toDate'>>
  pagination: {
    page: number
    pageSize: number
    totalResults: number
    totalPages: number
  }
  tournaments: GolfCourseTournamentSearchResult[]
}

export type GolfHomiezCourseSearchResult = {
  id: string
  golfCourseId?: string | null
  golfCourseName: string
  city?: string | null
  state: string
  zipCode?: string | null
  websiteUrl?: string | null
  golfCoursePagePath?: string | null
  latitude?: number | null
  longitude?: number | null
  hostedTournamentCount: number
  distanceMiles?: number | null
}

export type GolfHomiezCourseSearchFilters = {
  state?: string
  city?: string
  zipCode?: string
  golfCourseName?: string
}

export type GolfHomiezCourseSearchResponse = {
  filters: Required<Pick<GolfHomiezCourseSearchFilters, 'state' | 'city' | 'zipCode' | 'golfCourseName'>>
  zipSearch: {
    requestedZipCode?: string | null
    radiusMiles: number
    radiusResolved: boolean
    source?: string | null
  }
  pagination: {
    page: number
    pageSize: number
    totalResults: number
    totalPages: number
  }
  courses: GolfHomiezCourseSearchResult[]
}

export type TournamentTeamScoreTeam = {
  teamKey: string
  teamId?: string | null
  teamName: string
  totalScore?: number | null
  holes: HoleScoreDetail[]
  teeColor?: string | null
  updatedAt?: string | null
  canEdit: boolean
}

export type TournamentTeamScoreContext = {
  tournament: {
    id: string
    tournamentIdentifier?: string | null
    name: string
    startDate?: string | null
    status: string
    hostGolfCourseName?: string | null
    hostGolfCourseState?: string | null
  }
  currentTeamKey: string
  teams: TournamentTeamScoreTeam[]
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

export function fetchGolfCoursePublicPage(slug: string) {
  return api<GolfCoursePublicPage>(`/api/golf-course-pages/${encodeURIComponent(slug)}`)
}

export function fetchOrganizerProfile() {
  return api<OrganizerAccount>('/api/organizer/profile')
}

export function updateOrganizerProfile(input: Partial<OrganizerAccountInput>) {
  return api<OrganizerAccount>('/api/organizer/profile', { method: 'PUT', body: JSON.stringify(input) })
}


export function fetchGolfCourses(state?: string) {
  const query = state ? `?state=${encodeURIComponent(state)}` : ''
  return api<GolfCourseOption[]>(`/api/golf-courses${query}`)
}

export function fetchTournaments() {
  return api<Tournament[]>('/api/tournaments')
}

export function createTournamentRecord(input: TournamentInput) {
  return api<Tournament>('/api/tournaments', { method: 'POST', body: JSON.stringify(input) })
}


export function autoCreateHostTournamentStartSchedule(tournamentId: string, input: { startType?: string; firstStartTime?: string; intervalMinutes?: number }) {
  return api<{ assignments: TournamentStartAssignment[] }>(`/api/host/tournaments/${encodeURIComponent(tournamentId)}/start-schedule/auto`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateHostTournamentStartSchedule(tournamentId: string, assignments: TournamentStartAssignment[]) {
  return api<{ assignments: TournamentStartAssignment[] }>(`/api/host/tournaments/${encodeURIComponent(tournamentId)}/start-schedule`, {
    method: 'PUT',
    body: JSON.stringify({ assignments }),
  })
}

export function autoCreateOrganizerTournamentStartSchedule(tournamentId: string, input: { startType?: string; firstStartTime?: string; intervalMinutes?: number }) {
  return api<{ assignments: TournamentStartAssignment[] }>(`/api/organizer/tournaments/${encodeURIComponent(tournamentId)}/start-schedule/auto`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateOrganizerTournamentStartSchedule(tournamentId: string, assignments: TournamentStartAssignment[]) {
  return api<{ assignments: TournamentStartAssignment[] }>(`/api/organizer/tournaments/${encodeURIComponent(tournamentId)}/start-schedule`, {
    method: 'PUT',
    body: JSON.stringify({ assignments }),
  })
}

export function updateOrganizerTournamentRecord(tournamentId: string, input: TournamentInput) {
  return api<Tournament>(`/api/organizer/tournaments/${encodeURIComponent(tournamentId)}`, { method: 'PUT', body: JSON.stringify(input) })
}

export function updateHostTournamentRecord(tournamentId: string, input: TournamentInput) {
  return api<Tournament>(`/api/host/tournaments/${encodeURIComponent(tournamentId)}`, { method: 'PUT', body: JSON.stringify(input) })
}

export function sendHostTournamentMessage(tournamentId: string, input: { body: string; recipientEmails: string[] }) {
  return api<{ ok: boolean; sentCount: number; threadId: string }>(`/api/host/tournaments/${encodeURIComponent(tournamentId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ ...input, recipientMode: 'selected' }),
  })
}

export function fetchHostTournamentMessages(tournamentId: string) {
  return api<TournamentMessagesResponse>(`/api/host/tournaments/${encodeURIComponent(tournamentId)}/messages`)
}

export function markHostTournamentMessagesRead(tournamentId: string) {
  return api<{ ok: boolean; tournamentId: string; lastReadAt?: string | null }>(`/api/host/tournaments/${encodeURIComponent(tournamentId)}/messages/read`, { method: 'PATCH' })
}

export function replyHostTournamentMessage(tournamentId: string, threadId: string, body: string) {
  return api<{ ok: boolean; conversation: TournamentMessageThread }>(`/api/host/tournaments/${encodeURIComponent(tournamentId)}/message-threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

export function sendOrganizerTournamentMessage(tournamentId: string, input: { body: string; recipientEmails: string[] }) {
  return api<{ ok: boolean; sentCount: number; threadId: string }>(`/api/organizer/tournaments/${encodeURIComponent(tournamentId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ ...input, recipientMode: 'selected' }),
  })
}

export function fetchOrganizerTournamentMessages(tournamentId: string) {
  return api<TournamentMessagesResponse>(`/api/organizer/tournaments/${encodeURIComponent(tournamentId)}/messages`)
}

export function markOrganizerTournamentMessagesRead(tournamentId: string) {
  return api<{ ok: boolean; tournamentId: string; lastReadAt?: string | null }>(`/api/organizer/tournaments/${encodeURIComponent(tournamentId)}/messages/read`, { method: 'PATCH' })
}

export function replyOrganizerTournamentMessage(tournamentId: string, threadId: string, body: string) {
  return api<{ ok: boolean; conversation: TournamentMessageThread }>(`/api/organizer/tournaments/${encodeURIComponent(tournamentId)}/message-threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

export function archiveHostTournamentRecord(tournamentId: string) {
  return api<Tournament>(`/api/host/tournaments/${encodeURIComponent(tournamentId)}/archive`, { method: 'POST' })
}

export function restoreHostTournamentRecord(tournamentId: string) {
  return api<Tournament>(`/api/host/tournaments/${encodeURIComponent(tournamentId)}/restore`, { method: 'POST' })
}

export function archiveOrganizerTournamentRecord(tournamentId: string) {
  return api<Tournament>(`/api/organizer/tournaments/${encodeURIComponent(tournamentId)}/archive`, { method: 'POST' })
}

export function restoreOrganizerTournamentRecord(tournamentId: string) {
  return api<Tournament>(`/api/organizer/tournaments/${encodeURIComponent(tournamentId)}/restore`, { method: 'POST' })
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


export function searchGolfCourseTournaments(filters: GolfCourseTournamentSearchFilters, page = 1) {
  const params = new URLSearchParams()
  if (filters.state) params.set('state', filters.state)
  if (filters.city) params.set('city', filters.city)
  if (filters.zipCode) params.set('zipCode', filters.zipCode)
  if (filters.golfCourseName) params.set('golfCourseName', filters.golfCourseName)
  if (filters.fromDate) params.set('fromDate', filters.fromDate)
  if (filters.toDate) params.set('toDate', filters.toDate)
  params.set('page', String(Math.max(1, Math.trunc(page) || 1)))
  const query = params.toString()
  return api<GolfCourseTournamentSearchResponse>(`/api/users/tournament-search?${query}`)
}

export function searchGolfHomiezCourses(filters: GolfHomiezCourseSearchFilters, page = 1) {
  const params = new URLSearchParams()
  if (filters.state) params.set('state', filters.state)
  if (filters.city) params.set('city', filters.city)
  if (filters.zipCode) params.set('zipCode', filters.zipCode)
  if (filters.golfCourseName) params.set('golfCourseName', filters.golfCourseName)
  params.set('page', String(Math.max(1, Math.trunc(page) || 1)))
  const query = params.toString()
  return api<GolfHomiezCourseSearchResponse>(`/api/users/golf-course-search?${query}`)
}

export function fetchTournamentTeamScore(tournamentId: string) {
  return api<TournamentTeamScoreContext>(`/api/users/tournaments/${encodeURIComponent(tournamentId)}/team-score`)
}

export function updateTournamentTeamScore(tournamentId: string, input: { holes: HoleScoreDetail[]; teeColor?: string | null }) {
  return api<TournamentTeamScoreContext>(`/api/users/tournaments/${encodeURIComponent(tournamentId)}/team-score`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
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

