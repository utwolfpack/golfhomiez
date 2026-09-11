import process from 'node:process'
import fs from 'node:fs'
import path from 'node:path'
import { Blob, Buffer } from 'node:buffer'
import { createSignedSocialMediaToken } from './social-publishing-crypto.js'
import {
  ensureSocialPublication,
  getSocialPublication,
  listRetryableSocialPublications,
  listSocialPublicationsForRun,
  updateSocialPublication,
} from './social-publishing-store.js'

export const SOCIAL_COMMERCIAL_JOB_IDS = new Set([
  'createShortFormGreatShotsSmall',
  'createShortFormFunnyShotsSmall',
  'createShortFormCurrentEventsSmall',
])
export const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'linkedin', 'youtube']

const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_INTERVAL_MINUTES = 15
const MAX_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000
const tokenCache = new Map()

function env(name) {
  return String(process.env[name] || '').trim()
}

function boolEnv(name, fallback = true) {
  const raw = env(name).toLowerCase()
  if (!raw) return fallback
  return raw === 'true' || raw === '1' || raw === 'yes'
}

function numberEnv(name, fallback, min, max) {
  const value = Number(env(name))
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAutoPublishEnabled() {
  return env('SOCIAL_AUTO_PUBLISH').toLowerCase() === 'true'
}

function enabledPlatforms() {
  return SOCIAL_PLATFORMS.filter((platform) => boolEnv(`SOCIAL_PUBLISH_${platform.toUpperCase()}`, true))
}

function configuredPlatform({ platform, label, required, credentialSource = null, accountId = null, accountName = null }) {
  const missing = required.filter((name) => !env(name))
  return {
    platform,
    label,
    enabled: boolEnv(`SOCIAL_PUBLISH_${platform.toUpperCase()}`, true),
    configured: missing.length === 0,
    missing,
    credentialSource,
    accountId,
    accountName,
  }
}

export function getSocialPublishingConfiguration() {
  const instagramTokenSource = env('INSTAGRAM_ACCESS_TOKEN') ? 'INSTAGRAM_ACCESS_TOKEN' : env('FACEBOOK_PAGE_ACCESS_TOKEN') ? 'FACEBOOK_PAGE_ACCESS_TOKEN' : null
  const linkedInStatic = Boolean(env('LINKEDIN_ACCESS_TOKEN'))
  const linkedInRefresh = ['LINKEDIN_REFRESH_TOKEN', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'].every((name) => env(name))
  const linkedin = configuredPlatform({
    platform: 'linkedin',
    label: 'LinkedIn',
    required: ['LINKEDIN_ORGANIZATION_ID'],
    credentialSource: linkedInStatic ? 'LINKEDIN_ACCESS_TOKEN' : linkedInRefresh ? 'LINKEDIN_REFRESH_TOKEN' : null,
    accountId: env('LINKEDIN_ORGANIZATION_ID') || null,
    accountName: env('LINKEDIN_ORGANIZATION_NAME') || null,
  })
  if (!linkedInStatic && !linkedInRefresh) {
    linkedin.configured = false
    linkedin.missing.push('LINKEDIN_ACCESS_TOKEN or LINKEDIN_REFRESH_TOKEN + LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET')
  }
  return {
    autoPublishEnabled: isAutoPublishEnabled(),
    providers: {
      facebook: configuredPlatform({
        platform: 'facebook',
        label: 'Facebook',
        required: ['FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_ACCESS_TOKEN'],
        credentialSource: env('FACEBOOK_PAGE_ACCESS_TOKEN') ? 'FACEBOOK_PAGE_ACCESS_TOKEN' : null,
        accountId: env('FACEBOOK_PAGE_ID') || null,
        accountName: env('FACEBOOK_PAGE_NAME') || null,
      }),
      instagram: configuredPlatform({
        platform: 'instagram',
        label: 'Instagram',
        required: ['INSTAGRAM_ACCOUNT_ID', ...(instagramTokenSource ? [] : ['INSTAGRAM_ACCESS_TOKEN or FACEBOOK_PAGE_ACCESS_TOKEN'])],
        credentialSource: instagramTokenSource,
        accountId: env('INSTAGRAM_ACCOUNT_ID') || null,
        accountName: env('INSTAGRAM_USERNAME') ? `@${env('INSTAGRAM_USERNAME').replace(/^@/, '')}` : null,
      }),
      linkedin,
      youtube: configuredPlatform({
        platform: 'youtube',
        label: 'YouTube',
        required: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
        credentialSource: env('YOUTUBE_REFRESH_TOKEN') ? 'YOUTUBE_REFRESH_TOKEN' : null,
        accountId: env('YOUTUBE_CHANNEL_ID') || null,
        accountName: env('YOUTUBE_CHANNEL_NAME') || null,
      }),
    },
  }
}

function absoluteCommercialPath(relativePath) {
  const projectRoot = path.resolve(process.cwd())
  const commercialRoot = path.resolve(projectRoot, 'jobs', 'commercials')
  const absolute = path.resolve(projectRoot, String(relativePath || ''))
  if (!absolute.startsWith(`${commercialRoot}${path.sep}`) || path.extname(absolute).toLowerCase() !== '.mp4') {
    const error = new Error('Social publishing source must be an MP4 inside jobs/commercials')
    error.code = 'SOCIAL_SOURCE_INVALID'
    throw error
  }
  if (!fs.existsSync(absolute)) {
    const error = new Error(`Social publishing MP4 is missing: ${relativePath}`)
    error.code = 'SOCIAL_SOURCE_MISSING'
    throw error
  }
  return absolute
}

function sanitizeTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100)
}

