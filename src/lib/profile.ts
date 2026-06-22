import { api } from './api'

export type ProfileSummary = {
  roundsGolfed: number
  eventTypes: {
    individual: number
    team: number
  }
  mostPlayedCourse: {
    course: string
    count: number
  } | null
  handicap: {
    handicap: number | null
    ratedRounds: number
    roundsUsed: number
    message: string
  }
  bestScore: {
    score: number
    mode: 'solo' | 'team'
    course: string
    date: string
  } | null
}

export type FeatureFlags = {
  profileSocialPreferences?: boolean
  [key: string]: boolean | undefined
}

export type UserProfile = {
  id: string
  email: string
  name?: string | null
  phone: string
  primaryCity: string
  primaryState: string
  primaryZipCode: string
  alcoholPreference: string
  cannabisPreference: string
  sobrietyPreference: string
  profileEnrichedAt?: string | null
  needsEnrichment: boolean
  summary?: ProfileSummary | null
  featureFlags?: FeatureFlags
  createdAt?: string | null
  updatedAt?: string | null
}

export type ProfileInput = {
  phone: string
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
