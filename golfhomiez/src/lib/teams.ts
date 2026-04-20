import { api } from './api'
import type { Team, TeamMember } from '../types'

export async function fetchTeams(): Promise<Team[]> {
  return api<Team[]>('/api/teams')
}

export async function createTeam(name: string, members: Omit<TeamMember, 'id'>[]): Promise<Team> {
  return api<Team>('/api/teams', { method: 'POST', body: JSON.stringify({ name, members }) })
}

export async function updateTeam(id: string, name: string, members: TeamMember[]): Promise<Team> {
  return api<Team>(`/api/teams/${id}`, { method: 'PUT', body: JSON.stringify({ name, members }) })
}

export async function lookupUserByEmail(email: string): Promise<{ found: boolean; email: string; firstName?: string; name?: string; verified?: boolean }> {
  return api(`/api/users/lookup?email=${encodeURIComponent(email)}`)
}

export async function sendHomieInvite(email: string, message: string): Promise<{ ok: boolean }> {
  return api('/api/invitations', { method: 'POST', body: JSON.stringify({ email, message }) })
}

export async function sendRegistrationInvite(email: string, message: string, teamId?: string): Promise<{ ok: boolean }> {
  return api('/api/invitations/resend-registration', { method: 'POST', body: JSON.stringify({ email, message, teamId }) })
}