export function buildSocialCommercialCopy({ jobId, jobName, output = {} } = {}) {
  if (jobId === 'createShortFormFunnyShotsSmall') {
    return {
      title: sanitizeTitle(`${jobName || 'GolfHomiez Funny Shots'} | GolfHomiez`),
      caption: 'Golf happens. Save the funny shots, challenge your homiez, and keep the round memories going. GolfHomiez.com #GolfHomiez #Golf #GolfFails #FunnyGolf',
      tags: ['GolfHomiez', 'Golf', 'GolfFails', 'FunnyGolf'],
    }
  }
  if (jobId === 'createShortFormCurrentEventsSmall') {
    const topic = String(output?.topic || 'Golf today').replace(/\s+/g, ' ').trim()
    return {
      title: sanitizeTitle(`${topic} | GolfHomiez`),
      caption: `${topic}. Keep up with golf, log your rounds, challenge your homiez, and make every round part of the story. GolfHomiez.com #GolfHomiez #Golf #GolfNews`,
      tags: ['GolfHomiez', 'Golf', 'GolfNews'],
    }
  }
  return {
    title: sanitizeTitle(`${jobName || 'GolfHomiez Great Shots'} | GolfHomiez`),
    caption: 'Great shot? Log it. Challenge it. Replay it. GolfHomiez.com #GolfHomiez #Golf #GolfShots #GolfLife',
    tags: ['GolfHomiez', 'Golf', 'GolfShots', 'GolfLife'],
  }
}

class SocialHttpError extends Error {
  constructor(message, { statusCode = null, body = null, retryAfter = null } = {}) {
    super(message)
    this.name = 'SocialHttpError'
    this.code = 'SOCIAL_HTTP_ERROR'
    this.statusCode = statusCode
    this.body = body
    this.retryAfter = retryAfter
  }
}

function cachedAccessToken(platform) {
  const cached = tokenCache.get(platform)
  return cached?.accessToken && cached.expiresAt > Date.now() + 60_000 ? cached.accessToken : null
}

async function refreshAccessToken(platform, url, parameters, label, fetchImpl) {
  const cached = cachedAccessToken(platform)
  if (cached) return cached
  const { body } = await socialFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(parameters),
  }, label, fetchImpl)
  if (!body?.access_token) throw new Error(`${label} did not return an access token`)
  const expiresIn = Math.max(120, Number(body.expires_in || 3600))
  tokenCache.set(platform, { accessToken: String(body.access_token), expiresAt: Date.now() + expiresIn * 1000 })
  return String(body.access_token)
}

