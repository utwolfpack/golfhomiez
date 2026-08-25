import { randomUUID } from 'node:crypto'
import { getPool } from '../db.js'

export const DEFAULT_HOME_MARKETING_SETTINGS = Object.freeze({
  golfHomiezVideoUrl: 'https://youtu.be/F9CrUZWAZJA',
  golfHomiezCoursesVideoUrl: 'https://youtu.be/F9CrUZWAZJA',
})

export const MARKETING_VIDEO_AUDIENCES = Object.freeze({
  GOLF_HOMIEZ: 'golf_homiez',
  GOLF_HOMIEZ_COURSES: 'golf_homiez_courses',
})

const SETTING_KEYS = Object.freeze({
  golfHomiezVideoUrl: 'home.golf_homiez_video_url',
  golfHomiezCoursesVideoUrl: 'home.golf_homiez_courses_video_url',
})

const VIDEO_PAGE_PATHS = Object.freeze({
  [MARKETING_VIDEO_AUDIENCES.GOLF_HOMIEZ]: '/golfhomiezvideos',
  [MARKETING_VIDEO_AUDIENCES.GOLF_HOMIEZ_COURSES]: '/golfhomiezcoursevideos',
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

export function normalizeMarketingVideoAudience(value) {
  const audience = String(value || '').trim().toLowerCase()
  if (!Object.values(MARKETING_VIDEO_AUDIENCES).includes(audience)) {
    throw new Error('Video page must be Golf Homiez Users or Golf Homiez Courses')
  }
  return audience
}

export function normalizeMarketingVideoSectionName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ')
  if (!name) throw new Error('Video section name is required')
  if (name.length > 160) throw new Error('Video section name must be 160 characters or fewer')
  return name
}

export function slugifyMarketingVideoSection(value) {
  const normalized = normalizeMarketingVideoSectionName(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140)
    .replace(/-+$/g, '')
  return normalized || 'video'
}

export function marketingVideoSectionRelativeLink(audience, slug) {
  const normalizedAudience = normalizeMarketingVideoAudience(audience)
  const safeSlug = String(slug || '').trim()
  return `${VIDEO_PAGE_PATHS[normalizedAudience]}#${encodeURIComponent(safeSlug)}`
}

function mapMarketingVideoSection(row) {
  const audience = normalizeMarketingVideoAudience(row.audience)
  const sectionSlug = String(row.section_slug || '').trim()
  return {
    id: String(row.id),
    audience,
    name: String(row.section_name || '').trim(),
    youtubeUrl: String(row.youtube_url || '').trim(),
    sectionSlug,
    relativeLink: marketingVideoSectionRelativeLink(audience, sectionSlug),
    displayOrder: Number(row.display_order || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
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

export async function listMarketingVideoSections({ audience = null } = {}, db = getPool()) {
  const params = []
  let whereSql = ''
  if (audience) {
    const normalizedAudience = normalizeMarketingVideoAudience(audience)
    whereSql = 'WHERE audience = ?'
    params.push(normalizedAudience)
  }

  const [rows] = await db.execute(
    `SELECT id, audience, section_name, youtube_url, section_slug, display_order, created_at, updated_at
       FROM marketing_video_sections
       ${whereSql}
      ORDER BY audience ASC, display_order ASC, created_at ASC, id ASC`,
    params,
  )
  return (rows || []).map(mapMarketingVideoSection)
}

async function nextUniqueSectionSlug(connection, audience, name) {
  const baseSlug = slugifyMarketingVideoSection(name)
  const [rows] = await connection.execute(
    `SELECT section_slug
       FROM marketing_video_sections
      WHERE audience = ?
        AND (section_slug = ? OR section_slug LIKE ?)` ,
    [audience, baseSlug, `${baseSlug}-%`],
  )
  const used = new Set((rows || []).map((row) => String(row.section_slug || '')))
  if (!used.has(baseSlug)) return baseSlug

  let suffix = 2
  while (used.has(`${baseSlug}-${suffix}`)) suffix += 1
  return `${baseSlug}-${suffix}`
}

export async function createMarketingVideoSection(input, { adminUserId = null, correlationId = null } = {}, db = getPool()) {
  const audience = normalizeMarketingVideoAudience(input?.audience)
  const name = normalizeMarketingVideoSectionName(input?.name)
  const youtubeUrl = validateYouTubeUrl(input?.youtubeUrl, 'Video section YouTube URL')
  const connection = await db.getConnection()

  try {
    await connection.beginTransaction()
    const sectionSlug = await nextUniqueSectionSlug(connection, audience, name)
    const [[orderRow = {}] = []] = await connection.execute(
      `SELECT COALESCE(MAX(display_order), 0) + 10 AS next_order
         FROM marketing_video_sections
        WHERE audience = ?`,
      [audience],
    )
    const id = randomUUID()
    const displayOrder = Number(orderRow.next_order || 10)
    await connection.execute(
      `INSERT INTO marketing_video_sections
         (id, audience, section_name, youtube_url, section_slug, display_order, created_by_admin_user_id, correlation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, audience, name, youtubeUrl, sectionSlug, displayOrder, adminUserId, correlationId],
    )
    const [[row] = []] = await connection.execute(
      `SELECT id, audience, section_name, youtube_url, section_slug, display_order, created_at, updated_at
         FROM marketing_video_sections
        WHERE id = ?
        LIMIT 1`,
      [id],
    )
    await connection.commit()
    return mapMarketingVideoSection(row)
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function deleteMarketingVideoSection(sectionId, db = getPool()) {
  const id = String(sectionId || '').trim()
  if (!id) throw new Error('Video section id is required')
  const [result] = await db.execute('DELETE FROM marketing_video_sections WHERE id = ?', [id])
  return Number(result?.affectedRows || 0) > 0
}
