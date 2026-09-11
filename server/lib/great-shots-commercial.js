import fs from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn as nodeSpawn } from 'node:child_process'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import {
  ensureManagedFfmpeg,
  isManagedFfmpegAutoDownloadEnabled,
  resolveFfmpegPath,
} from './ffmpeg-runtime.js'
import { generateGolfHomiezFallbackVisuals } from './current-events-visuals.js'
import { fetchPexelsJson, getLatestPexelsQuota, pexelsApiKey } from './pexels-api.js'
import {
  backgroundMusicMetadata,
  commercialBackgroundMusicVolume,
  resolveCommercialBackgroundMusicFile,
} from './commercial-background-music.js'

export const GREAT_SHOTS_COMMERCIAL_JOB_ID = 'createShortFormGreatShotsSmall'
export const GREAT_SHOTS_COMMERCIAL_JOB_NAME = 'Create Short-form Great Shots - Small'
export const GREAT_SHOTS_COMMERCIAL_FILE_TAG = 'GreatShotShort'
export const GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS = 30
// Retained as an exported compatibility alias for callers that used the old fixed-duration constant.
export const GREAT_SHOTS_COMMERCIAL_DURATION_SECONDS = GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS

const GREAT_SHOTS_MIN_SOURCE_DURATION_SECONDS = 2
const DEFAULT_FETCH_TIMEOUT_MS = 15000
const DEFAULT_VIDEO_TIMEOUT_MS = 30000
const DEFAULT_MAX_VIDEO_BYTES = 60 * 1024 * 1024
const MAX_HISTORY_RUNS = 2000
const MAX_CANDIDATES_PER_PROVIDER = 60
const MAX_SELECTION_CANDIDATES_PER_CATEGORY = 40
const PEXELS_VIDEO_SEARCH_URL = 'https://api.pexels.com/v1/videos/search'
const PEXELS_RESULTS_PER_QUERY = 50
const GREAT_SHOT_GOLF_RE = /\b(?:golf|golfer|golfing|tee(?:ing)?|fairway|green|putt(?:ing)?|chip(?:ping)?|bunker)\b/i
const GREAT_SHOT_ACTION_RE = /\b(?:swing|shot|drive|drives|driving|long drive|tee shot|approach|putt|putts|putting|chip|chips|pitch|pitches|hole[- ]?in[- ]?one|ace|sink|sinks|drain|drains|makes?|hits?|strike|strikes|trick shot|shank|duff|slice|hook|miss|bounce|bank|yips?)\b/i
const GREAT_SHOT_PERSON_RE = /\b(?:golfer|player|man|woman|boy|girl|kid|child|father|mother|senior|person|professional|amateur|pga|lpga|tour player|weekend golfer)\b/i
const GREAT_SHOT_MOMENT_RE = /\b(?:great|amazing|incredible|perfect|pure|clutch|hole[- ]?in[- ]?one|ace|chip[- ]?in|long putt|long drive|trick shot|funny|hilarious|lucky|wild|crazy|ridiculous|shank|duff|miss|bank|bounce|eagle|birdie|yips?)\b/i
const GREAT_SHOT_REJECT_RE = /\b(?:drone|flyover|course tour|animation|animated|video game|gameplay|virtual reality|simulator|simulation|podcast|interview|press conference|equipment review|club review|product review|lesson|tutorial|instruction|documentary|trailer|advertisement|commercial|promo)\b/i
const COMMERCIAL_FRIENDLY_COMMONS_LICENSE_RE = /(?:\bcc\s*0\b|creative commons zero|public domain|\bcc[- ]?by(?:\s|[- ]?\d|$)|creative commons attribution(?![- ]share))/i
const RESTRICTED_COMMONS_LICENSE_RE = /(?:noncommercial|\bnc\b|no derivatives|\bnd\b|share[- ]?alike|\bsa\b|gfdl|gnu free documentation)/i
const COMMERCIAL_FRIENDLY_ARCHIVE_LICENSE_RE = /(?:publicdomain|public domain|\/publicdomain\/|\/licenses\/by\/|\/publicdomain\/zero\/|\bcc\s*0\b|creative commons zero|\bcc[- ]?by(?:\s|[- ]?\d|$)|creative commons attribution(?![- ]share))/i
const RESTRICTED_ARCHIVE_LICENSE_RE = /(?:by-nc|by-nd|by-sa|noncommercial|no derivatives|share[- ]?alike|\bnc\b|\bnd\b|\bsa\b)/i
const FREE_VIDEO_PROVIDERS = new Set(['Pexels', 'Wikimedia Commons', 'Internet Archive', 'Mixkit'])
const MIXKIT_LICENSE_URL = 'https://mixkit.co/license/'
const MIXKIT_MAX_ITEM_PAGES = 30
const MIXKIT_PAGE_CONCURRENCY = 4
const MIXKIT_CATALOG_PAGES = Object.freeze([
  'https://mixkit.co/free-stock-video/golf/',
  'https://mixkit.co/free-stock-video/golf-swing/',
])
const MIXKIT_GOLF_FREE_SEEDS = Object.freeze([
  {
    pageUrl: 'https://mixkit.co/free-stock-video/young-boy-golfing-2029/',
    category: 'amateur',
    query: 'curated funny amateur golfer misses the hole',
  },
  {
    pageUrl: 'https://mixkit.co/free-stock-video/young-girl-playing-golf-2030/',
    category: 'amateur',
    query: 'curated amateur golfer hits a golf ball toward the hole',
  },
  {
    pageUrl: 'https://mixkit.co/free-stock-video/boy-practising-golf-2038/',
    category: 'amateur',
    query: 'curated amateur golfer hits a golf ball',
  },
  {
    pageUrl: 'https://mixkit.co/free-stock-video/girl-hitting-a-golf-ball-2044/',
    category: 'amateur',
    query: 'curated amateur golfer hits a golf ball',
  },
  {
    pageUrl: 'https://mixkit.co/free-stock-video/senior-female-playing-golf-4273/',
    category: 'amateur',
    query: 'curated amateur golfer playing a golf shot',
  },
  {
    pageUrl: 'https://mixkit.co/free-stock-video/girl-practising-golf-2040/',
    category: 'amateur',
    query: 'curated amateur golfer playing a golf shot',
  },
  {
    pageUrl: 'https://mixkit.co/free-stock-video/a-man-teaching-his-son-how-to-play-golf-2035/',
    category: 'amateur',
    query: 'curated golfer hitting a golf ball',
  },
  {
    pageUrl: 'https://mixkit.co/free-stock-video/father-teaching-daughter-to-play-golf-2036/',
    category: 'amateur',
    query: 'curated golfer playing a golf shot',
  },
])
const WIKIMEDIA_VIDEO_FILE_RE = /\.(?:webm|ogv|ogg|mp4|m4v|mov)$/i
const WIKIMEDIA_CATEGORY_MAX_PAGES = 5
const WIKIMEDIA_SEARCH_MAX_PAGES = 3
const WIKIMEDIA_METADATA_BATCH_SIZE = 25
const WIKIMEDIA_GOLF_CATEGORIES = Object.freeze([
  {
    title: 'Category:Videos of golf',
    category: 'amateur',
    query: 'wikimedia golf category golfer great funny shot',
  },
  {
    title: 'Category:Swing (golf)',
    category: 'amateur',
    query: 'wikimedia golf swing category golfer great shot',
  },
  {
    title: 'Category:Videos of sports training',
    category: 'amateur',
    query: 'wikimedia short golf swing training video golfer great shot',
  },
  {
    title: "Category:2008 Women's British Open",
    category: 'professional',
    query: 'wikimedia professional golfer womens british open golf shot',
  },
  {
    title: 'Category:People playing golf',
    category: 'amateur',
    query: 'wikimedia people playing golf golfer shot',
  },
  {
    title: 'Category:Putting (golf)',
    category: 'amateur',
    query: 'wikimedia golfer putting golf shot',
  },
  {
    title: 'Category:Bunker shots (golf)',
    category: 'amateur',
    query: 'wikimedia golfer bunker golf shot',
  },
])

const WIKIMEDIA_FREE_SEEDS = Object.freeze([
  {
    title: 'File:Diego Garcia Long Drive Challenge (957829).webm',
    category: 'amateur',
    query: 'curated amateur golfer long drive challenge great shot',
    verifiedGolfShot: true,
  },
  {
    title: 'File:Reinvestment---the-Cause-of-the-Yips-pone.0082470.s001.ogv',
    category: 'amateur',
    query: 'curated amateur golfer funny putting yips shot',
    verifiedGolfShot: true,
  },
  {
    title: 'File:Reinvestment---the-Cause-of-the-Yips-pone.0082470.s002.ogv',
    category: 'amateur',
    query: 'curated amateur golfer funny putting yips shot',
    verifiedGolfShot: true,
  },
  {
    title: 'File:History Awaits Dustin Johnson at The U.S. Open.webm',
    category: 'professional',
    query: 'curated professional golfer great golf swing',
    verifiedGolfShot: true,
  },
  {
    title: 'File:History Awaits Rickie Fowler at The U.S. Open.webm',
    category: 'professional',
    query: 'curated professional golfer great golf swing',
    verifiedGolfShot: true,
  },
  {
    title: 'File:Stacy Prammanasudh practicing on the DR during 2008 WBO.ogv',
    category: 'professional',
    query: 'curated professional golfer golf drive swing',
    verifiedGolfShot: true,
  },
  {
    title: 'File:Golf swing practice - Kanagawa - slow motion - 2023 June 13.webm',
    category: 'amateur',
    query: 'curated amateur golfer great golf swing',
    verifiedGolfShot: true,
  },
  {
    title: 'File:Manpracticinggolfswing-slowmotion-2021-3-24.webm',
    category: 'amateur',
    query: 'curated amateur golfer great golf swing',
    verifiedGolfShot: true,
  },
])

const PEXELS_GREAT_SHOT_QUERIES = Object.freeze([
  { query: 'professional golfer tee shot', category: 'professional' },
  { query: 'professional golf swing', category: 'professional' },
  { query: 'golf tournament drive', category: 'professional' },
  { query: 'golfer competition shot', category: 'professional' },
  { query: 'amazing golf shot', category: 'amateur' },
  { query: 'golf trick shot', category: 'amateur' },
  { query: 'amazing golf putt', category: 'amateur' },
  { query: 'golfer celebration after shot', category: 'amateur' },
])

const GREAT_SHOT_QUERIES = Object.freeze([
  { query: 'professional golfer tee shot', category: 'professional' },
  { query: 'professional golfer approach shot', category: 'professional' },
  { query: 'professional golfer chip shot', category: 'professional' },
  { query: 'professional golfer long putt', category: 'professional' },
  { query: 'PGA golfer great shot', category: 'professional' },
  { query: 'LPGA golfer great shot', category: 'professional' },
  { query: 'amateur golfer hole in one', category: 'amateur' },
  { query: 'amateur golfer great shot', category: 'amateur' },
  { query: 'golfer trick shot', category: 'amateur' },
  { query: 'funny golf shot golfer', category: 'amateur' },
  { query: 'golfer chip in', category: 'amateur' },
  { query: 'golfer long putt', category: 'amateur' },
  { query: 'golf long drive challenge', category: 'amateur' },
  { query: 'golf putting yips', category: 'amateur' },
  { query: 'golf swing slow motion', category: 'amateur' },
  { query: 'golf tournament tee shot', category: 'professional' },
  { query: 'golf DVIDS long drive', category: 'amateur' },
  { query: 'incategory:"Videos of sports training" golf swing', category: 'amateur' },
  { query: 'incategory:"2008 Women\'s British Open" golfer swing', category: 'professional' },
])

const INTERNET_ARCHIVE_QUERIES = Object.freeze([
  { query: '(golf AND golfer AND (shot OR drive OR putt OR chip OR swing) AND (professional OR tournament OR championship OR PGA OR LPGA))', category: 'professional' },
  { query: '(golf AND golfer AND (great-shot OR hole-in-one OR long-putt OR chip-in))', category: 'professional' },
  { query: '(golf AND golfer AND (hole-in-one OR trick-shot OR funny OR lucky OR long-putt OR chip-in))', category: 'amateur' },
  { query: '(golf AND golfer AND (shot OR drive OR putt OR chip) AND (amateur OR weekend))', category: 'amateur' },
])

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

function fetchTimeoutMs() {
  return boundedInteger(process.env.GREAT_SHOTS_FETCH_TIMEOUT_MS, DEFAULT_FETCH_TIMEOUT_MS, 1000, 60000)
}

function videoTimeoutMs() {
  return boundedInteger(process.env.GREAT_SHOTS_VIDEO_TIMEOUT_MS, DEFAULT_VIDEO_TIMEOUT_MS, 1000, 120000)
}