export async function getSocialConnectionFromEnvironment(platform, { fetchImpl = fetch } = {}) {
  const configuration = getSocialPublishingConfiguration().providers[platform]
  if (!configuration?.configured || !configuration.enabled) return null
  if (platform === 'facebook') {
    return {
      accessToken: env('FACEBOOK_PAGE_ACCESS_TOKEN'),
      accountId: env('FACEBOOK_PAGE_ID'),
      accountName: env('FACEBOOK_PAGE_NAME') || 'Facebook Page',
      metadata: { facebookPageId: env('FACEBOOK_PAGE_ID'), graphApiVersion: env('META_GRAPH_API_VERSION') || 'v24.0' },
    }
  }
  if (platform === 'instagram') {
    return {
      accessToken: env('INSTAGRAM_ACCESS_TOKEN') || env('FACEBOOK_PAGE_ACCESS_TOKEN'),
      accountId: env('INSTAGRAM_ACCOUNT_ID'),
      accountName: env('INSTAGRAM_USERNAME') || 'Instagram Professional account',
      metadata: {
        instagramAccountId: env('INSTAGRAM_ACCOUNT_ID'),
        instagramUsername: env('INSTAGRAM_USERNAME').replace(/^@/, ''),
        graphApiVersion: env('META_GRAPH_API_VERSION') || 'v24.0',
      },
    }
  }
  if (platform === 'linkedin') {
    const accessToken = env('LINKEDIN_ACCESS_TOKEN') || await refreshAccessToken('linkedin', 'https://www.linkedin.com/oauth/v2/accessToken', {
      grant_type: 'refresh_token',
      refresh_token: env('LINKEDIN_REFRESH_TOKEN'),
      client_id: env('LINKEDIN_CLIENT_ID'),
      client_secret: env('LINKEDIN_CLIENT_SECRET'),
    }, 'LinkedIn access-token refresh', fetchImpl)
    return {
      accessToken,
      accountId: env('LINKEDIN_ORGANIZATION_ID'),
      accountName: env('LINKEDIN_ORGANIZATION_NAME') || 'LinkedIn organization',
      metadata: { organizationId: env('LINKEDIN_ORGANIZATION_ID') },
    }
  }
  if (platform === 'youtube') {
    const accessToken = await refreshAccessToken('youtube', 'https://oauth2.googleapis.com/token', {
      grant_type: 'refresh_token',
      refresh_token: env('YOUTUBE_REFRESH_TOKEN'),
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
    }, 'Google access-token refresh', fetchImpl)
    return {
      accessToken,
      accountId: env('YOUTUBE_CHANNEL_ID') || null,
      accountName: env('YOUTUBE_CHANNEL_NAME') || 'YouTube',
      metadata: { channelId: env('YOUTUBE_CHANNEL_ID') || null },
    }
  }
  return null
}

