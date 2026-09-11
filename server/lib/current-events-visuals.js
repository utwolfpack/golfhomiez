import fs from 'node:fs/promises'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { fetchPexelsJson, pexelsApiKey } from './pexels-api.js'

const IMAGE_CONTENT_TYPES = Object.freeze({
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
})

const UNSUPPORTED_IMAGE_CONTENT_TYPES = new Set([
  'image/avif',
  'image/heic',
  'image/heif',
])

const LOW_VALUE_IMAGE_RE = /(?:logo|icon|avatar|sprite|tracking|pixel|badge|favicon|advert|promo|newsletter|author|headshot)/i
const MAX_IMAGE_CANDIDATES_PER_SOURCE = 48
const DEFAULT_IMAGE_TIMEOUT_MS = 10000
const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024

const PEXELS_PHOTO_SEARCH_URL = 'https://api.pexels.com/v1/search'
const PEXELS_VIDEO_SEARCH_URL = 'https://api.pexels.com/v1/videos/search'
const PEXELS_RESULTS_PER_REQUEST = 20
const DEFAULT_PEXELS_VIDEO_MAX_BYTES = 24 * 1024 * 1024
const PEXELS_VIDEO_MIN_SECONDS = 2
const PEXELS_VIDEO_MAX_SECONDS = 30

function htmlEntityDecode(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
}