function maxVideoBytes() {
  return boundedInteger(process.env.GREAT_SHOTS_MAX_VIDEO_BYTES, DEFAULT_MAX_VIDEO_BYTES, 1_000_000, 150_000_000)
}

function abortError(message = 'Great-shots commercial job was cancelled') {
  const error = new Error(message)
  error.code = 'SCHEDULED_JOB_CANCELLED'
  return error
}

function throwIfCancelled(signal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) {
    if (!reason.code) reason.code = 'SCHEDULED_JOB_CANCELLED'
    throw reason
  }
  throw abortError()
}

function sourceAbortSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return /^https?:$/.test(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function normalizeCategory(value) {
  return String(value || '').toLowerCase() === 'professional' ? 'professional' : 'amateur'
}

function normalizeLicense(value) {
  return stripHtml(value).replace(/\s+/g, ' ').trim()
}

function isCommercialFriendlyCommonsLicense(value) {
  const license = normalizeLicense(value)
  if (!license || RESTRICTED_COMMONS_LICENSE_RE.test(license)) return false
  return COMMERCIAL_FRIENDLY_COMMONS_LICENSE_RE.test(license)
}

function extMetadataValues(metadata, key) {
  const raw = metadata?.[key]?.value ?? metadata?.[key]
  if (Array.isArray(raw)) return raw.map(normalizeLicense).filter(Boolean)
  const normalized = normalizeLicense(raw)
  return normalized ? [normalized] : []
}

function friendlyCommonsLicenseFromUrl(value) {
  const url = safeUrl(value)
  if (!url) return null
  const normalized = url.toLowerCase()
  if (/\/licenses\/by-(?:nc|nd|sa)(?:\/|$)/i.test(normalized)) return null
  const by = normalized.match(/\/licenses\/by\/(\d(?:\.\d)?)\/?/i)
  if (by) return { license: `CC BY ${by[1]}`, licenseUrl: url }
  if (/\/publicdomain\/zero\//i.test(normalized)) return { license: 'CC0', licenseUrl: url }
  if (/\/publicdomain\/(?:mark|certification)\//i.test(normalized)) return { license: 'Public Domain', licenseUrl: url }
  return null
}

function friendlyCommonsLicenseFromCategory(value) {
  const category = normalizeLicense(value).replace(/^category:/i, '')
  const by = category.match(/^CC[-_ ]BY[-_ ](\d(?:\.\d)?)(?:$|[^A-Z])/i)
  if (by && !/BY[-_ ](?:SA|NC|ND)/i.test(category)) {
    return {
      license: `CC BY ${by[1]}`,
      licenseUrl: `https://creativecommons.org/licenses/by/${by[1]}/`,
    }
  }
  if (/^CC[-_ ]?0(?:$|[-_ ])/i.test(category)) {
    return { license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' }
  }
  return null
}

function resolveCommercialFriendlyCommonsLicense(metadata = {}, pageCategories = []) {
  // Commons files can be dual-licensed. LicenseShortName may report GFDL even when
  // the same file also offers a CC BY license. Prefer any explicit commercially
  // reusable license alternative instead of rejecting the entire file because one
  // alternative is restrictive for this job.
  for (const value of extMetadataValues(metadata, 'LicenseUrl')) {
    const friendly = friendlyCommonsLicenseFromUrl(value)
    if (friendly) return friendly
  }
  for (const key of ['LicenseShortName', 'UsageTerms', 'License']) {
    for (const value of extMetadataValues(metadata, key)) {
      if (isCommercialFriendlyCommonsLicense(value)) {
        return { license: value, licenseUrl: null }
      }
    }
  }
  for (const category of pageCategories) {
    const friendly = friendlyCommonsLicenseFromCategory(category)
    if (friendly) return friendly
  }
  return null
}

function metadataNumber(entries, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()))
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!wanted.has(String(entry?.name || '').toLowerCase())) continue
      const value = Number.parseFloat(String(entry?.value ?? ''))
      if (Number.isFinite(value) && value > 0) return value
    }
    return null
  }
  if (entries && typeof entries === 'object') {
    for (const [name, raw] of Object.entries(entries)) {
      if (!wanted.has(String(name).toLowerCase())) continue
      const value = Number.parseFloat(String(raw?.value ?? raw ?? ''))
      if (Number.isFinite(value) && value > 0) return value
    }
  }
  return null
}

function wikimediaDurationSeconds(info) {
  const direct = Number(info?.duration || 0)
  if (Number.isFinite(direct) && direct > 0) return direct
  return metadataNumber(info?.commonmetadata, ['duration', 'length', 'playtime_seconds'])
    ?? metadataNumber(info?.metadata, ['duration', 'length', 'playtime_seconds'])
    ?? null
}

function providerKey(provider, id, fallbackUrl = '') {
  const normalizedProvider = String(provider || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const stableId = String(id || fallbackUrl || '').trim().toLowerCase()
  return `${normalizedProvider}:${stableId}`
}

function choosePexelsVideoFile(video) {
  const files = Array.isArray(video?.video_files) ? video.video_files : []
  const targetArea = 1080 * 1920
  const candidates = files
    .filter((file) => safeUrl(file?.link) && /^video\/mp4/i.test(String(file?.file_type || 'video/mp4')))
    .map((file) => {
      const width = Number(file?.width || 0)
      const height = Number(file?.height || 0)
      const minDimension = Math.min(width, height)
      const maxDimension = Math.max(width, height)
      const area = width > 0 && height > 0 ? width * height : 0
      return {
        ...file,
        portraitBonus: height >= width && height > 0 ? 1 : 0,
        practicalHdBonus: minDimension >= 720 && maxDimension <= 1920 ? 2 : maxDimension <= 1920 ? 1 : 0,
        oversizePenalty: maxDimension > 1920 ? 1 : 0,
        targetDistance: area > 0 ? Math.abs(area - targetArea) : Number.MAX_SAFE_INTEGER,
      }
    })
    .sort((a, b) => b.portraitBonus - a.portraitBonus
      || b.practicalHdBonus - a.practicalHdBonus
      || a.oversizePenalty - b.oversizePenalty
      || a.targetDistance - b.targetDistance)
  return candidates[0] || null
}

function pexelsPageDescription(pageUrl) {
  try {
    const pathname = new URL(pageUrl).pathname.replace(/\/$/, '')
    const slug = pathname.split('/').filter(Boolean).at(-1) || ''
    return stripHtml(decodeURIComponent(slug).replace(/-?\d+$/, '').replace(/-/g, ' '))
  } catch {
    return ''
  }
}

export function parsePexelsVideoResults(payload, category, query = '') {
  const videos = Array.isArray(payload?.videos) ? payload.videos : []
  return videos.slice(0, MAX_CANDIDATES_PER_PROVIDER).map((video) => {
    const file = choosePexelsVideoFile(video)
    if (!file) return null
    const downloadUrl = safeUrl(file.link)
    const pageUrl = safeUrl(video?.url)
    if (!downloadUrl || !pageUrl) return null
    const id = String(video?.id || downloadUrl)
    const creator = stripHtml(video?.user?.name || 'Pexels creator')
    const pageDescription = pexelsPageDescription(pageUrl)
    return {
      key: providerKey('Pexels', id, pageUrl),
      provider: 'Pexels',
      id,
      category: normalizeCategory(category),
      categories: [normalizeCategory(category)],
      query,
      title: pageDescription || `Golf shot by ${creator}`,
      description: pageDescription || `Golf video by ${creator}`,
      author: creator,
      authorUrl: safeUrl(video?.user?.url),
      license: 'Pexels License',
      licenseUrl: 'https://www.pexels.com/license/',
      sourcePageUrl: pageUrl,
      downloadUrl,
      durationSeconds: Number(video?.duration || 0) || null,
      width: Number(file?.width || 0) || null,
      height: Number(file?.height || 0) || null,
      bytes: Number(file?.size || 0) || null,
    }
  }).filter(Boolean)
}

async function fetchPexelsCandidates({ fetchImpl, signal, correlationId = null, logApi = () => {}, logScheduledJob = () => {}, logError = () => {} }) {
  const apiKey = pexelsApiKey()
  if (!apiKey) {
    const details = {
      correlationId,
      jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
      provider: 'Pexels',
      reason: 'PEXELS_API_KEY is not configured',
      level: 'warn',
    }
    logApi('great_shots_source_skipped', details)
    logScheduledJob('great_shots_source_skipped', details)
    return []
  }

  const output = []
  for (const spec of PEXELS_GREAT_SHOT_QUERIES) {
    try {
      throwIfCancelled(signal)
      const url = new URL(PEXELS_VIDEO_SEARCH_URL)
      url.searchParams.set('query', spec.query)
      url.searchParams.set('per_page', String(PEXELS_RESULTS_PER_QUERY))
      url.searchParams.set('page', '1')
      const { payload } = await fetchPexelsJson(url.href, {
        fetchImpl,
        signal,
        timeoutMs: fetchTimeoutMs(),
        apiKey,
        jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
        correlationId,
        logApi,
        logScheduledJob,
      })
      output.push(...parsePexelsVideoResults(payload, spec.category, spec.query))
    } catch (error) {
      if (signal?.aborted) throw error
      logRecoverableDiscoveryFailure('Pexels video search', spec.query, error, { correlationId, logApi, logScheduledJob, logError })
      if ([401, 403].includes(Number(error?.statusCode || 0))) {
        const details = {
          correlationId,
          jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
          provider: 'Pexels',
          reason: `Pexels API authorization failed with HTTP ${error.statusCode}; verify PEXELS_API_KEY`,
          level: 'warn',
        }
        logApi('great_shots_source_skipped', details)
        logScheduledJob('great_shots_source_skipped', details)
        break
      }
      if (Number(error?.statusCode || 0) === 429) break
    }
  }
  return output
}

function choosePixabayVideoFile(hit) {
  const variants = ['medium', 'small', 'large', 'tiny']
    .map((name) => ({ name, ...(hit?.videos?.[name] || {}) }))
    .filter((file) => safeUrl(file?.url))
    .map((file) => ({
      ...file,
      portraitBonus: Number(file?.height || 0) >= Number(file?.width || 0) ? 1 : 0,
      dimensionScore: Math.min(Number(file?.width || 0), 1920) * Math.min(Number(file?.height || 0), 1920),
    }))
    .sort((a, b) => b.portraitBonus - a.portraitBonus || b.dimensionScore - a.dimensionScore)
  return variants[0] || null
}

export function parsePixabayVideoResults(payload, category, query = '') {
  const hits = Array.isArray(payload?.hits) ? payload.hits : []
  return hits.slice(0, MAX_CANDIDATES_PER_PROVIDER).map((hit) => {
    const file = choosePixabayVideoFile(hit)
    if (!file) return null
    const downloadUrl = safeUrl(file.url)
    const pageUrl = safeUrl(hit?.pageURL)
    if (!downloadUrl || !pageUrl) return null
    const id = String(hit?.id || downloadUrl)
    return {
      key: providerKey('Pixabay', id, pageUrl),
      provider: 'Pixabay',
      id,
      category: normalizeCategory(category),
      categories: [normalizeCategory(category)],
      query,
      title: stripHtml(hit?.tags || 'Golf shot'),
      description: stripHtml(hit?.tags || query),
      author: stripHtml(hit?.user || 'Pixabay creator'),
      license: 'Pixabay Content License',
      sourcePageUrl: pageUrl,
      downloadUrl,
      durationSeconds: Number(hit?.duration || 0) || null,
      width: Number(file?.width || 0) || null,
      height: Number(file?.height || 0) || null,
      bytes: Number(file?.size || 0) || null,
    }
  }).filter(Boolean)
}

export function parseWikimediaVideoResults(payload, category, query = '', hints = {}) {
  const pages = payload?.query?.pages && typeof payload.query.pages === 'object'
    ? Object.values(payload.query.pages)
    : []
  return pages.slice(0, MAX_CANDIDATES_PER_PROVIDER).map((page) => {
    // TimedMediaHandler's videoinfo includes duration; retain imageinfo compatibility for tests/older API responses.
    const info = Array.isArray(page?.videoinfo) ? page.videoinfo[0] : (Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null)
    if (!info || !/^video\//i.test(String(info?.mime || ''))) return null
    const metadata = info.extmetadata || {}
    const pageCategories = Array.isArray(page?.categories)
      ? page.categories.map((entry) => stripHtml(entry?.title || '')).filter(Boolean)
      : []
    const friendlyLicense = resolveCommercialFriendlyCommonsLicense(metadata, pageCategories)
    if (!friendlyLicense) return null
    const downloadUrl = safeUrl(info?.url)
    const pageUrl = safeUrl(info?.descriptionurl)
    if (!downloadUrl || !pageUrl) return null
    if (Number(info?.size || 0) > maxVideoBytes()) return null
    const id = String(page?.pageid || page?.title || downloadUrl)
    const description = stripHtml(metadata?.ImageDescription?.value || metadata?.ObjectName?.value || page?.title || '')
    return {
      key: providerKey('Wikimedia Commons', id, pageUrl),
      provider: 'Wikimedia Commons',
      id,
      category: normalizeCategory(category),
      categories: [normalizeCategory(category)],
      query,
      title: stripHtml(metadata?.ObjectName?.value || page?.title || description || 'Golf shot'),
      description,
      pageCategories,
      author: stripHtml(metadata?.Artist?.value || metadata?.Credit?.value || 'Wikimedia contributor'),
      license: friendlyLicense.license,
      licenseUrl: friendlyLicense.licenseUrl || safeUrl(metadata?.LicenseUrl?.value),
      sourcePageUrl: pageUrl,
      downloadUrl,
      durationSeconds: wikimediaDurationSeconds(info),
      width: Number(info?.width || 0) || null,
      height: Number(info?.height || 0) || null,
      bytes: Number(info?.size || 0) || null,
      verifiedGolfShot: Boolean(hints?.verifiedGolfShot),
      curatedSource: Boolean(hints?.curatedSource),
      categoryDiscovered: Boolean(hints?.categoryDiscovered),
    }
  }).filter(Boolean)
}

function archiveLicenseText(value) {
  const text = normalizeLicense(value)
  if (!text) return ''
  if (/publicdomain|public domain|\/publicdomain\//i.test(text)) return 'Public Domain'
  if (/\/publicdomain\/zero\/|\bcc\s*0\b|creative commons zero/i.test(text)) return 'CC0'
  const byMatch = text.match(/\/licenses\/by\/(\d(?:\.\d)?)\/?/i)
  return byMatch ? `CC BY ${byMatch[1]}` : text
}

function isCommercialFriendlyArchiveLicense(value) {
  const license = normalizeLicense(value)
  if (!license || RESTRICTED_ARCHIVE_LICENSE_RE.test(license)) return false
  return COMMERCIAL_FRIENDLY_ARCHIVE_LICENSE_RE.test(license)
}

function chooseInternetArchiveVideoFile(files = []) {
  return files
    .filter((file) => {
      const name = String(file?.name || '')
      const format = String(file?.format || '')
      const size = Number(file?.size || 0)
      if (!name || !/\.(?:mp4|webm|ogv|m4v)$/i.test(name)) return false
      if (!/(?:mpeg4|h\.264|webm|ogg video|matroska|video)/i.test(format) && !/\.(?:mp4|webm|ogv|m4v)$/i.test(name)) return false
      return !size || size <= maxVideoBytes()
    })
    .map((file) => ({
      ...file,
      sizeNumber: Number(file?.size || 0) || null,
      preferredFormat: /\.mp4$/i.test(String(file?.name || '')) ? 2 : 1,
    }))
    .sort((a, b) => b.preferredFormat - a.preferredFormat || (a.sizeNumber || Number.MAX_SAFE_INTEGER) - (b.sizeNumber || Number.MAX_SAFE_INTEGER))[0] || null
}

export function parseInternetArchiveMetadataCandidate(payload, category, query = '') {
  const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}
  const identifier = stripHtml(metadata.identifier || payload?.identifier)
  if (!identifier) return null
  const rawLicenseValue = metadata.licenseurl || metadata.license || metadata.rights || ''
  const licenseValue = Array.isArray(rawLicenseValue) ? rawLicenseValue[0] : rawLicenseValue
  if (!isCommercialFriendlyArchiveLicense(licenseValue)) return null
  const file = chooseInternetArchiveVideoFile(Array.isArray(payload?.files) ? payload.files : [])
  if (!file) return null
  const encodedIdentifier = encodeURIComponent(identifier)
  const encodedName = String(file.name).split('/').map((part) => encodeURIComponent(part)).join('/')
  const downloadUrl = safeUrl(`https://archive.org/download/${encodedIdentifier}/${encodedName}`)
  const sourcePageUrl = safeUrl(`https://archive.org/details/${encodedIdentifier}`)
  if (!downloadUrl || !sourcePageUrl) return null
  const creator = Array.isArray(metadata.creator) ? metadata.creator.join(', ') : metadata.creator
  return {
    key: providerKey('Internet Archive', identifier, sourcePageUrl),
    provider: 'Internet Archive',
    id: identifier,
    category: normalizeCategory(category),
    categories: [normalizeCategory(category)],
    query,
    title: stripHtml(metadata.title || identifier),
    description: stripHtml([metadata.description, metadata.subject].flat().filter(Boolean).join(' ')),
    author: stripHtml(creator || metadata.uploader || 'Internet Archive contributor'),
    license: archiveLicenseText(licenseValue),
    licenseUrl: safeUrl(licenseValue),
    sourcePageUrl,
    downloadUrl,
    durationSeconds: Number.parseFloat(String(file.length || '')) || null,
    width: Number(file.width || 0) || null,
    height: Number(file.height || 0) || null,
    bytes: Number(file.size || 0) || null,
  }
}

export function parseInternetArchiveSearchResults(payload) {
  const docs = Array.isArray(payload?.response?.docs) ? payload.response.docs : []
  return docs.slice(0, MAX_CANDIDATES_PER_PROVIDER).map((doc) => ({
    identifier: stripHtml(doc?.identifier),
    licenseValue: Array.isArray(doc?.licenseurl) ? doc.licenseurl[0] : doc?.licenseurl,
  })).filter((doc) => {
    if (!doc.identifier) return false
    const license = normalizeLicense(doc.licenseValue)
    // Archive search documents frequently omit licenseurl even when the item's
    // metadata declares Public Domain or CC BY. Keep unknowns for the metadata
    // request, but reject an explicitly noncommercial/restricted search hit early.
    return !license || !RESTRICTED_ARCHIVE_LICENSE_RE.test(license)
  })
}

async function fetchJson(url, { fetchImpl, signal, timeoutMs, headers = {} }) {
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'follow',
    signal: sourceAbortSignal(signal, timeoutMs),
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'GolfHomiez/1.0 (+https://golfhomiez.com)',
      ...headers,
    },
  })
  if (!response?.ok) {
    const error = new Error(`HTTP ${response?.status || 'unknown'} from ${new URL(url).hostname}`)
    error.statusCode = response?.status || null
    throw error
  }
  return response.json()
}

