import { getPool } from '../db.js'

export const DEFAULT_HOME_MARKETING_SETTINGS = Object.freeze({
  golfHomiezVideoUrl: 'https://youtu.be/F9CrUZWAZJA',
  golfHomiezCoursesVideoUrl: 'https://youtu.be/F9CrUZWAZJA',
})

const SETTING_KEYS = Object.freeze({
  golfHomiezVideoUrl: 'home.golf_homiez_video_url',
  golfHomiezCoursesVideoUrl: 'home.golf_homiez_courses_video_url',
})

function normalizeYouTubeHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '')
}

export function extractYouTubeVideoId(value) {
  const raw = String(value || '').trim()
  if (!raw) return null

  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = normalizeYouTubeHostname(url.hostname)
  let videoId = ''

  if (host === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] || ''
  } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v') || ''
    } else {
      const segments = url.pathname.split('/').filter(Boolean)
      if (['embed', 'shorts', 'live'].includes(segments[0])) videoId = segments[1] || ''
    }
  } else {
    return null
  }

  return /^[A-Za-z0-9_-]{6,20}$/.test(videoId) ? videoId : null
}

export function validateYouTubeUrl(value, label = 'YouTube URL') {
  const url = String(value || '').trim()
  if (!extractYouTubeVideoId(url)) {
    throw new Error(`${label} must be a valid YouTube video URL`)
  }
  return url
}

export async function getHomeMarketingSettings(db = getPool()) {
  const settings = { ...DEFAULT_HOME_MARKETING_SETTINGS }
  const keys = Object.values(SETTING_KEYS)
  const [rows] = await db.execute(
    `SELECT setting_key, setting_value, updated_at
       FROM marketing_settings
      WHERE setting_key IN (?, ?)`,
    keys,
  )

  let updatedAt = null
  for (const row of rows || []) {
    const entry = Object.entries(SETTING_KEYS).find(([, settingKey]) => settingKey === row.setting_key)
    if (!entry) continue
    const [propertyName] = entry
    if (extractYouTubeVideoId(row.setting_value)) settings[propertyName] = String(row.setting_value).trim()
    if (row.updated_at && (!updatedAt || new Date(row.updated_at) > new Date(updatedAt))) updatedAt = row.updated_at
  }

  return { ...settings, updatedAt }
}

export async function updateHomeMarketingSettings(input, { adminUserId = null, correlationId = null } = {}, db = getPool()) {
  const settings = {
    golfHomiezVideoUrl: validateYouTubeUrl(input?.golfHomiezVideoUrl, 'Golf Homiez video URL'),
    golfHomiezCoursesVideoUrl: validateYouTubeUrl(input?.golfHomiezCoursesVideoUrl, 'Golf Homiez Courses video URL'),
  }

  const updates = Object.entries(settings).map(([propertyName, settingValue]) => [SETTING_KEYS[propertyName], settingValue])
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    for (const [settingKey, settingValue] of updates) {
      await connection.execute(
        `INSERT INTO marketing_settings
           (setting_key, setting_value, updated_by_admin_user_id, correlation_id)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           setting_value = VALUES(setting_value),
           updated_by_admin_user_id = VALUES(updated_by_admin_user_id),
           correlation_id = VALUES(correlation_id),
           updated_at = CURRENT_TIMESTAMP`,
        [settingKey, settingValue, adminUserId, correlationId],
      )
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  return getHomeMarketingSettings(db)
}
