import { api } from './api'

export type UserProfile = {
  id: string
  email: string
  name?: string | null
  primaryCity: string
  primaryState: string
  primaryZipCode: string
  alcoholPreference: string
  cannabisPreference: string
  sobrietyPreference: string
  profileEnrichedAt?: string | null
  needsEnrichment: boolean
  createdAt?: string | null
  updatedAt?: string | null
}

export type ProfileInput = {
  primaryCity: string
  primaryState: string
  primaryZipCode: string
  alcoholPreference: string
  cannabisPreference: string
  sobrietyPreference: string
}

export async function fetchProfile(): Promise<UserProfile> {
  return api<UserProfile>('/api/profile')
}

export async function saveProfile(input: ProfileInput): Promise<UserProfile> {
  return api<UserProfile>('/api/profile', { method: 'PUT', body: JSON.stringify(input) })
}