async function fetchText(url, { fetchImpl, signal, timeoutMs, headers = {} }) {
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'follow',
    signal: sourceAbortSignal(signal, timeoutMs),
    headers: {
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      ...headers,
    },
  })
  if (!response?.ok) {
    const error = new Error(`HTTP ${response?.status || 'unknown'} from ${new URL(url).hostname}`)
    error.statusCode = response?.status || null
    throw error
  }
  return response.text()
}

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
}

export function parseMixkitCatalogLinks(html, baseUrl = 'https://mixkit.co/free-stock-video/golf/') {
  const source = decodeHtmlAttribute(html)
  const links = new Set()
  const re = /(?:href=["']?)?(\/free-stock-video\/[a-z0-9][a-z0-9-]*-\d+\/)/gi
  let match
  while ((match = re.exec(source)) !== null) {
    try {
      links.add(new URL(match[1], baseUrl).href)
    } catch {
      // Ignore malformed catalog links.
    }
  }
  return [...links]
}

function mixkitPageIdentity(pageUrl) {
  try {
    const parsed = new URL(pageUrl)
    if (parsed.hostname !== 'mixkit.co') return null
    const match = parsed.pathname.match(/^\/free-stock-video\/([a-z0-9][a-z0-9-]*?)-(\d+)\/?$/i)
    if (!match) return null
    return { slug: match[1].toLowerCase(), id: match[2], pageUrl: parsed.href }
  } catch {
    return null
  }
}

function mixkitDurationSeconds(text) {
  const normalized = stripHtml(text)
  const match = normalized.match(/\bDuration\s+(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/i)
    || normalized.match(/\bDuration\s+(\d{1,2}):(\d{2})\b/i)
  if (!match) return null
  if (match.length >= 4 && match[3] !== undefined) {
    return (Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0)
  }
  return (Number(match[1] || 0) * 60) + Number(match[2] || 0)
}

function mixkitPageTitle(html) {
  const h1 = String(html || '').match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1) return stripHtml(h1[1])
  const title = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return title ? stripHtml(title[1]).replace(/\s*-\s*Free Stock Video.*$/i, '').trim() : ''
}

function mixkitPageDescription(html) {
  const source = String(html || '')
  const meta = source.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    || source.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/i)
  if (meta) return stripHtml(meta[1])

  const text = stripHtml(source)
  const title = mixkitPageTitle(source)
  const titleIndex = title ? text.toLowerCase().indexOf(title.toLowerCase()) : -1
  const afterTitle = titleIndex >= 0 ? text.slice(titleIndex + title.length).trim() : text
  const boundary = afterTitle.search(/\b(?:Item Tags|Free Download|Attributes|Duration)\b/i)
  return (boundary >= 0 ? afterTitle.slice(0, boundary) : afterTitle.slice(0, 500)).trim()
}

function mixkitDirectVideoUrls(html) {
  const source = decodeHtmlAttribute(html)
  const found = new Set()
  // Only use download URLs actually published by the item page. Constructed
  // preview URLs currently return HTTP 403 from Mixkit's asset CDN and should
  // not be treated as usable server-side media.
  const assetRe = /https:\/\/(?:assets\.)?mixkit\.co\/[^"'<>\s]+\.mp4(?:\?[^"'<>\s]*)?/gi
  for (const match of source.matchAll(assetRe)) found.add(match[0])
  return [...found]
}

export function parseMixkitVideoPage(html, pageUrl, hints = {}) {
  const identity = mixkitPageIdentity(pageUrl)
  if (!identity) return null
  const raw = String(html || '')
  const text = stripHtml(raw)
  const freeLicense = /Mixkit Stock Video Free License/i.test(text)
  const restrictedLicense = /Mixkit Restricted License|personal use only/i.test(text)
  if (!freeLicense || restrictedLicense) return null

  const durationSeconds = mixkitDurationSeconds(raw)
  if (!Number.isFinite(durationSeconds)
    || durationSeconds < GREAT_SHOTS_MIN_SOURCE_DURATION_SECONDS
    || durationSeconds > GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS) return null

  const title = mixkitPageTitle(raw) || String(hints.title || identity.slug.replace(/-/g, ' '))
  const description = mixkitPageDescription(raw) || String(hints.description || title)
  // Keep license/download boilerplate out of content classification; Mixkit's Free License page text legitimately contains words such as 'commercial'.
  const evidence = `${title} ${description} ${String(hints.query || '')}`
  if (GREAT_SHOT_REJECT_RE.test(evidence)
    || !GREAT_SHOT_GOLF_RE.test(evidence)
    || !GREAT_SHOT_ACTION_RE.test(evidence)
    || !GREAT_SHOT_PERSON_RE.test(evidence)) return null

  const downloadUrls = mixkitDirectVideoUrls(raw, identity)
  if (!downloadUrls.length) return null
  const category = normalizeCategory(hints.category || 'amateur')
  return {
    key: providerKey('Mixkit', identity.id, identity.pageUrl),
    provider: 'Mixkit',
    id: identity.id,
    category,
    categories: [category],
    query: String(hints.query || 'Mixkit free golf full shot'),
    title,
    description,
    pageCategories: ['Golf', 'Full Shot'],
    author: 'Mixkit contributor',
    license: 'Mixkit Stock Video Free License',
    licenseUrl: MIXKIT_LICENSE_URL,
    sourcePageUrl: identity.pageUrl,
    downloadUrl: downloadUrls[0],
    downloadUrls,
    durationSeconds,
    width: null,
    height: null,
    bytes: null,
    verifiedGolfShot: true,
    curatedSource: Boolean(hints.curatedSource),
  }
}

async function mapWithConcurrency(values, concurrency, worker) {
  const output = new Array(values.length)
  let next = 0
  async function run() {
    while (true) {
      const index = next
      next += 1
      if (index >= values.length) return
      output[index] = await worker(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), values.length || 1) }, () => run()))
  return output
}


function logRecoverableDiscoveryFailure(source, search, error, { correlationId = null, logApi = () => {}, logScheduledJob = () => {}, logError = () => {} } = {}) {
  const details = {
    correlationId,
    jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
    source,
    search,
    error: error?.message || String(error),
    level: 'warn',
  }
  logApi('great_shots_discovery_request_failed', details)
  logScheduledJob('great_shots_discovery_request_failed', details)
  logError('Great-shots discovery request failed', { ...details, recoverable: true, error })
}