async function responseBody(response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

async function socialFetch(url, options = {}, label = 'Social API request', fetchImpl = fetch) {
  const response = await fetchImpl(url, options)
  const body = await responseBody(response)
  if (response.ok) return { response, body: body || {} }
  const message = body?.error?.message || body?.message || body?.error_description || body?.raw || `${label} returned HTTP ${response.status}`
  throw new SocialHttpError(`${label}: ${message}`, {
    statusCode: response.status,
    body,
    retryAfter: response.headers?.get?.('retry-after') || null,
  })
}

function isAuthorizationError(error) {
  return error?.statusCode === 401 || error?.statusCode === 403 || /access token|oauth|authorization|permission|invalid token/i.test(String(error?.message || ''))
}

function isRetryableError(error) {
  const status = Number(error?.statusCode || 0)
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500 || /fetch failed|network|timeout|temporar/i.test(String(error?.message || ''))
}

function nextRetryAt(attemptCount, retryAfter = null) {
  const parsedRetryAfter = Number(retryAfter)
  const retryAfterMs = Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0 ? parsedRetryAfter * 1000 : 0
  const exponential = Math.min(MAX_RETRY_INTERVAL_MS, 60_000 * Math.pow(2, Math.max(0, attemptCount - 1)))
  return new Date(Date.now() + Math.max(retryAfterMs, exponential))
}

function publicMediaBaseUrl() {
  const base = env('SOCIAL_PUBLIC_BASE_URL') || env('BETTER_AUTH_URL') || env('PUBLIC_APP_URL')
  return base ? base.replace(/\/$/, '') : ''
}

export function buildSignedCommercialMediaUrl({ runId, relativePath } = {}) {
  const base = publicMediaBaseUrl()
  if (!base) {
    const error = new Error('SOCIAL_PUBLIC_BASE_URL or BETTER_AUTH_URL is required for Instagram media retrieval')
    error.code = 'SOCIAL_PUBLIC_BASE_URL_MISSING'
    throw error
  }
  const ttl = numberEnv('SOCIAL_MEDIA_URL_TTL_SECONDS', 3600, 300, 86400)
  const token = createSignedSocialMediaToken({ runId, relativePath, ttlSeconds: ttl })
  return `${base}/api/social-publishing/media/${encodeURIComponent(token)}`
}

async function publishFacebook({ connection, absolutePath, copy, fetchImpl }) {
  const pageId = connection.metadata?.facebookPageId || connection.accountId
  if (!pageId) throw new Error('Connected Meta account does not contain a Facebook Page id')
  const version = connection.metadata?.graphApiVersion || env('META_GRAPH_API_VERSION') || 'v24.0'
  const bytes = await fs.promises.readFile(absolutePath)
  const form = new FormData()
  form.append('access_token', connection.accessToken)
  form.append('description', copy.caption)
  form.append('source', new Blob([bytes], { type: 'video/mp4' }), path.basename(absolutePath))
  const { body } = await socialFetch(
    `https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}/videos`,
    { method: 'POST', body: form },
    'Facebook Page video publish',
    fetchImpl,
  )
  const videoId = body?.id ? String(body.id) : null
  return {
    mediaId: videoId,
    postId: videoId,
    url: videoId ? `https://www.facebook.com/${pageId}/videos/${videoId}` : `https://www.facebook.com/${pageId}`,
  }
}

async function pollInstagramContainer({ version, creationId, accessToken, fetchImpl }) {
  const attempts = numberEnv('SOCIAL_INSTAGRAM_PROCESSING_ATTEMPTS', 20, 3, 60)
  for (let index = 0; index < attempts; index += 1) {
    const url = new URL(`https://graph.facebook.com/${version}/${creationId}`)
    url.searchParams.set('fields', 'status_code,status')
    url.searchParams.set('access_token', accessToken)
    const { body } = await socialFetch(url, {}, 'Instagram Reel processing status', fetchImpl)
    const status = String(body?.status_code || '').toUpperCase()
    if (status === 'FINISHED') return
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`Instagram Reel container entered ${status}: ${body?.status || 'processing failed'}`)
    await wait(numberEnv('SOCIAL_INSTAGRAM_PROCESSING_POLL_MS', 3000, 500, 10000))
  }
  const error = new Error('Instagram Reel did not finish processing before the polling timeout')
  error.code = 'SOCIAL_PROCESSING_TIMEOUT'
  throw error
}

async function publishInstagram({ connection, publication, copy, fetchImpl }) {
  const instagramAccountId = connection.metadata?.instagramAccountId
  if (!instagramAccountId) throw new Error('The connected Facebook Page does not have an Instagram Professional account linked to it')
  const version = connection.metadata?.graphApiVersion || env('META_GRAPH_API_VERSION') || 'v24.0'
  const videoUrl = buildSignedCommercialMediaUrl({ runId: publication.scheduledJobRunId, relativePath: publication.sourceFileRelativePath })
  const create = new URL(`https://graph.facebook.com/${version}/${instagramAccountId}/media`)
  create.searchParams.set('media_type', 'REELS')
  create.searchParams.set('video_url', videoUrl)
  create.searchParams.set('caption', copy.caption)
  create.searchParams.set('share_to_feed', 'true')
  create.searchParams.set('access_token', connection.accessToken)
  const { body: created } = await socialFetch(create, { method: 'POST' }, 'Instagram Reel container creation', fetchImpl)
  const creationId = created?.id ? String(created.id) : null
  if (!creationId) throw new Error('Instagram did not return a Reel creation id')
  await pollInstagramContainer({ version, creationId, accessToken: connection.accessToken, fetchImpl })
  const publish = new URL(`https://graph.facebook.com/${version}/${instagramAccountId}/media_publish`)
  publish.searchParams.set('creation_id', creationId)
  publish.searchParams.set('access_token', connection.accessToken)
  const { body } = await socialFetch(publish, { method: 'POST' }, 'Instagram Reel publish', fetchImpl)
  const mediaId = body?.id ? String(body.id) : creationId
  return {
    mediaId,
    postId: mediaId,
    url: connection.metadata?.instagramUsername ? `https://www.instagram.com/${connection.metadata.instagramUsername}/` : 'https://www.instagram.com/',
  }
}

function linkedInHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Linkedin-Version': env('LINKEDIN_API_VERSION') || `${new Date().getUTCFullYear()}${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`,
    'X-Restli-Protocol-Version': '2.0.0',
  }
}

