import { api } from './api'

export const DEFAULT_HOME_MARKETING_SETTINGS = {
  golfHomiezVideoUrl: 'https://youtu.be/F9CrUZWAZJA',
  golfHomiezCoursesVideoUrl: 'https://youtu.be/F9CrUZWAZJA',
} as const

export type HomeMarketingSettings = {
  golfHomiezVideoUrl: string
  golfHomiezCoursesVideoUrl: string
  updatedAt?: string | null
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