export function parseWikimediaCategoryMemberTitles(payload) {
  const members = Array.isArray(payload?.query?.categorymembers) ? payload.query.categorymembers : []
  return members
    .map((member) => stripHtml(member?.title || ''))
    .filter((title) => /^File:/i.test(title) && WIKIMEDIA_VIDEO_FILE_RE.test(title))
}

function inferWikimediaCategories(candidate, fallbackCategory) {
  const evidence = candidateEvidenceText(candidate)
  const categories = new Set([normalizeCategory(fallbackCategory)])
  if (/\b(?:professional|pga|lpga|tour|championship|tournament|u\.s\. open|british open)\b/i.test(evidence)) {
    categories.add('professional')
  }
  return [...categories]
}

async function fetchWikimediaMetadataForTitles(titles, { fetchImpl, signal, category, query }) {
  const output = []
  for (let index = 0; index < titles.length; index += WIKIMEDIA_METADATA_BATCH_SIZE) {
    throwIfCancelled(signal)
    const batch = titles.slice(index, index + WIKIMEDIA_METADATA_BATCH_SIZE)
    if (!batch.length) continue
    const url = new URL('https://commons.wikimedia.org/w/api.php')
    url.searchParams.set('action', 'query')
    url.searchParams.set('titles', batch.join('|'))
    url.searchParams.set('prop', 'videoinfo|categories')
    url.searchParams.set('viprop', 'url|mime|size|commonmetadata|metadata|extmetadata')
    url.searchParams.set('viextmetadatafilter', 'LicenseShortName|LicenseUrl|UsageTerms|License|Artist|Credit|ImageDescription|ObjectName')
    url.searchParams.set('cllimit', 'max')
    url.searchParams.set('format', 'json')
    url.searchParams.set('formatversion', '2')
    url.searchParams.set('origin', '*')
    const payload = await fetchJson(url.href, { fetchImpl, signal, timeoutMs: fetchTimeoutMs() })
    const parsed = parseWikimediaVideoResults(payload, category, query, { categoryDiscovered: true })
    output.push(...parsed.map((candidate) => ({
      ...candidate,
      categories: inferWikimediaCategories(candidate, category),
    })))
  }
  return output
}

async function fetchWikimediaCategoryCandidates({ fetchImpl, signal, logApi = () => {}, logScheduledJob = () => {}, logError = () => {}, correlationId = null }) {
  const output = []
  for (const spec of WIKIMEDIA_GOLF_CATEGORIES) {
    try {
      let continuation = null
      const titles = []
      for (let pageNumber = 0; pageNumber < WIKIMEDIA_CATEGORY_MAX_PAGES; pageNumber += 1) {
        throwIfCancelled(signal)
        const url = new URL('https://commons.wikimedia.org/w/api.php')
        url.searchParams.set('action', 'query')
        url.searchParams.set('list', 'categorymembers')
        url.searchParams.set('cmtitle', spec.title)
        url.searchParams.set('cmnamespace', '6')
        url.searchParams.set('cmtype', 'file')
        url.searchParams.set('cmlimit', 'max')
        if (continuation) url.searchParams.set('cmcontinue', continuation)
        url.searchParams.set('format', 'json')
        url.searchParams.set('formatversion', '2')
        url.searchParams.set('origin', '*')
        const payload = await fetchJson(url.href, { fetchImpl, signal, timeoutMs: fetchTimeoutMs() })
        titles.push(...parseWikimediaCategoryMemberTitles(payload))
        continuation = payload?.continue?.cmcontinue || null
        if (!continuation) break
      }
      const uniqueTitles = [...new Set(titles)].slice(0, MAX_CANDIDATES_PER_PROVIDER * 2)
      const categoryCandidates = await fetchWikimediaMetadataForTitles(uniqueTitles, {
        fetchImpl,
        signal,
        category: spec.category,
        query: spec.query,
      })
      output.push(...categoryCandidates)
      const details = {
        correlationId,
        jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
        category: spec.title,
        categoryVideoTitleCount: uniqueTitles.length,
        licensedVideoCandidateCount: categoryCandidates.length,
      }
      logApi('great_shots_wikimedia_category_discovered', details)
      logScheduledJob('great_shots_wikimedia_category_discovered', details)
    } catch (error) {
      if (signal?.aborted) throw error
      logRecoverableDiscoveryFailure('Wikimedia Commons category', spec.title, error, { correlationId, logApi, logScheduledJob, logError })
    }
  }
  return output
}

async function fetchWikimediaCandidates({ fetchImpl, signal, correlationId = null, logApi = () => {}, logScheduledJob = () => {}, logError = () => {} }) {
  const output = []
  for (const spec of GREAT_SHOT_QUERIES) {
    let continuation = null
    for (let pageNumber = 0; pageNumber < WIKIMEDIA_SEARCH_MAX_PAGES; pageNumber += 1) {
      try {
        throwIfCancelled(signal)
        const url = new URL('https://commons.wikimedia.org/w/api.php')
        url.searchParams.set('action', 'query')
        url.searchParams.set('generator', 'search')
        url.searchParams.set('gsrsearch', `${spec.query} filetype:video`)
        url.searchParams.set('gsrnamespace', '6')
        url.searchParams.set('gsrlimit', '50')
        url.searchParams.set('prop', 'videoinfo|categories')
        url.searchParams.set('viprop', 'url|mime|size|commonmetadata|metadata|extmetadata')
        url.searchParams.set('viextmetadatafilter', 'LicenseShortName|LicenseUrl|UsageTerms|License|Artist|Credit|ImageDescription|ObjectName')
        url.searchParams.set('cllimit', 'max')
        if (continuation) {
          for (const [key, value] of Object.entries(continuation)) {
            if (value !== null && value !== undefined) url.searchParams.set(key, String(value))
          }
        }
        url.searchParams.set('format', 'json')
        url.searchParams.set('formatversion', '2')
        url.searchParams.set('origin', '*')
        const payload = await fetchJson(url.href, { fetchImpl, signal, timeoutMs: fetchTimeoutMs() })
        output.push(...parseWikimediaVideoResults(payload, spec.category, spec.query))
        continuation = payload?.continue && typeof payload.continue === 'object' ? payload.continue : null
        if (!continuation) break
      } catch (error) {
        if (signal?.aborted) throw error
        logRecoverableDiscoveryFailure('Wikimedia Commons search', `${spec.query} page ${pageNumber + 1}`, error, { correlationId, logApi, logScheduledJob, logError })
        break
      }
    }
  }
  return output
}

async function fetchWikimediaSeedCandidates({ fetchImpl, signal, correlationId = null, logApi = () => {}, logScheduledJob = () => {}, logError = () => {} }) {
  const output = []
  for (const seed of WIKIMEDIA_FREE_SEEDS) {
    try {
      throwIfCancelled(signal)
      const url = new URL('https://commons.wikimedia.org/w/api.php')
      url.searchParams.set('action', 'query')
      url.searchParams.set('titles', seed.title)
      url.searchParams.set('prop', 'videoinfo|categories')
      url.searchParams.set('viprop', 'url|mime|size|commonmetadata|metadata|extmetadata')
      url.searchParams.set('viextmetadatafilter', 'LicenseShortName|LicenseUrl|UsageTerms|License|Artist|Credit|ImageDescription|ObjectName')
      url.searchParams.set('cllimit', 'max')
      url.searchParams.set('format', 'json')
      url.searchParams.set('formatversion', '2')
      url.searchParams.set('origin', '*')
      const payload = await fetchJson(url.href, { fetchImpl, signal, timeoutMs: fetchTimeoutMs() })
      output.push(...parseWikimediaVideoResults(payload, seed.category, seed.query, { verifiedGolfShot: seed.verifiedGolfShot, curatedSource: true }))
    } catch (error) {
      if (signal?.aborted) throw error
      logRecoverableDiscoveryFailure('Wikimedia Commons curated seed', seed.title, error, { correlationId, logApi, logScheduledJob, logError })
    }
  }
  return output
}

async function fetchInternetArchiveCandidates({ fetchImpl, signal, correlationId = null, logApi = () => {}, logScheduledJob = () => {}, logError = () => {} }) {
  const output = []
  const seenIdentifiers = new Set()
  for (const spec of INTERNET_ARCHIVE_QUERIES) {
    let hits
    try {
      throwIfCancelled(signal)
      const searchUrl = new URL('https://archive.org/advancedsearch.php')
      searchUrl.searchParams.set('q', `${spec.query} AND mediatype:movies`)
      searchUrl.searchParams.append('fl[]', 'identifier')
      searchUrl.searchParams.append('fl[]', 'licenseurl')
      searchUrl.searchParams.set('rows', '50')
      searchUrl.searchParams.set('page', '1')
      searchUrl.searchParams.set('output', 'json')
      const searchPayload = await fetchJson(searchUrl.href, { fetchImpl, signal, timeoutMs: fetchTimeoutMs() })
      hits = parseInternetArchiveSearchResults(searchPayload)
    } catch (error) {
      if (signal?.aborted) throw error
      logRecoverableDiscoveryFailure('Internet Archive search', spec.query, error, { correlationId, logApi, logScheduledJob, logError })
      continue
    }
    for (const hit of hits) {
      if (seenIdentifiers.has(hit.identifier)) continue
      seenIdentifiers.add(hit.identifier)
      try {
        throwIfCancelled(signal)
        const metadataUrl = `https://archive.org/metadata/${encodeURIComponent(hit.identifier)}`
        const metadataPayload = await fetchJson(metadataUrl, { fetchImpl, signal, timeoutMs: fetchTimeoutMs() })
        const candidate = parseInternetArchiveMetadataCandidate(metadataPayload, spec.category, spec.query)
        if (candidate) output.push(candidate)
        if (output.length >= MAX_CANDIDATES_PER_PROVIDER) return output
      } catch (error) {
        if (signal?.aborted) throw error
        logRecoverableDiscoveryFailure('Internet Archive metadata', hit.identifier, error, { correlationId, logApi, logScheduledJob, logError })
      }
    }
  }
  return output
}

async function fetchMixkitCandidates({ fetchImpl, signal, correlationId = null, logApi = () => {}, logScheduledJob = () => {}, logError = () => {} }) {
  const seedByUrl = new Map(MIXKIT_GOLF_FREE_SEEDS.map((seed) => [seed.pageUrl, seed]))
  const pageUrls = new Set(MIXKIT_GOLF_FREE_SEEDS.map((seed) => seed.pageUrl))

  for (const catalogUrl of MIXKIT_CATALOG_PAGES) {
    try {
      throwIfCancelled(signal)
      const html = await fetchText(catalogUrl, {
        fetchImpl,
        signal,
        timeoutMs: fetchTimeoutMs(),
        headers: { Referer: 'https://mixkit.co/' },
      })
      for (const pageUrl of parseMixkitCatalogLinks(html, catalogUrl)) pageUrls.add(pageUrl)
    } catch (error) {
      if (signal?.aborted) throw error
      logRecoverableDiscoveryFailure('Mixkit golf catalog', catalogUrl, error, { correlationId, logApi, logScheduledJob, logError })
    }
  }

  const prioritized = [
    ...MIXKIT_GOLF_FREE_SEEDS.map((seed) => seed.pageUrl),
    ...[...pageUrls].filter((pageUrl) => !seedByUrl.has(pageUrl)),
  ].slice(0, MIXKIT_MAX_ITEM_PAGES)

  const parsed = await mapWithConcurrency(prioritized, MIXKIT_PAGE_CONCURRENCY, async (pageUrl) => {
    try {
      throwIfCancelled(signal)
      const html = await fetchText(pageUrl, {
        fetchImpl,
        signal,
        timeoutMs: fetchTimeoutMs(),
        headers: { Referer: 'https://mixkit.co/free-stock-video/golf/' },
      })
      const seed = seedByUrl.get(pageUrl)
      return parseMixkitVideoPage(html, pageUrl, seed ? { ...seed, curatedSource: true } : { category: 'amateur', query: 'Mixkit free golf full shot' })
    } catch (error) {
      if (signal?.aborted) throw error
      logRecoverableDiscoveryFailure('Mixkit free video page', pageUrl, error, { correlationId, logApi, logScheduledJob, logError })
      return null
    }
  })

  return parsed.filter(Boolean)
}


function dedupeCandidates(candidates) {
  const byKey = new Map()
  for (const candidate of candidates) {
    if (!candidate?.key || !candidate?.downloadUrl) continue
    if (!FREE_VIDEO_PROVIDERS.has(candidate.provider)) continue
    const categories = new Set([
      ...(Array.isArray(candidate.categories) ? candidate.categories : []),
      candidate.category,
    ].filter(Boolean).map(normalizeCategory))
    if (!byKey.has(candidate.key)) {
      byKey.set(candidate.key, { ...candidate, categories: [...categories] })
      continue
    }
    const existing = byKey.get(candidate.key)
    const mergedCategories = new Set([
      ...(Array.isArray(existing.categories) ? existing.categories : []),
      ...categories,
    ])
    byKey.set(candidate.key, { ...existing, categories: [...mergedCategories] })
  }
  return [...byKey.values()]
}

