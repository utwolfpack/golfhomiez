import { api } from './api'

export const DEFAULT_HOME_MARKETING_SETTINGS = {
  golfHomiezVideoUrl: 'https://youtu.be/F9CrUZWAZJA',
  golfHomiezCoursesVideoUrl: 'https://youtu.be/F9CrUZWAZJA',
} as const

export const MARKETING_VIDEO_AUDIENCES = {
  golfHomiez: 'golf_homiez',
  golfHomiezCourses: 'golf_homiez_courses',
} as const

export type MarketingVideoAudience = typeof MARKETING_VIDEO_AUDIENCES[keyof typeof MARKETING_VIDEO_AUDIENCES]

export type HomeMarketingSettings = {
  golfHomiezVideoUrl: string
  golfHomiezCoursesVideoUrl: string
  updatedAt?: string | null
}

export type MarketingVideoSection = {
  id: string
  audience: MarketingVideoAudience
  name: string
  youtubeUrl: string
  sectionSlug: string
  relativeLink: string
  displayOrder: number
  createdAt?: string | null
  updatedAt?: string | null
}

export type CreateMarketingVideoSectionInput = {
  audience: MarketingVideoAudience
  name: string
  youtubeUrl: string
}

export function toYouTubeEmbedUrl(value: string): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    let videoId = ''

    if (host === 'youtu.be') {
      videoId = url.pathname.split('/').filter(Boolean)[0] || ''
    } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (url.pathname === '/watch') videoId = url.searchParams.get('v') || ''
      else {
        const segments = url.pathname.split('/').filter(Boolean)
        if (['embed', 'shorts', 'live'].includes(segments[0])) videoId = segments[1] || ''
      }
    }

    return /^[A-Za-z0-9_-]{6,20}$/.test(videoId)
      ? `https://www.youtube-nocookie.com/embed/${videoId}`
      : null
  } catch {
    return null
  }
}

export async function fetchHomeMarketingSettings() {
  return api<HomeMarketingSettings>('/api/marketing/home')
}

export async function fetchAdminHomeMarketingSettings() {
  return api<HomeMarketingSettings>('/api/admin/marketing/home')
}

export async function saveAdminHomeMarketingSettings(settings: Pick<HomeMarketingSettings, 'golfHomiezVideoUrl' | 'golfHomiezCoursesVideoUrl'>) {
  return api<HomeMarketingSettings>('/api/admin/marketing/home', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })
}

export async function fetchMarketingVideoSections(audience: MarketingVideoAudience) {
  const result = await api<{ sections: MarketingVideoSection[] }>(`/api/marketing/videos?audience=${encodeURIComponent(audience)}`)
  return result.sections || []
}

export async function fetchAdminMarketingVideoSections() {
  const result = await api<{ sections: MarketingVideoSection[] }>('/api/admin/marketing/videos')
  return result.sections || []
}

export async function createAdminMarketingVideoSection(input: CreateMarketingVideoSectionInput) {
  return api<MarketingVideoSection>('/api/admin/marketing/videos', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function deleteAdminMarketingVideoSection(sectionId: string) {
  return api<void>(`/api/admin/marketing/videos/${encodeURIComponent(sectionId)}`, {
    method: 'DELETE',
  })
}
