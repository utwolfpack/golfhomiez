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