export async function fetchGreatShotCandidates({
  fetchImpl = globalThis.fetch,
  signal = null,
  correlationId = null,
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Internet fetch support is required for the great-shots job')
  const providers = [
    ['Pexels', fetchPexelsCandidates],
    ['Wikimedia Commons curated free set', fetchWikimediaSeedCandidates],
    ['Wikimedia Commons golf categories', fetchWikimediaCategoryCandidates],
    ['Wikimedia Commons search', fetchWikimediaCandidates],
    ['Mixkit free golf catalog', fetchMixkitCandidates],
    ['Internet Archive', fetchInternetArchiveCandidates],
  ]
  const settled = await Promise.all(providers.map(async ([provider, loader]) => {
    const startedAt = Date.now()
    const startDetails = { correlationId, jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID, provider }
    logApi('great_shots_source_fetch_started', startDetails)
    try {
      const candidates = await loader({ fetchImpl, signal, correlationId, logApi, logScheduledJob, logError })
      const details = {
        ...startDetails,
        candidateCount: candidates.length,
        professionalCount: candidates.filter((candidate) => candidate.category === 'professional').length,
        amateurCount: candidates.filter((candidate) => candidate.category === 'amateur').length,
        durationMs: Date.now() - startedAt,
      }
      logApi('great_shots_source_fetch_completed', details)
      logScheduledJob('great_shots_source_fetch_completed', details)
      return candidates
    } catch (error) {
      if (signal?.aborted) throw error
      const details = { ...startDetails, durationMs: Date.now() - startedAt, error: error?.message || String(error) }
      logApi('great_shots_source_fetch_failed', { ...details, level: 'warn' })
      logScheduledJob('great_shots_source_fetch_failed', { ...details, level: 'warn' })
      logError('Great-shots source fetch failed', { ...details, recoverable: true, error })
      return []
    }
  }))
  return dedupeCandidates(settled.flat())
}

export function parseUsedGreatShotKeys(rows = []) {
  const used = new Set()
  for (const row of rows) {
    if (!row?.output_json) continue
    try {
      const output = typeof row.output_json === 'string' ? JSON.parse(row.output_json) : row.output_json
      const videos = Array.isArray(output?.videos) ? output.videos : []
      for (const video of videos) if (video?.key) used.add(String(video.key))
    } catch {
      // Ignore malformed historic output instead of blocking future runs.
    }
  }
  return used
}

export async function loadPreviouslyUsedGreatShotKeys(pool) {
  if (!pool?.execute) return new Set()
  const [rows] = await pool.execute(
    `SELECT output_json
       FROM scheduled_job_runs
      WHERE job_id = ?
        AND status = 'success'
        AND output_json IS NOT NULL
      ORDER BY started_at DESC
      LIMIT ${MAX_HISTORY_RUNS}`,
    [GREAT_SHOTS_COMMERCIAL_JOB_ID],
  )
  return parseUsedGreatShotKeys(Array.isArray(rows) ? rows : [])
}

function knownDurationSeconds(candidate) {
  const duration = Number(candidate?.durationSeconds || 0)
  return Number.isFinite(duration) && duration > 0 ? duration : null
}

function candidateEvidenceText(candidate) {
  return stripHtml([
    candidate?.title,
    candidate?.description,
    ...(Array.isArray(candidate?.pageCategories) ? candidate.pageCategories : []),
  ].filter(Boolean).join(' '))
}

function candidateQueryText(candidate) {
  return stripHtml(candidate?.query || '')
}

export function isGreatShotVideoCandidate(candidate, category = candidate?.category) {
  if (!candidate?.key || !candidate?.downloadUrl || !FREE_VIDEO_PROVIDERS.has(candidate?.provider)) return false
  const evidence = candidateEvidenceText(candidate)
  const query = candidateQueryText(candidate)
  if (!evidence || GREAT_SHOT_REJECT_RE.test(evidence)) return false

  const combined = `${evidence} ${query}`
  const evidenceHasGolf = GREAT_SHOT_GOLF_RE.test(evidence)
  const evidenceHasAction = GREAT_SHOT_ACTION_RE.test(evidence)
  const evidenceHasPerson = GREAT_SHOT_PERSON_RE.test(evidence)
  const evidenceSignalCount = [evidenceHasGolf, evidenceHasAction, evidenceHasPerson].filter(Boolean).length
  const verifiedGolfShot = candidate?.verifiedGolfShot === true

  // Search queries are controlled by this job and may supply one missing semantic signal,
  // but normal search results still need at least two independent signals in their own
  // title/description/categories. Curated seed videos are explicitly reviewed golf shots.
  if (!verifiedGolfShot && evidenceSignalCount < 2) return false
  if (!GREAT_SHOT_GOLF_RE.test(combined) || !GREAT_SHOT_ACTION_RE.test(combined) || !GREAT_SHOT_PERSON_RE.test(combined)) return false

  const normalizedCategory = normalizeCategory(category)
  const hasMemorableMoment = GREAT_SHOT_MOMENT_RE.test(combined)
  const proEvidence = /\b(?:professional|pga|lpga|tour player|championship|tournament|u\.s\. open|british open)\b/i.test(combined)
  if (normalizedCategory === 'amateur' && !verifiedGolfShot && !hasMemorableMoment) return false
  if (normalizedCategory === 'professional' && !verifiedGolfShot && !hasMemorableMoment && !proEvidence) return false

  const duration = knownDurationSeconds(candidate)
  if (duration !== null && (duration < GREAT_SHOTS_MIN_SOURCE_DURATION_SECONDS || duration > GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS)) return false
  return true
}

function candidateSortScore(candidate, category = candidate?.category) {
  const portrait = Number(candidate?.height || 0) >= Number(candidate?.width || 0) && Number(candidate?.height || 0) > 0 ? 20 : 0
  const duration = knownDurationSeconds(candidate)
  const durationScore = duration !== null && duration <= 15 ? 16 : duration !== null && duration <= GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS ? 10 : 4
  const memorableScore = GREAT_SHOT_MOMENT_RE.test(`${candidateEvidenceText(candidate)} ${candidateQueryText(candidate)}`) ? 18 : 0
  const providerScore = candidate?.provider === 'Pexels' ? 18 : candidate?.provider === 'Wikimedia Commons' ? 10 : candidate?.provider === 'Mixkit' ? 9 : candidate?.provider === 'Internet Archive' ? 8 : 6
  const categoryScore = isGreatShotVideoCandidate(candidate, category) ? 20 : 0
  return portrait + durationScore + memorableScore + providerScore + categoryScore
}

function supportsCategory(candidate, category) {
  const categories = new Set([
    ...(Array.isArray(candidate?.categories) ? candidate.categories : []),
    candidate?.category,
  ].filter(Boolean).map(normalizeCategory))
  return categories.has(category)
}

function availableGreatShotCandidates(candidates = [], usedKeys = new Set(), category) {
  return dedupeCandidates(candidates)
    .filter((candidate) => !usedKeys.has(candidate.key))
    .filter((candidate) => supportsCategory(candidate, category))
    .filter((candidate) => isGreatShotVideoCandidate(candidate, category))
    .sort((a, b) => candidateSortScore(b, category) - candidateSortScore(a, category) || a.key.localeCompare(b.key))
    .slice(0, MAX_SELECTION_CANDIDATES_PER_CATEGORY)
}

function pairKnownDurationEligible(professional, amateur) {
  const professionalDuration = knownDurationSeconds(professional)
  const amateurDuration = knownDurationSeconds(amateur)
  if (professionalDuration !== null && professionalDuration > GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS) return false
  if (amateurDuration !== null && amateurDuration > GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS) return false
  if (professionalDuration !== null && amateurDuration !== null) {
    return professionalDuration + amateurDuration <= GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS
  }
  return true
}

function buildGreatShotCandidatePairs(candidates = [], usedKeys = new Set()) {
  const professionals = availableGreatShotCandidates(candidates, usedKeys, 'professional')
  const amateurs = availableGreatShotCandidates(candidates, usedKeys, 'amateur')
  const pairs = []
  for (const professional of professionals) {
    for (const amateur of amateurs) {
      if (professional.key === amateur.key || !pairKnownDurationEligible(professional, amateur)) continue
      pairs.push({
        clips: [
          { ...professional, category: 'professional' },
          { ...amateur, category: 'amateur' },
        ],
        score: candidateSortScore(professional, 'professional') + candidateSortScore(amateur, 'amateur'),
        selectionMode: 'mixed-pair',
      })
    }
  }
  return pairs.sort((a, b) => b.score - a.score || a.clips[0].key.localeCompare(b.clips[0].key) || a.clips[1].key.localeCompare(b.clips[1].key))
}

function singleFallbackCategory(usedKeys = new Set()) {
  // Pair-based historical runs add two used keys. Once a single fallback is needed,
  // parity alternates the preferred category on subsequent single-clip runs so the
  // commercial series remains a professional/amateur mix without reusing footage.
  return usedKeys.size % 2 === 0 ? 'professional' : 'amateur'
}

function buildGreatShotSelectionPlans(candidates = [], usedKeys = new Set()) {
  // Prefer a professional/amateur pair whenever both complete clips fit the 30-second
  // commercial maximum. Always append single-clip fallbacks so a metadata mismatch,
  // failed download, or actual-duration probe cannot turn a usable free clip into a
  // whole-job failure.
  const plans = [...buildGreatShotCandidatePairs(candidates, usedKeys)]
  const preferredCategory = singleFallbackCategory(usedKeys)
  const alternateCategory = preferredCategory === 'professional' ? 'amateur' : 'professional'
  for (const category of [preferredCategory, alternateCategory]) {
    const available = availableGreatShotCandidates(candidates, usedKeys, category)
    for (const candidate of available) {
      plans.push({
        clips: [{ ...candidate, category }],
        score: candidateSortScore(candidate, category),
        selectionMode: 'single-fallback',
      })
    }
  }
  return plans
}

export function getGreatShotSelectionDiagnostics(candidates = [], usedKeys = new Set()) {
  const deduped = dedupeCandidates(candidates)
  const free = deduped.filter((candidate) => FREE_VIDEO_PROVIDERS.has(candidate?.provider))
  const unused = free.filter((candidate) => !usedKeys.has(candidate?.key))
  const durationEligible = unused.filter((candidate) => {
    const duration = knownDurationSeconds(candidate)
    return duration === null || (duration >= GREAT_SHOTS_MIN_SOURCE_DURATION_SECONDS && duration <= GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS)
  })
  const professional = availableGreatShotCandidates(deduped, usedKeys, 'professional')
  const amateur = availableGreatShotCandidates(deduped, usedKeys, 'amateur')
  const unknownDurationCount = unused.filter((candidate) => knownDurationSeconds(candidate) === null).length
  const knownTooLongCount = unused.filter((candidate) => {
    const duration = knownDurationSeconds(candidate)
    return duration !== null && duration > GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS
  }).length
  return {
    discoveredCount: deduped.length,
    freeSourceCount: free.length,
    previouslyUsedCount: free.length - unused.length,
    unusedCount: unused.length,
    metadataDurationEligibleCount: durationEligible.length,
    metadataDurationUnknownCount: unknownDurationCount,
    metadataTooLongCount: knownTooLongCount,
    eligibleProfessionalCount: professional.length,
    eligibleAmateurCount: amateur.length,
    providers: [...new Set(free.map((candidate) => candidate.provider))].sort(),
    sampleUnusedTitles: unused.slice(0, 8).map((candidate) => candidate.title || candidate.id || candidate.key),
  }
}

export function selectGreatShotVideos(candidates = [], usedKeys = new Set()) {
  const plans = buildGreatShotSelectionPlans(candidates, usedKeys)
  if (plans.length) return plans[0].clips

  const diagnostics = getGreatShotSelectionDiagnostics(candidates, usedKeys)
  const error = new Error(`No unused short, specific golf-shot video could be found from the free licensed sources after searching Pexels (when PEXELS_API_KEY is configured), curated Wikimedia clips, Wikimedia golf-video categories, Wikimedia search, Mixkit Free License golf clips, and Internet Archive. A source must show a person hitting a great or funny golf shot and must be ${GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS} seconds or less. Discovery diagnostics: ${diagnostics.discoveredCount} discovered, ${diagnostics.unusedCount} unused, ${diagnostics.metadataDurationEligibleCount} within the metadata duration limit, ${diagnostics.metadataDurationUnknownCount} with unknown metadata duration, ${diagnostics.metadataTooLongCount} already known over the duration limit, ${diagnostics.eligibleProfessionalCount} eligible professional, ${diagnostics.eligibleAmateurCount} eligible amateur.`)
  error.code = 'GREAT_SHOT_VIDEO_UNAVAILABLE'
  Object.assign(error, diagnostics)
  throw error
}

function extensionForVideo(contentType, url) {
  const normalized = String(contentType || '').split(';', 1)[0].trim().toLowerCase()
  if (normalized === 'video/mp4') return '.mp4'
  if (normalized === 'video/webm') return '.webm'
  if (normalized === 'video/ogg' || normalized === 'application/ogg') return '.ogv'
  if (normalized === 'video/quicktime') return '.mov'
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase()
    if (['.mp4', '.webm', '.ogv', '.ogg', '.mov', '.m4v'].includes(extension)) return extension
  } catch {
    // handled below
  }
  return null
}