function cleanText(value) {
  return htmlEntityDecode(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const quoted = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'))
  if (quoted) return htmlEntityDecode(quoted[2]).trim()
  const unquoted = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*([^\\s>]+)`, 'i'))
  return unquoted ? htmlEntityDecode(unquoted[1]).trim() : ''
}

function resolveImageUrl(value, baseUrl) {
  const raw = String(value || '').trim()
  if (!raw || /^(?:data:|javascript:|blob:)/i.test(raw)) return null
  try {
    const resolved = new URL(raw, baseUrl)
    if (!/^https?:$/.test(resolved.protocol)) return null
    return resolved.href
  } catch {
    return null
  }
}

function imageFromSrcset(value) {
  const entries = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, descriptor = ''] = entry.split(/\s+/, 2)
      const width = descriptor.endsWith('w') ? Number.parseInt(descriptor, 10) : 0
      const density = descriptor.endsWith('x') ? Number.parseFloat(descriptor) * 1000 : 0
      return { url, score: width || density || 1 }
    })
    .sort((a, b) => b.score - a.score)
  return entries[0]?.url || ''
}

function addCandidate(candidates, seen, { rawUrl, baseUrl, alt = '', context = '', kind = 'img' }) {
  const url = resolveImageUrl(rawUrl, baseUrl)
  if (!url || seen.has(url)) return
  const searchable = `${url} ${alt}`
  if (/\.(?:svg|ico)(?:\?|$)/i.test(url)) return
  if (LOW_VALUE_IMAGE_RE.test(searchable) && kind !== 'meta') return
  seen.add(url)
  candidates.push({ url, alt: cleanText(alt), context: cleanText(context), kind })
}


function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return /^https?:$/.test(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function pexelsQuery(topic) {
  const label = cleanText(topic?.label || '')
  return label ? `${label} golf` : 'professional golf golfer'
}

function choosePexelsVideoFile(video) {
  const files = Array.isArray(video?.video_files) ? video.video_files : []
  const targetArea = 1080 * 1920
  return files
    .filter((file) => /^video\/mp4/i.test(String(file?.file_type || 'video/mp4')) && safeHttpUrl(file?.link))
    .map((file) => {
      const width = Number(file?.width || 0)
      const height = Number(file?.height || 0)
      const area = width > 0 && height > 0 ? width * height : 0
      return {
        ...file,
        portraitBonus: height >= width && height > 0 ? 1 : 0,
        practicalBonus: Math.min(width, height) >= 720 && Math.max(width, height) <= 1920 ? 2 : Math.max(width, height) <= 1920 ? 1 : 0,
        targetDistance: area > 0 ? Math.abs(area - targetArea) : Number.MAX_SAFE_INTEGER,
      }
    })
    .sort((a, b) => b.portraitBonus - a.portraitBonus || b.practicalBonus - a.practicalBonus || a.targetDistance - b.targetDistance)[0] || null
}

export function parsePexelsCurrentEventsPhotos(payload = {}) {
  const photos = Array.isArray(payload?.photos) ? payload.photos : []
  return photos.slice(0, PEXELS_RESULTS_PER_REQUEST).map((photo) => {
    const imageUrl = safeHttpUrl(photo?.src?.large2x || photo?.src?.portrait || photo?.src?.large || photo?.src?.original)
    const sourcePageUrl = safeHttpUrl(photo?.url)
    if (!imageUrl || !sourcePageUrl) return null
    return {
      url: imageUrl,
      alt: cleanText(photo?.alt || 'Golf image from Pexels'),
      context: cleanText(photo?.alt || ''),
      kind: 'pexels-photo',
      origin: 'pexels',
      mediaType: 'image',
      sourceName: 'Pexels',
      sourcePageUrl,
      creator: cleanText(photo?.photographer || 'Pexels creator'),
      creatorUrl: safeHttpUrl(photo?.photographer_url),
      pexelsId: String(photo?.id || ''),
      license: 'Pexels License',
      licenseUrl: 'https://www.pexels.com/license/',
    }
  }).filter(Boolean)
}

export function parsePexelsCurrentEventsVideos(payload = {}) {
  const videos = Array.isArray(payload?.videos) ? payload.videos : []
  return videos.slice(0, PEXELS_RESULTS_PER_REQUEST).map((video) => {
    const durationSeconds = Number(video?.duration || 0)
    if (!Number.isFinite(durationSeconds) || durationSeconds < PEXELS_VIDEO_MIN_SECONDS || durationSeconds > PEXELS_VIDEO_MAX_SECONDS) return null
    const file = choosePexelsVideoFile(video)
    const downloadUrl = safeHttpUrl(file?.link)
    const sourcePageUrl = safeHttpUrl(video?.url)
    if (!downloadUrl || !sourcePageUrl) return null
    return {
      downloadUrl,
      origin: 'pexels',
      mediaType: 'video',
      sourceName: 'Pexels',
      sourcePageUrl,
      creator: cleanText(video?.user?.name || 'Pexels creator'),
      creatorUrl: safeHttpUrl(video?.user?.url),
      pexelsId: String(video?.id || ''),
      durationSeconds,
      width: Number(file?.width || 0) || null,
      height: Number(file?.height || 0) || null,
      license: 'Pexels License',
      licenseUrl: 'https://www.pexels.com/license/',
      alt: 'Golf video from Pexels',
    }
  }).filter(Boolean)
}

export async function fetchPexelsCurrentEventsMedia({
  topic = null,
  fetchImpl = globalThis.fetch,
  signal = null,
  correlationId = null,
  logApi = () => {},
  logScheduledJob = () => {},
} = {}) {
  const apiKey = pexelsApiKey()
  if (!apiKey) {
    const details = { correlationId, jobId: 'createShortFormCurrentEventsSmall', provider: 'Pexels', reason: 'PEXELS_API_KEY is not configured', level: 'warn' }
    logApi('current_events_pexels_skipped', details)
    logScheduledJob('current_events_pexels_skipped', details)
    return { photos: [], videos: [] }
  }

  const primaryQuery = pexelsQuery(topic)
  const fallbackQuery = 'professional golf golfer'
  const requests = async (query) => {
    const photoUrl = new URL(PEXELS_PHOTO_SEARCH_URL)
    photoUrl.searchParams.set('query', query)
    photoUrl.searchParams.set('orientation', 'portrait')
    photoUrl.searchParams.set('per_page', String(PEXELS_RESULTS_PER_REQUEST))
    const videoUrl = new URL(PEXELS_VIDEO_SEARCH_URL)
    videoUrl.searchParams.set('query', query)
    videoUrl.searchParams.set('orientation', 'portrait')
    videoUrl.searchParams.set('size', 'small')
    videoUrl.searchParams.set('per_page', String(PEXELS_RESULTS_PER_REQUEST))

    const [photoResult, videoResult] = await Promise.allSettled([
      fetchPexelsJson(photoUrl.href, { fetchImpl, signal, apiKey, jobId: 'createShortFormCurrentEventsSmall', correlationId, logApi, logScheduledJob }),
      fetchPexelsJson(videoUrl.href, { fetchImpl, signal, apiKey, jobId: 'createShortFormCurrentEventsSmall', correlationId, logApi, logScheduledJob }),
    ])
    if (signal?.aborted) {
      const reason = signal.reason
      throw reason instanceof Error ? reason : new Error('Current-events Pexels search was cancelled')
    }
    const photos = photoResult.status === 'fulfilled' ? parsePexelsCurrentEventsPhotos(photoResult.value.payload) : []
    const videos = videoResult.status === 'fulfilled' ? parsePexelsCurrentEventsVideos(videoResult.value.payload) : []
    let blocked = false
    for (const [kind, result] of [['photos', photoResult], ['videos', videoResult]]) {
      if (result.status === 'rejected') {
        const statusCode = Number(result.reason?.statusCode || 0) || null
        if ([401, 403, 429].includes(Number(statusCode || 0))) blocked = true
        const details = { correlationId, jobId: 'createShortFormCurrentEventsSmall', provider: 'Pexels', mediaKind: kind, query, error: result.reason?.message || String(result.reason), statusCode, level: 'warn' }
        logApi('current_events_pexels_search_failed', details)
        logScheduledJob('current_events_pexels_search_failed', details)
      }
    }
    return { photos, videos, blocked }
  }

  let result = await requests(primaryQuery)
  if (!result.blocked && !result.photos.length && !result.videos.length && primaryQuery !== fallbackQuery) result = await requests(fallbackQuery)
  const details = { correlationId, jobId: 'createShortFormCurrentEventsSmall', provider: 'Pexels', query: primaryQuery, photoCount: result.photos.length, videoCount: result.videos.length }
  logApi('current_events_pexels_media_discovered', details)
  logScheduledJob('current_events_pexels_media_discovered', details)
  return result
}

export async function downloadPexelsCurrentEventsVideo(candidate, {
  tempDir,
  fetchImpl = globalThis.fetch,
  signal = null,
  correlationId = null,
  maxBytes = DEFAULT_PEXELS_VIDEO_MAX_BYTES,
  logApi = () => {},
  logScheduledJob = () => {},
} = {}) {
  if (!candidate?.downloadUrl || !tempDir) return null
  const startedAt = Date.now()
  const details = { correlationId, jobId: 'createShortFormCurrentEventsSmall', provider: 'Pexels', mediaType: 'video', pexelsId: candidate.pexelsId || null, sourcePageUrl: candidate.sourcePageUrl || null }
  try {
    const response = await fetchImpl(candidate.downloadUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: sourceAbortSignal(signal, DEFAULT_IMAGE_TIMEOUT_MS * 2),
      headers: {
        Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.4',
        Referer: candidate.sourcePageUrl,
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      },
    })
    if (!response?.ok) throw new Error(`video returned HTTP ${response?.status || 'unknown'}`)
    const advertised = Number.parseInt(response.headers?.get?.('content-length') || '0', 10)
    if (Number.isFinite(advertised) && advertised > maxBytes) throw new Error(`video exceeds ${maxBytes} byte limit`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (!buffer.length || buffer.length > maxBytes) throw new Error(`video exceeds ${maxBytes} byte limit or is empty`)
    const contentType = normalizeContentType(response.headers?.get?.('content-type'))
    if (contentType && !/^video\/mp4$/i.test(contentType)) throw new Error(`unsupported Pexels video content type: ${contentType}`)
    const filePath = path.join(tempDir, `pexels-video-${candidate.pexelsId || Date.now()}.mp4`)
    await fs.writeFile(filePath, buffer)
    const completed = { ...details, bytes: buffer.length, durationMs: Date.now() - startedAt }
    logApi('current_events_pexels_video_download_completed', completed)
    logScheduledJob('current_events_pexels_video_download_completed', completed)
    return { ...candidate, path: filePath }
  } catch (error) {
    const failed = { ...details, error: error?.message || String(error), durationMs: Date.now() - startedAt, level: 'warn' }
    logApi('current_events_pexels_video_download_failed', failed)
    logScheduledJob('current_events_pexels_video_download_failed', failed)
    return null
  }
}

export function extractImageCandidates(html, baseUrl) {
  const source = String(html || '').slice(0, 900000)
  const candidates = []
  const seen = new Set()

  for (const tagMatch of source.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = tagMatch[0]
    const key = (getAttribute(tag, 'property') || getAttribute(tag, 'name')).toLowerCase()
    if (!['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'].includes(key)) continue
    addCandidate(candidates, seen, {
      rawUrl: getAttribute(tag, 'content'),
      baseUrl,
      alt: getAttribute(tag, 'alt') || key,
      kind: 'meta',
    })
    if (candidates.length >= MAX_IMAGE_CANDIDATES_PER_SOURCE) return candidates
  }

  for (const tagMatch of source.matchAll(/<img\b[^>]*>/gi)) {
    const tag = tagMatch[0]
    const index = tagMatch.index || 0
    const context = cleanText(source.slice(Math.max(0, index - 420), Math.min(source.length, index + tag.length + 420)))
    const rawUrl = getAttribute(tag, 'data-src')
      || getAttribute(tag, 'data-lazy-src')
      || getAttribute(tag, 'src')
      || imageFromSrcset(getAttribute(tag, 'srcset'))
    addCandidate(candidates, seen, {
      rawUrl,
      baseUrl,
      alt: getAttribute(tag, 'alt') || getAttribute(tag, 'title'),
      context,
      kind: 'img',
    })
    if (candidates.length >= MAX_IMAGE_CANDIDATES_PER_SOURCE) break
  }

  return candidates
}

function normalizedTopicTokens(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !['golf', 'the', 'cup', 'tour', 'news'].includes(token))
}

function candidateScore(candidate, topic, preferredSourceNames) {
  const searchable = `${candidate.alt || ''} ${candidate.context || ''} ${candidate.url || ''}`.toLowerCase()
  const topicLabel = String(topic?.label || '').toLowerCase()
  const tokens = normalizedTopicTokens(topicLabel)
  let score = candidate.kind === 'meta' ? 2 : 1
  if (preferredSourceNames.has(candidate.sourceName)) score += 5
  if (topicLabel && searchable.includes(topicLabel)) score += 12
  for (const token of tokens) if (searchable.includes(token)) score += 3
  if (LOW_VALUE_IMAGE_RE.test(searchable)) score -= 10
  return score
}

export function selectRelevantImageCandidates(sourceResults = [], topic = null, { maxCandidates = 12 } = {}) {
  const preferredSourceNames = new Set(topic?.sourceNames || [])
  const all = []
  for (const source of sourceResults) {
    if (source?.ok === false || !Array.isArray(source?.images)) continue
    for (const image of source.images) {
      if (!image?.url) continue
      all.push({
        ...image,
        sourceName: source.name,
        sourcePageUrl: source.requestedUrl || source.url || null,
      })
    }
  }

  const topicLabel = String(topic?.label || '').toLowerCase()
  const topicTokens = normalizedTopicTokens(topicLabel)
  const scored = all
    .map((candidate) => {
      const searchable = `${candidate.alt || ''} ${candidate.context || ''} ${candidate.url || ''}`.toLowerCase()
      const topicRelevant = !topicLabel || searchable.includes(topicLabel) || topicTokens.some((token) => searchable.includes(token))
      return { ...candidate, score: candidateScore(candidate, topic, preferredSourceNames), topicRelevant }
    })
    .sort((a, b) => b.score - a.score)

  const selected = []
  const seenUrls = new Set()
  const sourceUse = new Map()
  for (const candidate of scored) {
    if (seenUrls.has(candidate.url)) continue
    const sourceCount = sourceUse.get(candidate.sourceName) || 0
    if (sourceCount >= 2 && scored.some((item) => !seenUrls.has(item.url) && (sourceUse.get(item.sourceName) || 0) === 0)) continue
    if (topic?.label && !candidate.topicRelevant) continue
    selected.push(candidate)
    seenUrls.add(candidate.url)
    sourceUse.set(candidate.sourceName, sourceCount + 1)
    if (selected.length >= maxCandidates) break
  }
  return selected
}

function sourceAbortSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

function normalizeContentType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase()
}

function isIsoBmffImage(buffer, brands = []) {
  if (buffer.length < 12 || buffer.subarray(4, 8).toString('ascii') !== 'ftyp') return false
  const majorBrand = buffer.subarray(8, 12).toString('ascii').toLowerCase()
  if (brands.includes(majorBrand)) return true
  const compatibleBrands = buffer.subarray(16, Math.min(buffer.length, 64)).toString('ascii').toLowerCase()
  return brands.some((brand) => compatibleBrands.includes(brand))
}

function detectImageExtension(contentType, buffer, url) {
  // Sniff bytes before trusting headers/extensions. Several golf-news CDNs return
  // AVIF bytes from .webp/.jpg URLs; writing those bytes with the URL extension
  // makes ffmpeg choose the wrong image decoder.
  if (isIsoBmffImage(buffer, ['avif', 'avis', 'heic', 'heix', 'hevc', 'hevx', 'mif1'])) return null
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp'
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) return '.gif'
  if (UNSUPPORTED_IMAGE_CONTENT_TYPES.has(contentType)) return null
  if (IMAGE_CONTENT_TYPES[contentType]) return IMAGE_CONTENT_TYPES[contentType]
  const fromUrl = path.extname(new URL(url).pathname).toLowerCase()
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(fromUrl) ? (fromUrl === '.jpeg' ? '.jpg' : fromUrl) : null
}

export async function downloadRelevantImages({
  candidates = [],
  tempDir,
  fetchImpl = globalThis.fetch,
  signal = null,
  correlationId = null,
  maxImages = 3,
  timeoutMs = DEFAULT_IMAGE_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_IMAGE_BYTES,
  logApi = () => {},
  logScheduledJob = () => {},
} = {}) {
  if (!tempDir || !candidates.length || typeof fetchImpl !== 'function') return []
  const downloaded = []

  for (const candidate of candidates) {
    if (downloaded.length >= maxImages) break
    const startedAt = Date.now()
    const details = {
      correlationId,
      source: candidate.sourceName,
      imageUrl: candidate.url,
      sourcePageUrl: candidate.sourcePageUrl || null,
    }
    try {
      const headers = {
        Accept: 'image/webp,image/png,image/jpeg,image/gif,*/*;q=0.4',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      }
      if (candidate.sourcePageUrl) headers.Referer = candidate.sourcePageUrl
      const response = await fetchImpl(candidate.url, {
        method: 'GET',
        redirect: 'follow',
        signal: sourceAbortSignal(signal, timeoutMs),
        headers,
      })
      if (!response?.ok) throw new Error(`image returned HTTP ${response?.status || 'unknown'}`)
      const advertisedLength = Number.parseInt(response.headers?.get?.('content-length') || '0', 10)
      if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) throw new Error(`image exceeds ${maxBytes} byte limit`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length || buffer.length > maxBytes) throw new Error(`image exceeds ${maxBytes} byte limit or is empty`)
      const contentType = normalizeContentType(response.headers?.get?.('content-type'))
      const extension = detectImageExtension(contentType, buffer, candidate.url)
      if (!extension) {
        const format = UNSUPPORTED_IMAGE_CONTENT_TYPES.has(contentType) || isIsoBmffImage(buffer, ['avif', 'avis', 'heic', 'heix', 'hevc', 'hevx', 'mif1'])
          ? 'AVIF/HEIF'
          : (contentType || 'unknown')
        throw new Error(`unsupported image format for portable ffmpeg rendering: ${format}`)
      }
      const filePath = path.join(tempDir, `website-${downloaded.length + 1}${extension}`)
      await fs.writeFile(filePath, buffer)
      const completed = {
        ...details,
        bytes: buffer.length,
        contentType: contentType || null,
        durationMs: Date.now() - startedAt,
      }
      logApi('current_events_image_download_completed', completed)
      logScheduledJob('current_events_image_download_completed', completed)
      downloaded.push({
        path: filePath,
        sourceName: candidate.sourceName || 'Golf news',
        sourcePageUrl: candidate.sourcePageUrl || null,
        imageUrl: candidate.url,
        alt: candidate.alt || '',
        origin: candidate.origin || 'website',
        mediaType: 'image',
        creator: candidate.creator || null,
        creatorUrl: candidate.creatorUrl || null,
        pexelsId: candidate.pexelsId || null,
        license: candidate.license || null,
        licenseUrl: candidate.licenseUrl || null,
      })
    } catch (error) {
      const failed = { ...details, durationMs: Date.now() - startedAt, error: error?.message || String(error), level: 'warn' }
      logApi('current_events_image_download_failed', failed)
      logScheduledJob('current_events_image_download_failed', failed)
    }
  }
  return downloaded
}

function setPixel(buffer, width, height, x, y, rgb) {
  if (x < 0 || x >= width || y < 0 || y >= height) return
  const index = (y * width + x) * 3
  buffer[index] = rgb[0]
  buffer[index + 1] = rgb[1]
  buffer[index + 2] = rgb[2]
}

function fillRect(buffer, width, height, x0, y0, x1, y1, rgb) {
  const left = Math.max(0, Math.floor(x0))
  const top = Math.max(0, Math.floor(y0))
  const right = Math.min(width, Math.ceil(x1))
  const bottom = Math.min(height, Math.ceil(y1))
  for (let y = top; y < bottom; y += 1) {
    let index = (y * width + left) * 3
    for (let x = left; x < right; x += 1) {
      buffer[index] = rgb[0]
      buffer[index + 1] = rgb[1]
      buffer[index + 2] = rgb[2]
      index += 3
    }
  }
}

function fillCircle(buffer, width, height, cx, cy, radius, rgb) {
  const r2 = radius * radius
  const minY = Math.max(0, Math.floor(cy - radius))
  const maxY = Math.min(height - 1, Math.ceil(cy + radius))
  const minX = Math.max(0, Math.floor(cx - radius))
  const maxX = Math.min(width - 1, Math.ceil(cx + radius))
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx
      const dy = y - cy
      if ((dx * dx) + (dy * dy) <= r2) setPixel(buffer, width, height, x, y, rgb)
    }
  }
}

function fillTriangle(buffer, width, height, p1, p2, p3, rgb) {
  const minX = Math.max(0, Math.floor(Math.min(p1[0], p2[0], p3[0])))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(p1[0], p2[0], p3[0])))
  const minY = Math.max(0, Math.floor(Math.min(p1[1], p2[1], p3[1])))
  const maxY = Math.min(height - 1, Math.ceil(Math.max(p1[1], p2[1], p3[1])))
  const area = (p2[1] - p3[1]) * (p1[0] - p3[0]) + (p3[0] - p2[0]) * (p1[1] - p3[1])
  if (!area) return
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const a = ((p2[1] - p3[1]) * (x - p3[0]) + (p3[0] - p2[0]) * (y - p3[1])) / area
      const b = ((p3[1] - p1[1]) * (x - p3[0]) + (p1[0] - p3[0]) * (y - p3[1])) / area
      const c = 1 - a - b
      if (a >= 0 && b >= 0 && c >= 0) setPixel(buffer, width, height, x, y, rgb)
    }
  }
}

function createGolfScenePixels(width, height, variant) {
  const pixels = Buffer.alloc(width * height * 3)
  const skyTop = variant === 1 ? [87, 184, 235] : variant === 2 ? [112, 198, 242] : [75, 166, 220]
  const skyBottom = variant === 1 ? [211, 239, 252] : variant === 2 ? [238, 244, 217] : [199, 231, 247]
  const horizon = Math.round(height * (variant === 2 ? 0.54 : 0.58))

  for (let y = 0; y < horizon; y += 1) {
    const t = y / Math.max(1, horizon - 1)
    const rgb = skyTop.map((channel, index) => Math.round(channel + ((skyBottom[index] - channel) * t)))
    fillRect(pixels, width, height, 0, y, width, y + 1, rgb)
  }
  fillRect(pixels, width, height, 0, horizon, width, height, variant === 3 ? [27, 119, 63] : [35, 139, 70])

  // Sun and layered fairway shapes create a lightweight GolfHomiez-branded fallback visual.
  fillCircle(pixels, width, height, variant === 2 ? 575 : 125, 160, variant === 2 ? 72 : 58, [255, 222, 87])
  fillCircle(pixels, width, height, width * 0.25, horizon + 150, 330, [31, 125, 62])
  fillCircle(pixels, width, height, width * 0.82, horizon + 125, 360, [28, 116, 58])
  fillTriangle(pixels, width, height, [width * 0.35, height], [width * 0.50, horizon + 40], [width * 0.76, height], [83, 174, 91])
  fillCircle(pixels, width, height, variant === 1 ? 530 : 215, height - 210, 58, [232, 218, 178])

  const flagX = variant === 3 ? 250 : 505
  const flagTop = horizon + 70
  fillRect(pixels, width, height, flagX, flagTop, flagX + 8, height - 155, [245, 245, 245])
  fillTriangle(pixels, width, height, [flagX + 8, flagTop], [flagX + 138, flagTop + 38], [flagX + 8, flagTop + 78], variant === 2 ? [239, 84, 72] : [246, 190, 54])
  fillCircle(pixels, width, height, flagX + 5, height - 145, 33, [25, 84, 46])

  const ballX = variant === 1 ? 180 : variant === 2 ? 455 : 560
  const ballY = height - 145
  fillCircle(pixels, width, height, ballX, ballY, 48, [250, 250, 247])
  fillCircle(pixels, width, height, ballX - 12, ballY - 11, 4, [214, 218, 214])
  fillCircle(pixels, width, height, ballX + 14, ballY + 7, 4, [214, 218, 214])
  fillCircle(pixels, width, height, ballX + 4, ballY - 22, 4, [214, 218, 214])

  return pixels
}

export async function generateGolfHomiezFallbackVisuals({ tempDir, count = 3, width = 720, height = 1280 } = {}) {
  if (!tempDir) throw new Error('A temporary directory is required to generate golf visuals')
  const visuals = []
  for (let index = 0; index < count; index += 1) {
    const filePath = path.join(tempDir, `generated-golf-${index + 1}.ppm`)
    const header = Buffer.from(`P6\n${width} ${height}\n255\n`, 'ascii')
    const pixels = createGolfScenePixels(width, height, (index % 3) + 1)
    await fs.writeFile(filePath, Buffer.concat([header, pixels]))
    visuals.push({
      path: filePath,
      sourceName: 'GolfHomiez',
      sourcePageUrl: null,
      imageUrl: null,
      alt: 'GolfHomiez generated golf scene',
      origin: 'generated',
    })
  }
  return visuals
}

export async function prepareCurrentEventsVisuals({
  sourceResults = [],
  topic = null,
  tempDir,
  fetchImpl = globalThis.fetch,
  signal = null,
  correlationId = null,
  maxVisuals = 3,
  logApi = () => {},
  logScheduledJob = () => {},
} = {}) {
  const pexels = await fetchPexelsCurrentEventsMedia({ topic, fetchImpl, signal, correlationId, logApi, logScheduledJob })
  const pexelsVisuals = []
  if (pexels.videos.length && pexelsVisuals.length < maxVisuals) {
    const video = await downloadPexelsCurrentEventsVideo(pexels.videos[0], { tempDir, fetchImpl, signal, correlationId, logApi, logScheduledJob })
    if (video) pexelsVisuals.push(video)
  }
  if (pexelsVisuals.length < maxVisuals && pexels.photos.length) {
    const photos = await downloadRelevantImages({
      candidates: pexels.photos,
      tempDir,
      fetchImpl,
      signal,
      correlationId,
      maxImages: maxVisuals - pexelsVisuals.length,
      logApi,
      logScheduledJob,
    })
    pexelsVisuals.push(...photos)
  }

  const candidates = selectRelevantImageCandidates(sourceResults, topic)
  logApi('current_events_visual_candidates_selected', {
    correlationId,
    topic: topic?.label || null,
    candidateCount: candidates.length,
    candidateSources: [...new Set(candidates.map((candidate) => candidate.sourceName))],
    pexelsVisualCount: pexelsVisuals.length,
  })

  const remainingAfterPexels = Math.max(0, maxVisuals - pexelsVisuals.length)
  const websiteVisuals = remainingAfterPexels ? await downloadRelevantImages({
    candidates,
    tempDir,
    fetchImpl,
    signal,
    correlationId,
    maxImages: remainingAfterPexels,
    logApi,
    logScheduledJob,
  }) : []
  const remaining = Math.max(0, maxVisuals - pexelsVisuals.length - websiteVisuals.length)
  const generatedVisuals = remaining ? await generateGolfHomiezFallbackVisuals({ tempDir, count: remaining }) : []
  if (generatedVisuals.length) {
    const details = {
      correlationId,
      topic: topic?.label || null,
      generatedCount: generatedVisuals.length,
      reason: pexelsVisuals.length || websiteVisuals.length ? 'fill-missing-external-visuals' : 'no-usable-external-visuals',
    }
    logApi('current_events_generated_visuals_created', details)
    logScheduledJob('current_events_generated_visuals_created', details)
  }
  return [...pexelsVisuals, ...websiteVisuals, ...generatedVisuals].slice(0, maxVisuals)
}