async function uploadLinkedInVideo({ connection, absolutePath, fetchImpl }) {
  const organizationId = connection.metadata?.organizationId || connection.accountId || env('LINKEDIN_ORGANIZATION_ID')
  if (!organizationId) throw new Error('LINKEDIN_ORGANIZATION_ID is required for organization video publishing')
  const bytes = await fs.promises.readFile(absolutePath)
  const owner = `urn:li:organization:${organizationId}`
  const headers = linkedInHeaders(connection.accessToken)
  const { body: initialized } = await socialFetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false } }),
  }, 'LinkedIn video initializeUpload', fetchImpl)
  const value = initialized?.value || {}
  const videoUrn = value.video
  const uploadToken = value.uploadToken || ''
  const instructions = Array.isArray(value.uploadInstructions) ? value.uploadInstructions : []
  if (!videoUrn || !instructions.length) throw new Error('LinkedIn did not return video upload instructions')
  const partIds = []
  for (const instruction of instructions) {
    const first = Number(instruction.firstByte || 0)
    const last = Number(instruction.lastByte ?? (bytes.length - 1))
    const chunk = bytes.subarray(first, Math.min(bytes.length, last + 1))
    const response = await fetchImpl(instruction.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(chunk.length) },
      body: chunk,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new SocialHttpError(`LinkedIn video part upload returned HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`, { statusCode: response.status })
    }
    const etag = response.headers?.get?.('etag')
    if (etag) partIds.push(etag.replace(/^"|"$/g, ''))
  }
  if (uploadToken || instructions.length > 1) {
    await socialFetch('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ finalizeUploadRequest: { video: videoUrn, uploadToken, uploadedPartIds: partIds } }),
    }, 'LinkedIn video finalizeUpload', fetchImpl)
  }
  return { videoUrn, owner }
}

async function pollLinkedInVideo({ connection, videoUrn, fetchImpl }) {
  const attempts = numberEnv('SOCIAL_LINKEDIN_PROCESSING_ATTEMPTS', 20, 3, 60)
  const headers = linkedInHeaders(connection.accessToken)
  const encoded = encodeURIComponent(videoUrn)
  for (let index = 0; index < attempts; index += 1) {
    const { body } = await socialFetch(`https://api.linkedin.com/rest/videos/${encoded}`, { headers }, 'LinkedIn video processing status', fetchImpl)
    const status = String(body?.status || '').toUpperCase()
    if (status === 'AVAILABLE') return
    if (status === 'PROCESSING_FAILED') throw new Error('LinkedIn video processing failed')
    await wait(numberEnv('SOCIAL_LINKEDIN_PROCESSING_POLL_MS', 3000, 500, 10000))
  }
  const error = new Error('LinkedIn video did not become available before the polling timeout')
  error.code = 'SOCIAL_PROCESSING_TIMEOUT'
  throw error
}

async function publishLinkedIn({ connection, absolutePath, copy, fetchImpl }) {
  const { videoUrn, owner } = await uploadLinkedInVideo({ connection, absolutePath, fetchImpl })
  await pollLinkedInVideo({ connection, videoUrn, fetchImpl })
  const headers = linkedInHeaders(connection.accessToken)
  const response = await fetchImpl('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      author: owner,
      commentary: copy.caption,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { media: { title: copy.title, id: videoUrn } },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  })
  const body = await responseBody(response)
  if (!response.ok) {
    const message = body?.message || body?.error?.message || body?.raw || `LinkedIn Posts API returned HTTP ${response.status}`
    throw new SocialHttpError(`LinkedIn post publish: ${message}`, { statusCode: response.status, body })
  }
  const postId = response.headers?.get?.('x-restli-id') || body?.id || null
  return {
    mediaId: videoUrn,
    postId,
    url: postId ? `https://www.linkedin.com/feed/update/${postId}/` : 'https://www.linkedin.com/company/',
  }
}