export async function downloadGreatShotVideo(candidate, {
  tempDir,
  fetchImpl = globalThis.fetch,
  signal = null,
  correlationId = null,
  logApi = () => {},
  logScheduledJob = () => {},
} = {}) {
  const downloadUrls = [...new Set([
    ...(Array.isArray(candidate?.downloadUrls) ? candidate.downloadUrls : []),
    candidate?.downloadUrl,
  ].filter(Boolean))]
  if (!downloadUrls.length || !tempDir) throw new Error('Great-shot candidate download URL and temporary directory are required')
  throwIfCancelled(signal)
  const startedAt = Date.now()
  const details = {
    correlationId,
    jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
    videoKey: candidate.key,
    provider: candidate.provider,
    category: candidate.category,
    sourcePageUrl: candidate.sourcePageUrl,
  }
  logApi('great_shots_video_download_started', details)

  const byteLimit = maxVideoBytes()
  const failures = []
  for (const downloadUrl of downloadUrls) {
    throwIfCancelled(signal)
    try {
      const response = await fetchImpl(downloadUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: sourceAbortSignal(signal, videoTimeoutMs()),
        headers: {
          Accept: 'video/mp4,video/webm,video/ogg,video/*;q=0.9,*/*;q=0.5',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
          Referer: candidate.sourcePageUrl,
          ...(candidate.provider === 'Mixkit' ? {
            Origin: 'https://mixkit.co',
            'Sec-Fetch-Dest': 'video',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'cross-site',
          } : {}),
        },
      })
      if (!response?.ok) throw new Error(`HTTP ${response?.status || 'unknown'}`)
      const advertised = Number.parseInt(response.headers?.get?.('content-length') || '0', 10)
      if (Number.isFinite(advertised) && advertised > byteLimit) throw new Error(`video exceeds ${byteLimit} byte limit`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length || buffer.length > byteLimit) throw new Error(`video exceeds ${byteLimit} byte limit or is empty`)
      const contentType = response.headers?.get?.('content-type') || ''
      const extension = extensionForVideo(contentType, downloadUrl)
      if (!extension) throw new Error(`unsupported video content type: ${contentType || 'unknown'}`)
      const safeId = String(candidate.id || candidate.key || randomUUID()).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(-48) || randomUUID()
      const filePath = path.join(tempDir, `${candidate.category}-${candidate.provider.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${safeId}${extension}`)
      await fs.writeFile(filePath, buffer)
      const completed = { ...details, downloadUrl, bytes: buffer.length, contentType, durationMs: Date.now() - startedAt }
      logApi('great_shots_video_download_completed', completed)
      logScheduledJob('great_shots_video_download_completed', completed)
      return { ...candidate, downloadUrl, localPath: filePath, downloadedBytes: buffer.length }
    } catch (error) {
      if (signal?.aborted) throw error
      failures.push(`${downloadUrl}: ${error?.message || String(error)}`)
      const failedDetails = { ...details, downloadUrl, error: error?.message || String(error), level: 'warn' }
      logApi('great_shots_video_download_url_failed', failedDetails)
      logScheduledJob('great_shots_video_download_url_failed', failedDetails)
    }
  }

  throw new Error(`${candidate.provider} video download failed for all ${downloadUrls.length} candidate URL${downloadUrls.length === 1 ? '' : 's'}: ${failures.join('; ')}`)
}

function dateStamp(date) {
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) throw new Error('Great-shots commercial output date is invalid')
  return value.toISOString().slice(0, 10)
}

export function buildGreatShotsCommercialOutputPath({ now = new Date(), projectRoot = process.cwd() } = {}) {
  return path.join(
    projectRoot,
    'jobs',
    'commercials',
    `${GREAT_SHOTS_COMMERCIAL_JOB_NAME} - ${GREAT_SHOTS_COMMERCIAL_FILE_TAG} - ${dateStamp(now)}.mp4`,
  )
}

export async function reserveGreatShotsCommercialOutputPath({ now = new Date(), projectRoot = process.cwd(), maxAttempts = 1000 } = {}) {
  const basePath = buildGreatShotsCommercialOutputPath({ now, projectRoot })
  const extension = path.extname(basePath)
  const stem = basePath.slice(0, -extension.length)
  await fs.mkdir(path.dirname(basePath), { recursive: true })

  for (let index = 1; index <= maxAttempts; index += 1) {
    const outputPath = index === 1 ? basePath : `${stem} - ${index}${extension}`
    const lockPath = `${outputPath}.lock`
    try {
      await fs.access(outputPath)
      continue
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    let handle = null
    try {
      handle = await fs.open(lockPath, 'wx')
      try {
        await fs.access(outputPath)
        await handle.close()
        handle = null
        await fs.rm(lockPath, { force: true })
        continue
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`, 'utf8')
      await handle.close()
      return { outputPath, lockPath, sequence: index }
    } catch (error) {
      if (handle) await handle.close().catch(() => {})
      if (error?.code === 'EEXIST') continue
      throw error
    }
  }

  const error = new Error(`Unable to reserve a unique great-shots commercial name after ${maxAttempts} attempts`)
  error.code = 'COMMERCIAL_OUTPUT_RESERVATION_FAILED'
  throw error
}

function filterPath(filePath, projectRoot) {
  const relative = path.relative(projectRoot, filePath) || path.basename(filePath)
  return relative.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

function greatShotsFontCandidates() {
  const candidates = []
  const windowsRoots = [process.env.WINDIR, process.env.SystemRoot, 'C:\\Windows'].filter(Boolean)
  for (const root of windowsRoots) {
    candidates.push(
      path.join(root, 'Fonts', 'arial.ttf'),
      path.join(root, 'Fonts', 'segoeui.ttf'),
      path.join(root, 'Fonts', 'calibri.ttf'),
    )
  }
  candidates.push(
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/lato/Lato-Regular.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/Library/Fonts/Arial.ttf',
  )
  return [...new Set(candidates)]
}

export async function resolveGreatShotsFontFile({ configuredPath = process.env.GREAT_SHOTS_FONT_FILE || null, projectRoot = process.cwd() } = {}) {
  const candidates = []
  if (configuredPath) {
    candidates.push(path.isAbsolute(configuredPath) ? configuredPath : path.resolve(projectRoot, configuredPath))
  }
  candidates.push(...greatShotsFontCandidates())

  for (const candidatePath of candidates) {
    try {
      await fs.access(candidatePath, fsConstants.R_OK)
      return candidatePath
    } catch {
      // Try the next platform font. Explicit font files avoid ffmpeg/fontconfig runtime failures.
    }
  }

  const error = new Error('A readable TrueType/OpenType font is required for the great-shots commercial. Set GREAT_SHOTS_FONT_FILE to a local font file.')
  error.code = 'GREAT_SHOTS_FONT_NOT_FOUND'
  throw error
}

function trimLabel(value, max = 52) {
  const clean = stripHtml(value)
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 3).replace(/\s+\S*$/, '')}...`
}

function attributionFor(candidate) {
  if (candidate.provider === 'Wikimedia Commons') {
    return trimLabel(`${candidate.author || 'Contributor'} • ${candidate.license || 'CC'} • Wikimedia Commons`, 58)
  }
  return trimLabel(`${candidate.author || 'Creator'} • ${candidate.provider}`, 58)
}

function validatedSourceDuration(candidate) {
  const duration = knownDurationSeconds(candidate)
  if (duration === null || duration < GREAT_SHOTS_MIN_SOURCE_DURATION_SECONDS || duration > GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS) {
    const error = new Error(`Great-shot source ${candidate?.key || 'unknown'} must be between ${GREAT_SHOTS_MIN_SOURCE_DURATION_SECONDS} and ${GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS} seconds`)
    error.code = 'GREAT_SHOT_DURATION_INVALID'
    throw error
  }
  return duration
}

export function greatShotsCommercialDuration(clips = []) {
  if (!Array.isArray(clips) || clips.length < 1 || clips.length > 2) throw new Error('One or two great-shot clips are required')
  const duration = clips.reduce((total, clip) => total + validatedSourceDuration(clip), 0)
  if (duration > GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS + 0.001) {
    const error = new Error(`Great-shots commercial would be ${duration.toFixed(3)} seconds; maximum is ${GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS} seconds`)
    error.code = 'GREAT_SHOT_COMMERCIAL_TOO_LONG'
    throw error
  }
  return Number(duration.toFixed(3))
}

function runProcess(command, args, { spawnImpl = nodeSpawn, signal = null, correlationId = null, logApi = () => {}, logScheduledJob = () => {}, cwd = process.cwd() } = {}) {
  throwIfCancelled(signal)
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    const onAbort = () => {
      try { child.kill('SIGTERM') } catch { /* best effort */ }
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    child.stderr?.on?.('data', (chunk) => { stderr += String(chunk).slice(0, 4000) })
    child.on('error', (error) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code, processSignal) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      if (signal?.aborted) return reject(abortError())
      if (code === 0) return resolve({ code, processSignal, stderr })
      const error = new Error(`ffmpeg exited with code ${code ?? 'unknown'}${stderr ? `: ${stderr.slice(-900)}` : ''}`)
      error.code = 'FFMPEG_FAILED'
      const failedDetails = {
        correlationId,
        jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
        exitCode: code,
        processSignal,
        stderr: stderr.slice(-1200),
        error: error.message,
        level: 'error',
      }
      logApi('great_shots_ffmpeg_failed', failedDetails)
      logScheduledJob('great_shots_ffmpeg_failed', failedDetails)
      reject(error)
    })
  })
}

export function parseFfmpegDurationText(value) {
  const match = String(value || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const duration = hours * 3600 + minutes * 60 + seconds
  return Number.isFinite(duration) && duration > 0 ? duration : null
}

function runDurationProbe(command, filePath, { spawnImpl = nodeSpawn, signal = null, cwd = process.cwd() } = {}) {
  throwIfCancelled(signal)
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, ['-hide_banner', '-i', filePath], { cwd, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    const onAbort = () => {
      try { child.kill('SIGTERM') } catch { /* best effort */ }
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    child.stderr?.on?.('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-12000) })
    child.on('error', (error) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', () => {
      if (signal) signal.removeEventListener('abort', onAbort)
      if (signal?.aborted) return reject(abortError())
      const duration = parseFfmpegDurationText(stderr)
      if (duration !== null) return resolve(duration)
      const error = new Error(`Unable to determine great-shot video duration from ffmpeg metadata${stderr ? `: ${stderr.slice(-700)}` : ''}`)
      error.code = 'GREAT_SHOT_DURATION_UNKNOWN'
      reject(error)
    })
  })
}

export async function probeGreatShotVideoDuration(candidate, {
  projectRoot = process.cwd(),
  ffmpegPath = process.env.FFMPEG_PATH || null,
  spawnImpl = nodeSpawn,
  ensureFfmpegImpl = ensureManagedFfmpeg,
  autoDownloadFfmpeg = isManagedFfmpegAutoDownloadEnabled(),
  signal = null,
  correlationId = null,
  logApi = () => {},
  logScheduledJob = () => {},
} = {}) {
  if (!candidate?.localPath) throw new Error('Downloaded great-shot video path is required for duration validation')
  let resolvedFfmpegPath = resolveFfmpegPath({ projectRoot, configuredPath: ffmpegPath })
  try {
    const duration = await runDurationProbe(resolvedFfmpegPath, candidate.localPath, { spawnImpl, signal, cwd: projectRoot })
    const details = { correlationId, jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID, videoKey: candidate.key, durationSeconds: duration }
    logApi('great_shots_video_duration_validated', details)
    logScheduledJob('great_shots_video_duration_validated', details)
    return duration
  } catch (error) {
    if (error?.code !== 'ENOENT' || !autoDownloadFfmpeg) throw error
    const setupDetails = { correlationId, jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID, missingFfmpegPath: resolvedFfmpegPath, reason: error?.message || String(error) }
    logApi('great_shots_ffmpeg_missing_auto_setup_started', { ...setupDetails, level: 'warn' })
    logScheduledJob('great_shots_ffmpeg_missing_auto_setup_started', { ...setupDetails, level: 'warn' })
    resolvedFfmpegPath = await ensureFfmpegImpl({ projectRoot, signal, correlationId, logApi, logScheduledJob })
    const duration = await runDurationProbe(resolvedFfmpegPath, candidate.localPath, { spawnImpl, signal, cwd: projectRoot })
    const details = { correlationId, jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID, videoKey: candidate.key, durationSeconds: duration }
    logApi('great_shots_video_duration_validated', details)
    logScheduledJob('great_shots_video_duration_validated', details)
    return duration
  }
}

function greatShotsSelectionMode(clips = []) {
  if (clips.some((clip) => clip?.generatedFallback)) return 'generated-fallback'
  return clips.length === 2 ? 'mixed-pair' : 'single-fallback'
}

export async function createGeneratedGreatShotFallbackClip({
  tempDir,
  projectRoot = process.cwd(),
  ffmpegPath = process.env.FFMPEG_PATH || null,
  spawnImpl = nodeSpawn,
  ensureFfmpegImpl = ensureManagedFfmpeg,
  autoDownloadFfmpeg = isManagedFfmpegAutoDownloadEnabled(),
  signal = null,
  correlationId = null,
  logApi = () => {},
  logScheduledJob = () => {},
  durationSeconds = 8,
} = {}) {
  if (!tempDir) throw new Error('A temporary directory is required for the generated Great Shots fallback')
  throwIfCancelled(signal)

  const [visual] = await generateGolfHomiezFallbackVisuals({ tempDir, count: 1, width: 720, height: 1280 })
  const id = randomUUID()
  const localPath = path.join(tempDir, `generated-great-shot-${id}.mp4`)
  const args = [
    '-loop', '1',
    '-i', visual.path,
    '-vf', `scale=720:1280,setsar=1,zoompan=z='min(zoom+0.0010,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=30,trim=duration=${durationSeconds},setpts=PTS-STARTPTS,format=yuv420p`,
    '-t', String(durationSeconds),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-an',
    '-y',
    localPath,
  ]

  let resolvedFfmpegPath = resolveFfmpegPath({ projectRoot, configuredPath: ffmpegPath })
  const details = {
    correlationId,
    jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
    provider: 'GolfHomiez',
    reason: 'external-free-video-unavailable-or-blocked',
    durationSeconds,
  }
  logApi('great_shots_generated_fallback_started', details)
  logScheduledJob('great_shots_generated_fallback_started', details)

  try {
    await runProcess(resolvedFfmpegPath, args, { spawnImpl, signal, correlationId, logApi, logScheduledJob, cwd: projectRoot })
  } catch (error) {
    if (error?.code !== 'ENOENT' || !autoDownloadFfmpeg) throw error
    resolvedFfmpegPath = await ensureFfmpegImpl({ projectRoot, signal, correlationId, logApi, logScheduledJob })
    await runProcess(resolvedFfmpegPath, args, { spawnImpl, signal, correlationId, logApi, logScheduledJob, cwd: projectRoot })
  }

  const clip = {
    key: `golfhomiez-generated:${id}`,
    provider: 'GolfHomiez',
    id,
    category: 'amateur',
    categories: ['amateur'],
    query: 'GolfHomiez generated fallback',
    title: 'GolfHomiez generated great-shot replay',
    description: 'GolfHomiez generated golf visual used when free external footage is unavailable.',
    pageCategories: ['GolfHomiez', 'Generated'],
    author: 'GolfHomiez',
    license: 'GolfHomiez generated media',
    licenseUrl: null,
    sourcePageUrl: 'https://golfhomiez.com',
    downloadUrl: null,
    downloadUrls: [],
    durationSeconds,
    width: 720,
    height: 1280,
    localPath,
    downloadedBytes: null,
    verifiedGolfShot: true,
    generatedFallback: true,
  }
  const completed = { ...details, videoKey: clip.key, localPath }
  logApi('great_shots_generated_fallback_completed', completed)
  logScheduledJob('great_shots_generated_fallback_completed', completed)
  return clip
}

export async function renderGreatShotsCommercial({
  outputPath,
  clips,
  projectRoot = process.cwd(),
  ffmpegPath = process.env.FFMPEG_PATH || null,
  fontFile = process.env.GREAT_SHOTS_FONT_FILE || null,
  resolveFontFileImpl = resolveGreatShotsFontFile,
  backgroundMusicFile = process.env.COMMERCIAL_BACKGROUND_MUSIC_FILE || null,
  backgroundMusicVolume = commercialBackgroundMusicVolume(),
  resolveBackgroundMusicFileImpl = resolveCommercialBackgroundMusicFile,
  spawnImpl = nodeSpawn,
  ensureFfmpegImpl = ensureManagedFfmpeg,
  autoDownloadFfmpeg = isManagedFfmpegAutoDownloadEnabled(),
  signal = null,
  correlationId = null,
  logApi = () => {},
  logScheduledJob = () => {},
} = {}) {
  if (!outputPath) throw new Error('Great-shots commercial output path is required')
  if (!Array.isArray(clips) || clips.length < 1 || clips.length > 2 || clips.some((clip) => !clip?.localPath)) {
    throw new Error('One or two downloaded great-shot clips are required')
  }
  const outputDir = path.dirname(outputPath)
  await fs.mkdir(outputDir, { recursive: true })
  const tempDir = path.join(projectRoot, 'jobs', 'commercials', `.tmp-great-shots-${randomUUID()}`)
  await fs.mkdir(tempDir, { recursive: true })
  const renderPath = path.join(tempDir, 'commercial.mp4')
  const emblemPath = path.join(projectRoot, 'src', 'assets', 'GolfHomiezEmblem.png')

  try {
    await fs.access(emblemPath)
    const attributionFiles = []
    for (let index = 0; index < clips.length; index += 1) {
      const filePath = path.join(tempDir, `credit-${index + 1}.txt`)
      await fs.writeFile(filePath, attributionFor(clips[index]), 'utf8')
      attributionFiles.push(filePath)
    }

    const commercialDuration = greatShotsCommercialDuration(clips)
    const ctaStart = Math.max(0, commercialDuration - 3)
    const resolvedFontFile = await resolveFontFileImpl({ configuredPath: fontFile, projectRoot })
    const resolvedBackgroundMusicFile = await resolveBackgroundMusicFileImpl({ configuredPath: backgroundMusicFile, projectRoot })
    const musicVolume = commercialBackgroundMusicVolume(backgroundMusicVolume)
    const ffmpegFont = filterPath(resolvedFontFile, projectRoot)
    const fontOption = `fontfile='${ffmpegFont}':`
    const filterParts = []

    clips.forEach((clip, index) => {
      const duration = validatedSourceDuration(clip)
      const credit = filterPath(attributionFiles[index], projectRoot)
      const professional = clip.category === 'professional'
      const label = professional ? 'PRO SHOT' : 'HOMIE SHOT'
      const headline = professional ? 'TOUR-LEVEL PURE.' : 'WEEKEND LEGEND.'
      const subhead = professional ? 'Watch the whole shot.' : 'Great, lucky, or gloriously funny.'
      const boxWidth = professional ? 430 : 500
      const headlineSize = professional ? 46 : 44
      filterParts.push(
        `[${index}:v]trim=start=0:duration=${duration.toFixed(3)},setpts=PTS-STARTPTS,scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30,format=yuv420p,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.08:t=fill,drawbox=x=32:y=78:w=${boxWidth}:h=154:color=0x071d13@0.78:t=fill,drawbox=x=32:y=78:w=10:h=154:color=0xF6BE36@1:t=fill,drawtext=${fontOption}text='${label}':fontcolor=0xF6BE36:fontsize=28:x=58:y=98,drawtext=${fontOption}text='${headline}':fontcolor=white:fontsize=${headlineSize}:x=58:y=143,drawtext=${fontOption}text='${subhead}':fontcolor=white@0.92:fontsize=${professional ? 28 : 24}:x=58:y=196,drawbox=x=0:y=1152:w=iw:h=128:color=0x071d13@0.78:t=fill,drawtext=${fontOption}textfile='${credit}':fontcolor=white@0.78:fontsize=20:x=28:y=1168[scene${index}]`,
      )
    })

    if (clips.length === 2) filterParts.push('[scene0][scene1]concat=n=2:v=1:a=0[story]')
    else filterParts.push('[scene0]null[story]')

    const logoInputIndex = clips.length
    filterParts.push(`[${logoInputIndex}:v]scale=142:-1,setsar=1[logo]`)
    filterParts.push(`[story][logo]overlay=W-w-24:18:format=auto,drawbox=x=28:y=900:w=664:h=198:color=0x071d13@0.82:t=fill:enable='gte(t,${ctaStart.toFixed(3)})',drawtext=${fontOption}text='GREAT SHOT?':fontcolor=0xF6BE36:fontsize=30:x=(W-text_w)/2:y=928:enable='gte(t,${ctaStart.toFixed(3)})',drawtext=${fontOption}text='LOG IT. CHALLENGE IT. REPLAY IT.':fontcolor=white:fontsize=30:x=(W-text_w)/2:y=978:enable='gte(t,${ctaStart.toFixed(3)})',drawtext=${fontOption}text='GolfHomiez':fontcolor=white:fontsize=48:x=(W-text_w)/2:y=1025:enable='gte(t,${ctaStart.toFixed(3)})',drawtext=${fontOption}text='golfhomiez.com':fontcolor=white:fontsize=24:x=28:y=1225[vout]`)
    const musicInputIndex = clips.length + 1
    const musicFadeOutStart = Math.max(0, commercialDuration - 0.8)
    filterParts.push(`[${musicInputIndex}:a]atrim=start=0:duration=${commercialDuration.toFixed(3)},asetpts=PTS-STARTPTS,volume=${musicVolume.toFixed(3)},afade=t=in:st=0:d=0.35,afade=t=out:st=${musicFadeOutStart.toFixed(3)}:d=0.8[aout]`)

    const args = []
    for (const clip of clips) args.push('-i', clip.localPath)
    args.push(
      '-loop', '1', '-i', emblemPath,
      '-stream_loop', '-1', '-i', resolvedBackgroundMusicFile,
      '-filter_complex', filterParts.join(';'),
      '-map', '[vout]',
      '-map', '[aout]',
      '-t', commercialDuration.toFixed(3),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-shortest',
      '-y',
      renderPath,
    )

    let resolvedFfmpegPath = resolveFfmpegPath({ projectRoot, configuredPath: ffmpegPath })
    const renderDetails = {
      correlationId,
      jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
      outputPath,
      ffmpegPath: resolvedFfmpegPath,
      fontFile: resolvedFontFile,
      durationSeconds: commercialDuration,
      sourceDurationsSeconds: clips.map((clip) => validatedSourceDuration(clip)),
      selectionMode: greatShotsSelectionMode(clips),
      videoKeys: clips.map((clip) => clip.key),
      providers: clips.map((clip) => clip.provider),
      backgroundMusic: backgroundMusicMetadata(resolvedBackgroundMusicFile, musicVolume),
    }
    logApi('great_shots_ffmpeg_started', renderDetails)
    logScheduledJob('great_shots_ffmpeg_started', renderDetails)
    try {
      await runProcess(resolvedFfmpegPath, args, { spawnImpl, signal, correlationId, logApi, logScheduledJob, cwd: projectRoot })
    } catch (error) {
      if (error?.code !== 'ENOENT' || !autoDownloadFfmpeg) throw error
      const setupDetails = {
        correlationId,
        jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
        missingFfmpegPath: resolvedFfmpegPath,
        reason: error?.message || String(error),
      }
      logApi('great_shots_ffmpeg_missing_auto_setup_started', { ...setupDetails, level: 'warn' })
      logScheduledJob('great_shots_ffmpeg_missing_auto_setup_started', { ...setupDetails, level: 'warn' })
      resolvedFfmpegPath = await ensureFfmpegImpl({ projectRoot, signal, correlationId, logApi, logScheduledJob })
      await runProcess(resolvedFfmpegPath, args, { spawnImpl, signal, correlationId, logApi, logScheduledJob, cwd: projectRoot })
    }

    await fs.copyFile(renderPath, outputPath, fsConstants.COPYFILE_EXCL)
    const stats = await fs.stat(outputPath)
    const completed = {
      correlationId,
      jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
      outputPath,
      bytes: stats.size,
      durationSeconds: commercialDuration,
      sourceDurationsSeconds: clips.map((clip) => validatedSourceDuration(clip)),
      selectionMode: greatShotsSelectionMode(clips),
      width: 720,
      height: 1280,
      providers: clips.map((clip) => clip.provider),
      videoKeys: clips.map((clip) => clip.key),
      backgroundMusic: backgroundMusicMetadata(resolvedBackgroundMusicFile, musicVolume),
    }
    logApi('great_shots_ffmpeg_completed', completed)
    logScheduledJob('great_shots_ffmpeg_completed', completed)
    return completed
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

function logGreatShotCandidateRejected(candidate, reason, options = {}) {
  const details = {
    correlationId: options.correlationId || null,
    jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
    videoKey: candidate?.key || null,
    provider: candidate?.provider || null,
    category: candidate?.category || null,
    reason,
  }
  options.logApi?.('great_shots_candidate_rejected', { ...details, level: 'warn' })
  options.logScheduledJob?.('great_shots_candidate_rejected', { ...details, level: 'warn' })
}

async function selectAndDownloadValidatedGreatShotPair(candidates, usedKeys, {
  tempDir,
  fetchImpl,
  signal,
  correlationId,
  logApi,
  logScheduledJob,
  probeDurationImpl = probeGreatShotVideoDuration,
  projectRoot,
  ffmpegPath,
  spawnImpl,
  ensureFfmpegImpl,
  autoDownloadFfmpeg,
  generatedFallbackImpl = createGeneratedGreatShotFallbackClip,
} = {}) {
  const plans = buildGreatShotSelectionPlans(candidates, usedKeys)
  if (!plans.length) {
    const diagnostics = getGreatShotSelectionDiagnostics(candidates, usedKeys)
    logApi?.('great_shots_external_catalog_exhausted', { correlationId, jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID, ...diagnostics, level: 'warn' })
    logScheduledJob?.('great_shots_external_catalog_exhausted', { correlationId, jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID, ...diagnostics, level: 'warn' })
    return [await generatedFallbackImpl({
      tempDir, projectRoot, ffmpegPath, spawnImpl, ensureFfmpegImpl, autoDownloadFfmpeg, signal, correlationId, logApi, logScheduledJob,
    })]
  }

  const validatedByKey = new Map()
  const rejectedKeys = new Set()
  const accessDeniedCounts = new Map()
  const blockedProviders = new Set()
  for (const plan of plans) {
    throwIfCancelled(signal)
    const clips = []
    let pairRejected = false
    for (const candidate of plan.clips) {
      if (blockedProviders.has(candidate.provider) || rejectedKeys.has(candidate.key)) {
        pairRejected = true
        break
      }
      if (validatedByKey.has(candidate.key)) {
        clips.push({ ...validatedByKey.get(candidate.key), category: candidate.category })
        continue
      }
      try {
        const downloaded = await downloadGreatShotVideo(candidate, { tempDir, fetchImpl, signal, correlationId, logApi, logScheduledJob })
        const probedDuration = Number(await probeDurationImpl(downloaded, {
          projectRoot, ffmpegPath, spawnImpl, ensureFfmpegImpl, autoDownloadFfmpeg, signal, correlationId, logApi, logScheduledJob,
        }))
        if (!Number.isFinite(probedDuration) || probedDuration < GREAT_SHOTS_MIN_SOURCE_DURATION_SECONDS || probedDuration > GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS) {
          rejectedKeys.add(candidate.key)
          logGreatShotCandidateRejected(candidate, `actual video duration ${Number.isFinite(probedDuration) ? probedDuration.toFixed(3) : 'unknown'} seconds is outside the allowed ${GREAT_SHOTS_MIN_SOURCE_DURATION_SECONDS}-${GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS} second range`, { correlationId, logApi, logScheduledJob })
          pairRejected = true
          break
        }
        const validated = { ...downloaded, durationSeconds: Number(probedDuration.toFixed(3)) }
        validatedByKey.set(candidate.key, validated)
        clips.push({ ...validated, category: candidate.category })
      } catch (error) {
        if (signal?.aborted) throw error
        rejectedKeys.add(candidate.key)
        const reason = error?.message || String(error)
        logGreatShotCandidateRejected(candidate, reason, { correlationId, logApi, logScheduledJob })
        if (['Mixkit', 'Pexels'].includes(candidate.provider) && /HTTP\s+(?:401|403)\b/i.test(reason)) {
          const deniedCount = (accessDeniedCounts.get(candidate.provider) || 0) + 1
          accessDeniedCounts.set(candidate.provider, deniedCount)
          if (deniedCount >= 2) {
            blockedProviders.add(candidate.provider)
            const blockedDetails = {
              correlationId,
              jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
              provider: candidate.provider,
              deniedCount,
              reason: 'repeated HTTP 401/403 from provider media CDN',
              level: 'warn',
            }
            logApi?.('great_shots_provider_download_blocked', blockedDetails)
            logScheduledJob?.('great_shots_provider_download_blocked', blockedDetails)
          }
        }
        pairRejected = true
        break
      }
    }
    if (pairRejected || clips.length !== plan.clips.length) continue
    const duration = clips.reduce((sum, clip) => sum + validatedSourceDuration(clip), 0)
    if (duration > GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS + 0.001) {
      const details = { correlationId, jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID, videoKeys: clips.map((clip) => clip.key), durationSeconds: Number(duration.toFixed(3)), maximumSeconds: GREAT_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS }
      logApi?.('great_shots_pair_rejected_too_long', { ...details, level: 'warn' })
      logScheduledJob?.('great_shots_pair_rejected_too_long', { ...details, level: 'warn' })
      continue
    }
    return clips
  }

  const fallbackDetails = {
    correlationId,
    jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
    rejectedVideoCount: rejectedKeys.size,
    blockedProviders: [...blockedProviders],
    reason: 'no external free video passed download and duration validation',
    level: 'warn',
  }
  logApi?.('great_shots_external_validation_exhausted', fallbackDetails)
  logScheduledJob?.('great_shots_external_validation_exhausted', fallbackDetails)
  return [await generatedFallbackImpl({
    tempDir, projectRoot, ffmpegPath, spawnImpl, ensureFfmpegImpl, autoDownloadFfmpeg, signal, correlationId, logApi, logScheduledJob,
  })]
}

export async function runCreateShortFormGreatShotsSmall({
  pool = null,
  correlationId = `great-shots-commercial-${randomUUID()}`,
  triggeredBy = 'manual',
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
  signal = null,
  fetchImpl = globalThis.fetch,
  candidates = null,
  usedVideoKeys = null,
  loadUsedVideoKeysImpl = loadPreviouslyUsedGreatShotKeys,
  probeDurationImpl = probeGreatShotVideoDuration,
  generatedFallbackImpl = createGeneratedGreatShotFallbackClip,
  spawnImpl = nodeSpawn,
  ffmpegPath = process.env.FFMPEG_PATH || null,
  fontFile = process.env.GREAT_SHOTS_FONT_FILE || null,
  resolveFontFileImpl = resolveGreatShotsFontFile,
  backgroundMusicFile = process.env.COMMERCIAL_BACKGROUND_MUSIC_FILE || null,
  backgroundMusicVolume = commercialBackgroundMusicVolume(),
  resolveBackgroundMusicFileImpl = resolveCommercialBackgroundMusicFile,
  ensureFfmpegImpl = ensureManagedFfmpeg,
  autoDownloadFfmpeg = isManagedFfmpegAutoDownloadEnabled(),
  projectRoot = process.cwd(),
  now = new Date(),
} = {}) {
  const startedAt = Date.now()
  const startDetails = {
    correlationId,
    jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
    jobName: GREAT_SHOTS_COMMERCIAL_JOB_NAME,
    triggeredBy,
  }
  logApi('great_shots_commercial_started', startDetails)
  logScheduledJob('great_shots_commercial_started', startDetails)

  let reservation = null
  let tempDir = null
  try {
    throwIfCancelled(signal)
    const priorUsedKeys = usedVideoKeys instanceof Set
      ? usedVideoKeys
      : await loadUsedVideoKeysImpl(pool)
    const discovered = candidates || await fetchGreatShotCandidates({ fetchImpl, signal, correlationId, logApi, logError, logScheduledJob })
    const discoveryDiagnostics = getGreatShotSelectionDiagnostics(discovered, priorUsedKeys)
    logApi('great_shots_selection_diagnostics', { correlationId, jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID, ...discoveryDiagnostics })
    logScheduledJob('great_shots_selection_diagnostics', { correlationId, jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID, ...discoveryDiagnostics })
    tempDir = path.join(projectRoot, 'jobs', 'commercials', `.tmp-great-shot-downloads-${randomUUID()}`)
    await fs.mkdir(tempDir, { recursive: true })
    const clips = await selectAndDownloadValidatedGreatShotPair(discovered, priorUsedKeys, {
      tempDir, fetchImpl, signal, correlationId, logApi, logScheduledJob, probeDurationImpl, projectRoot, ffmpegPath, spawnImpl, ensureFfmpegImpl, autoDownloadFfmpeg, generatedFallbackImpl,
    })
    const selectionDetails = {
      correlationId,
      jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
      candidateCount: discovered.length,
      priorUsedVideoCount: priorUsedKeys.size,
      selectionMode: greatShotsSelectionMode(clips),
      commercialDurationSeconds: greatShotsCommercialDuration(clips),
      selectedVideos: clips.map((video) => ({ key: video.key, provider: video.provider, category: video.category, durationSeconds: video.durationSeconds, sourcePageUrl: video.sourcePageUrl })),
    }
    logApi('great_shots_videos_selected', selectionDetails)
    logScheduledJob('great_shots_videos_selected', selectionDetails)
    if (clips.length === 1) {
      const fallbackEvent = clips[0]?.generatedFallback ? 'great_shots_generated_fallback_selected' : 'great_shots_single_fallback_selected'
      logApi(fallbackEvent, { ...selectionDetails, level: 'warn' })
      logScheduledJob(fallbackEvent, { ...selectionDetails, level: 'warn' })
    }

    reservation = await reserveGreatShotsCommercialOutputPath({ now, projectRoot })
    const reservationDetails = {
      correlationId,
      jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
      outputPath: reservation.outputPath,
      outputSequence: reservation.sequence,
    }
    logApi('great_shots_output_reserved', reservationDetails)
    logScheduledJob('great_shots_output_reserved', reservationDetails)
    throwIfCancelled(signal)

    const rendered = await renderGreatShotsCommercial({
      outputPath: reservation.outputPath,
      clips,
      projectRoot,
      ffmpegPath,
      fontFile,
      resolveFontFileImpl,
      backgroundMusicFile,
      backgroundMusicVolume,
      resolveBackgroundMusicFileImpl,
      spawnImpl,
      ensureFfmpegImpl,
      autoDownloadFfmpeg,
      signal,
      correlationId,
      logApi,
      logScheduledJob,
    })
    throwIfCancelled(signal)

    const output = {
      fileName: path.basename(reservation.outputPath),
      relativePath: path.relative(projectRoot, reservation.outputPath).replace(/\\/g, '/'),
      durationSeconds: rendered.durationSeconds,
      resolution: `${rendered.width}x${rendered.height}`,
      bytes: rendered.bytes,
      outputSequence: reservation.sequence,
      selectionMode: greatShotsSelectionMode(clips),
      videos: clips.map((clip) => ({
        key: clip.key,
        provider: clip.provider,
        id: clip.id,
        category: clip.category,
        title: clip.title,
        author: clip.author,
        authorUrl: clip.authorUrl || null,
        license: clip.license,
        licenseUrl: clip.licenseUrl || null,
        sourcePageUrl: clip.sourcePageUrl,
        durationSeconds: clip.durationSeconds,
      })),
      pexelsVideoCount: clips.filter((clip) => clip.provider === 'Pexels').length,
      pexelsQuota: getLatestPexelsQuota(),
      backgroundMusic: rendered.backgroundMusic || null,
      completedInMs: Date.now() - startedAt,
    }
    logApi('great_shots_commercial_completed', { correlationId, jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID, ...output })
    logScheduledJob('great_shots_commercial_completed', { correlationId, jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID, ...output })
    return output
  } catch (error) {
    const pexelsQuota = getLatestPexelsQuota()
    if (pexelsQuota) error.output = { ...(error?.output && typeof error.output === 'object' ? error.output : {}), pexelsQuota }
    const details = {
      correlationId,
      jobId: GREAT_SHOTS_COMMERCIAL_JOB_ID,
      triggeredBy,
      level: 'error',
      errorName: error?.name || 'Error',
      errorCode: error?.code || null,
      errorMessage: error?.message || String(error),
      errorStack: error?.stack || null,
    }
    logError('Great-shots commercial job failed', { ...details, error })
    logApi('great_shots_commercial_failed', details)
    logScheduledJob('great_shots_commercial_failed', details)
    throw error
  } finally {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    if (reservation?.lockPath) await fs.rm(reservation.lockPath, { force: true }).catch(() => {})
  }
}