function buildYouTubeMultipart({ metadata, videoBytes, boundary }) {
  const first = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`, 'utf8')
  const last = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  return Buffer.concat([first, videoBytes, last])
}

async function publishYouTube({ connection, absolutePath, copy, fetchImpl }) {
  const bytes = await fs.promises.readFile(absolutePath)
  const boundary = `golfhomiez-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const privacyStatus = env('YOUTUBE_PRIVACY_STATUS') || 'public'
  const metadata = {
    snippet: {
      title: copy.title,
      description: copy.caption,
      tags: copy.tags,
      categoryId: env('YOUTUBE_CATEGORY_ID') || '17',
    },
    status: {
      privacyStatus,
      selfDeclaredMadeForKids: false,
    },
  }
  const body = buildYouTubeMultipart({ metadata, videoBytes: bytes, boundary })
  const { body: result } = await socialFetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  }, 'YouTube video upload', fetchImpl)
  const videoId = result?.id ? String(result.id) : null
  if (!videoId) throw new Error('YouTube did not return a video id')
  return { mediaId: videoId, postId: videoId, url: `https://www.youtube.com/watch?v=${videoId}` }
}

async function publishPlatform({ db, publication, fetchImpl = fetch, logApi = () => {}, logError = () => {}, logScheduledJob = () => {} }) {
  const platform = publication.platform
  const copy = { title: publication.title, caption: publication.caption, tags: publication.caption?.match(/#[A-Za-z0-9_]+/g)?.map((tag) => tag.slice(1)) || [] }
  const absolutePath = absoluteCommercialPath(publication.sourceFileRelativePath)
  let connection
  try {
    connection = await getSocialConnectionFromEnvironment(platform, { fetchImpl })
  } catch (error) {
    const updated = await updateSocialPublication(db, publication.id, { status: 'failed', errorMessage: error.message, nextAttemptAt: null })
    logError('Social publishing credential refresh failed', { correlationId: publication.correlationId, platform, runId: publication.scheduledJobRunId, jobId: publication.jobId, error })
    logScheduledJob('social_publication_credential_refresh_failed', { correlationId: publication.correlationId, platform, runId: publication.scheduledJobRunId, jobId: publication.jobId, level: 'error', error: error.message })
    return updated
  }
  if (!connection) {
    const missing = getSocialPublishingConfiguration().providers[platform]?.missing || []
    const message = missing.length ? `Missing server .env configuration: ${missing.join(', ')}` : 'Social publishing is disabled for this platform'
    const updated = await updateSocialPublication(db, publication.id, { status: 'failed', errorMessage: message, nextAttemptAt: null })
    logError('Social publication configuration is incomplete', { correlationId: publication.correlationId, platform, runId: publication.scheduledJobRunId, jobId: publication.jobId, missing })
    logScheduledJob('social_publication_configuration_incomplete', { correlationId: publication.correlationId, platform, runId: publication.scheduledJobRunId, jobId: publication.jobId, level: 'error', missing })
    return updated
  }

  const attemptCount = publication.attemptCount + 1
  await updateSocialPublication(db, publication.id, { status: 'publishing', attemptCount, errorMessage: null, nextAttemptAt: null })
  const details = { correlationId: publication.correlationId, platform, runId: publication.scheduledJobRunId, jobId: publication.jobId, attemptCount }
  logApi('social_publication_started', details)
  logScheduledJob('social_publication_started', details)
  try {
    let result
    if (platform === 'facebook') result = await publishFacebook({ connection, absolutePath, copy, fetchImpl })
    else if (platform === 'instagram') result = await publishInstagram({ connection, publication, copy, fetchImpl })
    else if (platform === 'linkedin') result = await publishLinkedIn({ connection, absolutePath, copy, fetchImpl })
    else if (platform === 'youtube') result = await publishYouTube({ connection, absolutePath, copy, fetchImpl })
    else throw new Error(`Unsupported social publishing platform: ${platform}`)
    const published = await updateSocialPublication(db, publication.id, {
      status: 'published',
      platformMediaId: result.mediaId || null,
      platformPostId: result.postId || null,
      platformUrl: result.url || null,
      errorMessage: null,
      nextAttemptAt: null,
      publishedAt: new Date(),
    })
    logApi('social_publication_completed', { ...details, platformPostId: result.postId || null, platformUrl: result.url || null })
    logScheduledJob('social_publication_completed', { ...details, platformPostId: result.postId || null, platformUrl: result.url || null })
    return published
  } catch (error) {
    if (isAuthorizationError(error)) {
      tokenCache.delete(platform)
      const updated = await updateSocialPublication(db, publication.id, { status: 'failed', errorMessage: error.message, nextAttemptAt: null })
      logError('Social publication authorization failed', { ...details, error })
      logScheduledJob('social_publication_authorization_failed', { ...details, level: 'error', error: error.message })
      return updated
    }
    const maxAttempts = numberEnv('SOCIAL_MAX_PUBLISH_ATTEMPTS', DEFAULT_MAX_ATTEMPTS, 1, 20)
    const retryable = isRetryableError(error) && attemptCount < maxAttempts
    const nextAttempt = retryable ? nextRetryAt(attemptCount, error.retryAfter) : null
    const updated = await updateSocialPublication(db, publication.id, {
      status: retryable ? 'retry_pending' : 'failed',
      errorMessage: error.message,
      nextAttemptAt: nextAttempt,
    })
    logError('Social publication failed', { ...details, retryable, nextAttemptAt: nextAttempt?.toISOString?.() || null, error })
    logScheduledJob('social_publication_failed', { ...details, retryable, nextAttemptAt: nextAttempt?.toISOString?.() || null, level: retryable ? 'warn' : 'error', error: error.message })
    return updated
  }
}

export async function publishCommercialToSocialPlatforms({
  db,
  runId,
  jobId,
  jobName,
  output,
  correlationId,
  fetchImpl = fetch,
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
} = {}) {
  if (!SOCIAL_COMMERCIAL_JOB_IDS.has(jobId)) return { enabled: false, reason: 'not_commercial_job', publications: [] }
  if (!isAutoPublishEnabled()) return { enabled: false, reason: 'social_auto_publish_disabled', publications: [] }
  if (!runId || !output?.relativePath) return { enabled: true, reason: 'missing_generated_mp4', publications: [] }
  absoluteCommercialPath(output.relativePath)
  const copy = buildSocialCommercialCopy({ jobId, jobName, output })
  const platforms = enabledPlatforms()
  const publications = []
  for (const platform of platforms) {
    let publication = await ensureSocialPublication(db, {
      scheduledJobRunId: runId,
      jobId,
      platform,
      sourceFileRelativePath: output.relativePath,
      title: copy.title,
      caption: copy.caption,
      correlationId,
    })
    if (publication.status === 'published') {
      publications.push(publication)
      continue
    }
    publication = await publishPlatform({ db, publication, fetchImpl, logApi, logError, logScheduledJob })
    publications.push(publication)
  }
  return { enabled: true, publications }
}

export async function retrySocialPublicationsForRun(db, runId, options = {}) {
  const publications = await listSocialPublicationsForRun(db, runId)
  const results = []
  for (const publication of publications) {
    if (publication.status === 'published') {
      results.push(publication)
      continue
    }
    if (!['failed', 'retry_pending', 'publishing', 'not_connected', 'reconnect_required'].includes(publication.status)) {
      results.push(publication)
      continue
    }
    const reset = await updateSocialPublication(db, publication.id, { status: 'retry_pending', nextAttemptAt: new Date(), errorMessage: publication.errorMessage })
    results.push(await publishPlatform({ db, publication: reset, ...options }))
  }
  return results
}

export async function retryDueSocialPublications(db, options = {}) {
  const due = await listRetryableSocialPublications(db, { limit: numberEnv('SOCIAL_RETRY_BATCH_SIZE', 20, 1, 100) })
  const results = []
  for (const publication of due) results.push(await publishPlatform({ db, publication, ...options }))
  return results
}

export function startSocialPublicationRetryWorker(getPool, {
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
  setTimer = setInterval,
  clearTimer = clearInterval,
} = {}) {
  if (!isAutoPublishEnabled()) return { stop() {} }
  const intervalMinutes = numberEnv('SOCIAL_RETRY_INTERVAL_MINUTES', DEFAULT_RETRY_INTERVAL_MINUTES, 5, 1440)
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const db = getPool()
      const results = await retryDueSocialPublications(db, { logApi, logError, logScheduledJob })
      if (results.length) logScheduledJob('social_retry_worker_completed', { publicationCount: results.length })
    } catch (error) {
      logError('Social publication retry worker failed', { error })
    } finally {
      running = false
    }
  }
  void run()
  const timer = setTimer(() => void run(), intervalMinutes * 60_000)
  if (typeof timer?.unref === 'function') timer.unref()
  return { stop() { clearTimer(timer) } }
}

export async function currentSocialPublicationStatus(db, runId) {
  return listSocialPublicationsForRun(db, runId)
}

export async function publicationAlreadyExists(db, runId, platform) {
  return Boolean(await getSocialPublication(db, runId, platform))
}
