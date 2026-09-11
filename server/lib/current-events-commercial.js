import fs from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn as nodeSpawn } from 'node:child_process'
import process from 'node:process'
import {
  ensureManagedFfmpeg,
  isManagedFfmpegAutoDownloadEnabled,
  resolveFfmpegPath,
} from './ffmpeg-runtime.js'
import {
  extractImageCandidates,
  prepareCurrentEventsVisuals,
} from './current-events-visuals.js'
import { getLatestPexelsQuota } from './pexels-api.js'

export const CURRENT_EVENTS_COMMERCIAL_JOB_ID = 'createShortFormCurrentEventsSmall'
export const CURRENT_EVENTS_COMMERCIAL_JOB_NAME = 'Create Short-form Current Events - Small'
export const CURRENT_EVENTS_COMMERCIAL_DURATION_SECONDS = 6

export const CURRENT_EVENTS_NEWS_SOURCES = Object.freeze([
  { id: 'golf-digest', name: 'Golf Digest', url: 'https://www.golfdigest.com/golf-news/' },
  { id: 'golf-com', name: 'GOLF.com', url: 'https://golf.com/news/' },
  {
    id: 'golf-channel',
    name: 'Golf Channel',
    url: 'https://www.golfchannel.com/news',
    // Golf Channel periodically rejects non-browser requests on /news. These are
    // same-publisher fallbacks so one protected endpoint does not remove the source.
    fallbackUrls: ['https://www.golfchannel.com/watch/live', 'https://www.golfchannel.com/golf-talk'],
  },
  { id: 'golfweek', name: 'Golfweek', url: 'https://golfweek.usatoday.com/' },
  { id: 'pga-tour', name: 'PGA TOUR News', url: 'https://www.pgatour.com/news' },
  { id: 'lpga', name: 'LPGA News', url: 'https://www.lpga.com/news' },
  { id: 'golf-monthly', name: 'Golf Monthly', url: 'https://www.golfmonthly.com/news' },
  { id: 'mygolfspy', name: 'MyGolfSpy', url: 'https://mygolfspy.com/news-opinion/' },
  { id: 'skratch-golf', name: 'Skratch Golf', url: 'https://www.skratch.golf/news/' },
  { id: 'no-laying-up', name: 'No Laying Up', url: 'https://nolayingup.com/' },
])

const KNOWN_GOLF_TOPICS = Object.freeze([
  'Solheim Cup',
  'Ryder Cup',
  'Walker Cup',
  'Presidents Cup',
  'FedEx Cup',
  'Tour Championship',
  'Irish Open',
  'U.S. Open',
  'US Open',
  'The Open Championship',
  'Open Championship',
  'PGA Championship',
  'Masters Tournament',
  'The Masters',
  'LIV Golf',
])

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'been', 'being', 'best', 'could', 'course', 'from', 'golf', 'golfer', 'golfers',
  'have', 'into', 'latest', 'more', 'news', 'over', 'player', 'players', 'review', 'said', 'that', 'their', 'there', 'these', 'this',
  'tour', 'tournament', 'under', 'what', 'when', 'where', 'which', 'while', 'with', 'your', 'video', 'watch', 'week', 'today',
])

const BRAND = Object.freeze({
  mission: 'GolfHomiez makes golf simple, social, and fun.',
  benefits: ['Track rounds', 'Challenge homiez', 'Play tournaments'],
})

function normalizedTimeoutMs(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= 1000 && parsed <= 60000 ? parsed : 10000
}

function abortError(message = 'Current-events commercial job was cancelled') {
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

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
}

function cleanHeadline(value) {
  return decodeHtmlEntities(String(value || '')
    .replace(/<!\[CDATA\[/gi, '')
    .replace(/\]\]>/g, '')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isUsefulHeadline(value) {
  if (value.length < 12 || value.length > 220) return false
  if (!/[A-Za-z]/.test(value)) return false
  if (/^(home|news|latest|menu|search|subscribe|sign in|log in|privacy|terms|cookies|more news)$/i.test(value)) return false
  if (/^(facebook|instagram|youtube|twitter|x|tiktok)$/i.test(value)) return false
  return true
}

export function extractHeadlineCandidates(html) {
  const source = String(html || '').slice(0, 750000)
  const candidates = []
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]*>/gi,
    /<title[^>]*>([\s\S]*?)<\/title>/gi,
    /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi,
    /<a[^>]*>([\s\S]*?)<\/a>/gi,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const cleaned = cleanHeadline(match[1])
      if (isUsefulHeadline(cleaned)) candidates.push(cleaned)
      if (candidates.length >= 120) break
    }
    if (candidates.length >= 120) break
  }

  return [...new Set(candidates)].slice(0, 80)
}

function sourceAbortSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

async function fetchNewsSource(source, { fetchImpl, timeoutMs, signal }) {
  throwIfCancelled(signal)
  const startedAt = Date.now()
  const urls = [...new Set([source.url, ...(source.fallbackUrls || [])].filter(Boolean))]
  const attempts = []
  let lastError = null

  for (const requestedUrl of urls) {
    throwIfCancelled(signal)
    try {
      const response = await fetchImpl(requestedUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: sourceAbortSignal(signal, timeoutMs),
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'Upgrade-Insecure-Requests': '1',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        },
      })
      attempts.push({ url: requestedUrl, statusCode: response?.status || null })
      if (!response?.ok) {
        const error = new Error(`${source.name} returned HTTP ${response?.status || 'unknown'} for ${requestedUrl}`)
        error.statusCode = response?.status || null
        error.requestedUrl = requestedUrl
        lastError = error
        continue
      }

      const html = (await response.text()).slice(0, 900000)
      const headlines = extractHeadlineCandidates(html)
      const images = extractImageCandidates(html, requestedUrl)
      return {
        ...source,
        statusCode: response.status,
        requestedUrl,
        attempts,
        durationMs: Date.now() - startedAt,
        headlines,
        images,
      }
    } catch (error) {
      if (signal?.aborted) throw error
      attempts.push({ url: requestedUrl, statusCode: error?.statusCode || null, error: error?.message || String(error) })
      error.requestedUrl ||= requestedUrl
      lastError = error
    }
  }

  const error = lastError || new Error(`${source.name} did not provide a usable response`)
  error.attempts = attempts
  throw error
}

export async function fetchCurrentGolfNews({
  sources = CURRENT_EVENTS_NEWS_SOURCES,
  fetchImpl = globalThis.fetch,
  timeoutMs = normalizedTimeoutMs(process.env.CURRENT_EVENTS_FETCH_TIMEOUT_MS),
  signal = null,
  correlationId = null,
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required to load current golf news')

  const results = await Promise.all(sources.map(async (source) => {
    const startedAt = Date.now()
    logApi('current_events_source_fetch_started', { correlationId, jobId: CURRENT_EVENTS_COMMERCIAL_JOB_ID, source: source.name, url: source.url })
    try {
      const fetched = await fetchNewsSource(source, { fetchImpl, timeoutMs, signal })
      const details = {
        correlationId,
        jobId: CURRENT_EVENTS_COMMERCIAL_JOB_ID,
        source: source.name,
        url: source.url,
        requestedUrl: fetched.requestedUrl || source.url,
        attempts: fetched.attempts || [],
        statusCode: fetched.statusCode,
        durationMs: fetched.durationMs,
        headlineCount: fetched.headlines.length,
        imageCandidateCount: fetched.images?.length || 0,
      }
      logApi('current_events_source_fetch_completed', details)
      logScheduledJob('current_events_source_fetch_completed', details)
      return { ok: true, ...fetched }
    } catch (error) {
      if (signal?.aborted) throw error
      const details = {
        correlationId,
        jobId: CURRENT_EVENTS_COMMERCIAL_JOB_ID,
        source: source.name,
        url: source.url,
        durationMs: Date.now() - startedAt,
        statusCode: error?.statusCode || null,
        requestedUrl: error?.requestedUrl || null,
        attempts: error?.attempts || [],
        error: error?.message || String(error),
      }
      logApi('current_events_source_fetch_failed', { ...details, level: 'warn' })
      logScheduledJob('current_events_source_fetch_failed', { ...details, level: 'warn' })
      if (!error?.statusCode || error.statusCode >= 500) {
        logError('Current-events source fetch failed', { ...details, error })
      }
      return { ok: false, ...source, headlines: [], images: [], attempts: error?.attempts || [], error: error?.message || String(error) }
    }
  }))

  throwIfCancelled(signal)
  return results
}

function normalizedTokens(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9.'-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^[.'-]+|[.'-]+$/g, ''))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token) && !/^\d+$/.test(token))
}

function genericTopicCandidates(headline) {
  const tokens = normalizedTokens(headline)
  const candidates = []
  for (const size of [2, 3]) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const words = tokens.slice(index, index + size)
      if (words.some((word) => STOP_WORDS.has(word))) continue
      const value = words.join(' ')
      if (/^(pga tour|lpga tour|golf club|golf channel)$/.test(value)) continue
      candidates.push(value)
    }
  }
  return candidates
}

function displayTopicFromKey(key) {
  const known = KNOWN_GOLF_TOPICS.find((topic) => topic.toLowerCase() === key.toLowerCase())
  if (known) return known === 'US Open' ? 'U.S. Open' : known
  return key.split(' ').map((word) => word.length <= 3 && /^[a-z]+$/.test(word) ? word.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ')
}

export function selectCommonGolfTopic(sourceResults = []) {
  const successful = sourceResults.filter((source) => source?.ok !== false && Array.isArray(source?.headlines) && source.headlines.length)
  const topics = new Map()

  const recordTopic = (key, sourceName, kind) => {
    const normalized = key.toLowerCase()
    const entry = topics.get(normalized) || { key, kind, sources: new Set(), occurrences: 0 }
    entry.sources.add(sourceName)
    entry.occurrences += 1
    if (kind === 'known') entry.kind = 'known'
    topics.set(normalized, entry)
  }

  for (const source of successful) {
    const sourceText = source.headlines.join('\n')
    for (const topic of KNOWN_GOLF_TOPICS) {
      const matches = sourceText.match(new RegExp(topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []
      matches.forEach(() => recordTopic(topic, source.name, 'known'))
    }

    const seenGenericForSource = new Set()
    for (const headline of source.headlines.slice(0, 40)) {
      for (const candidate of genericTopicCandidates(headline)) {
        if (seenGenericForSource.has(candidate)) continue
        seenGenericForSource.add(candidate)
        recordTopic(candidate, source.name, 'generic')
      }
    }
  }

  const ranked = [...topics.values()]
    .filter((entry) => entry.sources.size >= 2)
    .sort((a, b) => {
      const knownDiff = Number(b.kind === 'known') - Number(a.kind === 'known')
      if (knownDiff) return knownDiff
      const sourceDiff = b.sources.size - a.sources.size
      if (sourceDiff) return sourceDiff
      return b.occurrences - a.occurrences
    })

  const best = ranked[0]
  if (!best) return null
  return {
    label: displayTopicFromKey(best.key),
    sourceCount: best.sources.size,
    sourceNames: [...best.sources].sort(),
    kind: best.kind,
  }
}

function trimCopy(value, max = 72) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 3)).replace(/\s+\S*$/, '')}...`
}

export function buildCurrentEventsCommercialCopy(topic = null) {
  const topicLabel = topic?.label ? trimCopy(topic.label, 42) : null
  return {
    hook: topicLabel ? `${topicLabel}: everybody's talking.` : 'Golf is better when the story keeps moving.',
    punchline: topicLabel ? 'Who are your homiez taking? Make the next headline yours.' : 'Call the homiez. Pick a course. Make something worth replaying.',
    cta: `Track rounds. Challenge homiez. Keep the memories. GolfHomiez.`,
    brandLine: BRAND.mission,
  }
}

function dateStamp(date) {
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) throw new Error('Commercial output date is invalid')
  return value.toISOString().slice(0, 10)
}

export function buildCurrentEventsCommercialOutputPath({ now = new Date(), projectRoot = process.cwd() } = {}) {
  return path.join(projectRoot, 'jobs', 'commercials', `${CURRENT_EVENTS_COMMERCIAL_JOB_NAME} - ${dateStamp(now)}.mp4`)
}

export async function reserveCurrentEventsCommercialOutputPath({ now = new Date(), projectRoot = process.cwd(), maxAttempts = 1000 } = {}) {
  const basePath = buildCurrentEventsCommercialOutputPath({ now, projectRoot })
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

  const error = new Error(`Unable to reserve a unique commercial output name after ${maxAttempts} attempts`)
  error.code = 'COMMERCIAL_OUTPUT_RESERVATION_FAILED'
  throw error
}

function wrapText(value, maxChars = 24) {
  const words = String(value || '').split(/\s+/).filter(Boolean)
  const lines = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 4).join('\n')
}

function currentEventsFontCandidates() {
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

export async function resolveCurrentEventsFontFile({
  configuredPath = process.env.CURRENT_EVENTS_FONT_FILE || process.env.GREAT_SHOTS_FONT_FILE || null,
  projectRoot = process.cwd(),
} = {}) {
  const candidates = []
  if (configuredPath) candidates.push(path.isAbsolute(configuredPath) ? configuredPath : path.resolve(projectRoot, configuredPath))
  candidates.push(...currentEventsFontCandidates())

  for (const candidatePath of candidates) {
    try {
      await fs.access(candidatePath, fsConstants.R_OK)
      return candidatePath
    } catch {
      // Try the next platform font. Explicit font files avoid ffmpeg/fontconfig failures.
    }
  }

  const error = new Error('A readable TrueType/OpenType font is required for the current-events commercial. Set CURRENT_EVENTS_FONT_FILE to a local font file.')
  error.code = 'CURRENT_EVENTS_FONT_NOT_FOUND'
  throw error
}

function filterPath(filePath, projectRoot) {
  const relative = path.relative(projectRoot, filePath) || path.basename(filePath)
  return relative.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

async function runProcess(command, args, { spawnImpl = nodeSpawn, signal = null, correlationId = null, logApi = () => {}, logScheduledJob = () => {}, cwd = process.cwd() } = {}) {
  throwIfCancelled(signal)
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    const onAbort = () => {
      try { child.kill('SIGTERM') } catch { /* best-effort cancellation */ }
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
        jobId: CURRENT_EVENTS_COMMERCIAL_JOB_ID,
        exitCode: code,
        processSignal,
        stderr: stderr.slice(-1200),
        error: error.message,
        level: 'error',
      }
      logApi('current_events_ffmpeg_failed', failedDetails)
      logScheduledJob('current_events_ffmpeg_failed', failedDetails)
      reject(error)
    })
  })
}

export async function renderCurrentEventsCommercial({
  outputPath,
  copy,
  sourceResults = [],
  topic = null,
  projectRoot = process.cwd(),
  ffmpegPath = process.env.FFMPEG_PATH || null,
  fontFile = process.env.CURRENT_EVENTS_FONT_FILE || process.env.GREAT_SHOTS_FONT_FILE || null,
  resolveFontFileImpl = resolveCurrentEventsFontFile,
  fetchImpl = globalThis.fetch,
  spawnImpl = nodeSpawn,
  ensureFfmpegImpl = ensureManagedFfmpeg,
  autoDownloadFfmpeg = isManagedFfmpegAutoDownloadEnabled(),
  signal = null,
  correlationId = null,
  logApi = () => {},
  logScheduledJob = () => {},
} = {}) {
  if (!outputPath) throw new Error('Commercial output path is required')
  const outputDir = path.dirname(outputPath)
  await fs.mkdir(outputDir, { recursive: true })
  const tempDir = path.join(projectRoot, 'jobs', 'commercials', `.tmp-${randomUUID()}`)
  await fs.mkdir(tempDir, { recursive: true })

  const textFiles = {
    hook: path.join(tempDir, 'hook.txt'),
    punchline: path.join(tempDir, 'punchline.txt'),
    cta: path.join(tempDir, 'cta.txt'),
  }
  const emblemPath = path.join(projectRoot, 'src', 'assets', 'GolfHomiezEmblem.png')
  const renderPath = path.join(tempDir, 'commercial.mp4')

  try {
    await fs.access(emblemPath)
    await Promise.all([
      fs.writeFile(textFiles.hook, wrapText(copy.hook, 22), 'utf8'),
      fs.writeFile(textFiles.punchline, wrapText(copy.punchline, 24), 'utf8'),
      fs.writeFile(textFiles.cta, wrapText(copy.cta, 24), 'utf8'),
    ])

    const visuals = await prepareCurrentEventsVisuals({
      sourceResults,
      topic,
      tempDir,
      fetchImpl,
      signal,
      correlationId,
      maxVisuals: 3,
      logApi,
      logScheduledJob,
    })
    if (visuals.length !== 3) throw new Error('Three current-events visual assets are required to render the commercial')

    const sourceFiles = await Promise.all(visuals.map(async (visual, index) => {
      const file = path.join(tempDir, `source-${index + 1}.txt`)
      const label = visual.origin === 'pexels'
        ? `Pexels • ${visual.creator || 'golf creator'}`
        : visual.origin === 'website'
          ? `Golf buzz • ${visual.sourceName}`
          : 'GolfHomiez • golf, homiez & good times'
      await fs.writeFile(file, trimCopy(label, 45), 'utf8')
      return file
    }))

    const hookFile = filterPath(textFiles.hook, projectRoot)
    const punchlineFile = filterPath(textFiles.punchline, projectRoot)
    const ctaFile = filterPath(textFiles.cta, projectRoot)
    const sourceLabels = sourceFiles.map((file) => filterPath(file, projectRoot))
    const resolvedFontFile = await resolveFontFileImpl({ configuredPath: fontFile, projectRoot })
    const ffmpegFont = filterPath(resolvedFontFile, projectRoot)
    const fontOption = `fontfile='${ffmpegFont}':`

    const sceneFilters = visuals.map((visual, index) => {
      const input = index
      const labelFile = sourceLabels[index]
      const messageFile = index === 0 ? hookFile : index === 1 ? punchlineFile : ctaFile
      const fontSize = index === 0 ? 58 : index === 1 ? 46 : 47
      const y = index === 0 ? 760 : index === 1 ? 720 : 735
      const sceneHeading = ['TRENDING NOW', 'MAKE IT YOURS', 'TEE IT UP'][index]
      const mediaFilter = visual.mediaType === 'video'
        ? `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30,tpad=stop_mode=clone:stop_duration=2,trim=duration=2,setpts=PTS-STARTPTS`
        : `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,zoompan=z='min(zoom+0.0012,1.075)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=30,trim=duration=2,setpts=PTS-STARTPTS`
      return `[${input}:v]${mediaFilter},drawbox=x=0:y=0:w=iw:h=ih:color=black@0.23:t=fill,drawbox=x=34:y=680:w=652:h=430:color=0x071d13@0.72:t=fill,drawbox=x=34:y=680:w=10:h=430:color=0xF6BE36@1:t=fill,drawtext=${fontOption}text='${sceneHeading}':fontcolor=0xF6BE36:fontsize=26:x=62:y=708,drawtext=${fontOption}textfile='${messageFile}':fontcolor=white:fontsize=${fontSize}:line_spacing=12:x=62:y=${y},drawtext=${fontOption}textfile='${labelFile}':fontcolor=white@0.82:fontsize=24:x=62:y=1064[scene${index}]`
    })

    const filterComplex = [
      ...sceneFilters,
      '[scene0][scene1][scene2]concat=n=3:v=1:a=0[story]',
      '[3:v]scale=180:-1[logo]',
      `[story][logo]overlay=W-w-36:42:format=auto,drawbox=x=0:y=1182:w=iw:h=98:color=0x071d13@0.88:t=fill,drawtext=${fontOption}text='YOUR ROUND. YOUR STORY.':fontcolor=0xF6BE36:fontsize=24:x=(W-text_w)/2:y=1195,drawtext=${fontOption}text='golfhomiez.com':fontcolor=white:fontsize=30:x=(W-text_w)/2:y=1231[vout]`,
    ].join(';')

    const args = []
    for (const visual of visuals) {
      if (visual.mediaType === 'video') args.push('-i', visual.path)
      else args.push('-loop', '1', '-i', visual.path)
    }
    args.push('-loop', '1', '-i', emblemPath)
    args.push(
      '-filter_complex', filterComplex,
      '-map', '[vout]',
      '-t', String(CURRENT_EVENTS_COMMERCIAL_DURATION_SECONDS),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      '-y',
      renderPath,
    )

    let resolvedFfmpegPath = resolveFfmpegPath({ projectRoot, configuredPath: ffmpegPath })
    const pexelsVisuals = visuals.filter((visual) => visual.origin === 'pexels')
    const visualDetails = {
      websiteImageCount: visuals.filter((visual) => visual.origin === 'website').length,
      generatedVisualCount: visuals.filter((visual) => visual.origin === 'generated').length,
      pexelsVisualCount: pexelsVisuals.length,
      pexelsPhotoCount: pexelsVisuals.filter((visual) => visual.mediaType !== 'video').length,
      pexelsVideoCount: pexelsVisuals.filter((visual) => visual.mediaType === 'video').length,
      pexelsAttribution: pexelsVisuals.map((visual) => ({
        id: visual.pexelsId || null,
        creator: visual.creator || null,
        creatorUrl: visual.creatorUrl || null,
        sourcePageUrl: visual.sourcePageUrl || null,
        mediaType: visual.mediaType || 'image',
      })),
      visualSources: visuals.map((visual) => visual.sourceName),
      fontFile: resolvedFontFile,
    }
    const ffmpegStartDetails = { correlationId, jobId: CURRENT_EVENTS_COMMERCIAL_JOB_ID, ffmpegPath: resolvedFfmpegPath, outputPath, durationSeconds: CURRENT_EVENTS_COMMERCIAL_DURATION_SECONDS, ...visualDetails }
    logApi('current_events_ffmpeg_started', ffmpegStartDetails)
    logScheduledJob('current_events_ffmpeg_started', ffmpegStartDetails)
    try {
      await runProcess(resolvedFfmpegPath, args, { spawnImpl, signal, correlationId, logApi, logScheduledJob, cwd: projectRoot })
    } catch (error) {
      if (error?.code !== 'ENOENT' || !autoDownloadFfmpeg) throw error

      const fallbackDetails = {
        correlationId,
        jobId: CURRENT_EVENTS_COMMERCIAL_JOB_ID,
        missingFfmpegPath: resolvedFfmpegPath,
        reason: error?.message || String(error),
      }
      logApi('current_events_ffmpeg_missing_auto_setup_started', { ...fallbackDetails, level: 'warn' })
      logScheduledJob('current_events_ffmpeg_missing_auto_setup_started', { ...fallbackDetails, level: 'warn' })
      resolvedFfmpegPath = await ensureFfmpegImpl({
        projectRoot,
        signal,
        correlationId,
        logApi,
        logScheduledJob,
      })
      logApi('current_events_ffmpeg_auto_setup_completed', { correlationId, jobId: CURRENT_EVENTS_COMMERCIAL_JOB_ID, ffmpegPath: resolvedFfmpegPath })
      await runProcess(resolvedFfmpegPath, args, { spawnImpl, signal, correlationId, logApi, logScheduledJob, cwd: projectRoot })
    }

    await fs.copyFile(renderPath, outputPath, fsConstants.COPYFILE_EXCL)
    const stats = await fs.stat(outputPath)
    const details = {
      correlationId,
      jobId: CURRENT_EVENTS_COMMERCIAL_JOB_ID,
      outputPath,
      bytes: stats.size,
      durationSeconds: CURRENT_EVENTS_COMMERCIAL_DURATION_SECONDS,
      width: 720,
      height: 1280,
      ...visualDetails,
    }
    logApi('current_events_ffmpeg_completed', details)
    logScheduledJob('current_events_ffmpeg_completed', details)
    return details
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const wrapped = new Error(`ffmpeg is required to create the commercial. Automatic setup was unavailable or disabled; install ffmpeg or set FFMPEG_PATH to the executable. (${error.message})`)
      wrapped.code = 'FFMPEG_NOT_FOUND'
      throw wrapped
    }
    throw error
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function runCreateShortFormCurrentEventsSmall({
  correlationId = `current-events-commercial-${randomUUID()}`,
  triggeredBy = 'manual',
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
  signal = null,
  fetchImpl = globalThis.fetch,
  sources = CURRENT_EVENTS_NEWS_SOURCES,
  sourceResults = null,
  spawnImpl = nodeSpawn,
  ffmpegPath = process.env.FFMPEG_PATH || null,
  fontFile = process.env.CURRENT_EVENTS_FONT_FILE || process.env.GREAT_SHOTS_FONT_FILE || null,
  resolveFontFileImpl = resolveCurrentEventsFontFile,
  ensureFfmpegImpl = ensureManagedFfmpeg,
  autoDownloadFfmpeg = isManagedFfmpegAutoDownloadEnabled(),
  projectRoot = process.cwd(),
  now = new Date(),
} = {}) {
  const startedAt = Date.now()
  const startDetails = {
    correlationId,
    jobId: CURRENT_EVENTS_COMMERCIAL_JOB_ID,
    jobName: CURRENT_EVENTS_COMMERCIAL_JOB_NAME,
    triggeredBy,
    sourceCount: sources.length,
  }
  logApi('current_events_commercial_started', startDetails)
  logScheduledJob('current_events_commercial_started', startDetails)

  let reservation = null
  try {
    throwIfCancelled(signal)
    const newsResults = sourceResults || await fetchCurrentGolfNews({
      sources,
      fetchImpl,
      signal,
      correlationId,
      logApi,
      logError,
      logScheduledJob,
    })
    throwIfCancelled(signal)

    const topic = selectCommonGolfTopic(newsResults)
    const copy = buildCurrentEventsCommercialCopy(topic)
    reservation = await reserveCurrentEventsCommercialOutputPath({ now, projectRoot })
    const outputPath = reservation.outputPath
    const reservationDetails = {
      correlationId,
      jobId: CURRENT_EVENTS_COMMERCIAL_JOB_ID,
      outputPath,
      outputSequence: reservation.sequence,
    }
    logApi('current_events_output_reserved', reservationDetails)
    logScheduledJob('current_events_output_reserved', reservationDetails)
    const successfulSources = newsResults.filter((source) => source?.ok !== false && Array.isArray(source?.headlines) && source.headlines.length)
    const failedSources = newsResults.filter((source) => source?.ok === false)

    logApi('current_events_topic_selected', {
      correlationId,
      jobId: CURRENT_EVENTS_COMMERCIAL_JOB_ID,
      topic: topic?.label || null,
      topicSourceCount: topic?.sourceCount || 0,
      topicSources: topic?.sourceNames || [],
      fallbackToGolfHomiezTheme: !topic,
      outputSequence: reservation.sequence,
      outputPath,
      successfulSourceCount: successfulSources.length,
      failedSourceCount: failedSources.length,
    })

    const rendered = await renderCurrentEventsCommercial({
      outputPath,
      copy,
      sourceResults: newsResults,
      topic,
      projectRoot,
      ffmpegPath,
      fontFile,
      resolveFontFileImpl,
      fetchImpl,
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
      fileName: path.basename(outputPath),
      relativePath: path.relative(projectRoot, outputPath).replace(/\\/g, '/'),
      durationSeconds: rendered.durationSeconds,
      resolution: `${rendered.width}x${rendered.height}`,
      bytes: rendered.bytes,
      topic: topic?.label || null,
      topicSourceCount: topic?.sourceCount || 0,
      topicSources: topic?.sourceNames || [],
      successfulSourceCount: successfulSources.length,
      failedSources: failedSources.map((source) => source.name),
      usedGolfHomiezFallback: !topic,
      websiteImageCount: rendered.websiteImageCount,
      generatedVisualCount: rendered.generatedVisualCount,
      pexelsVisualCount: rendered.pexelsVisualCount || 0,
      pexelsPhotoCount: rendered.pexelsPhotoCount || 0,
      pexelsVideoCount: rendered.pexelsVideoCount || 0,
      pexelsAttribution: rendered.pexelsAttribution || [],
      pexelsQuota: getLatestPexelsQuota(),
      visualSources: rendered.visualSources,
      outputSequence: reservation.sequence,
      completedInMs: Date.now() - startedAt,
    }
    logApi('current_events_commercial_completed', { correlationId, jobId: CURRENT_EVENTS_COMMERCIAL_JOB_ID, ...output })
    logScheduledJob('current_events_commercial_completed', { correlationId, jobId: CURRENT_EVENTS_COMMERCIAL_JOB_ID, ...output })
    return output
  } catch (error) {
    const pexelsQuota = getLatestPexelsQuota()
    if (pexelsQuota) error.output = { ...(error?.output && typeof error.output === 'object' ? error.output : {}), pexelsQuota }
    const failureDetails = {
      correlationId,
      jobId: CURRENT_EVENTS_COMMERCIAL_JOB_ID,
      triggeredBy,
      level: 'error',
      errorName: error?.name || 'Error',
      errorCode: error?.code || null,
      errorMessage: error?.message || String(error),
      errorStack: error?.stack || null,
    }
    logError('Current-events commercial job failed', { ...failureDetails, error })
    logApi('current_events_commercial_failed', failureDetails)
    logScheduledJob('current_events_commercial_failed', failureDetails)
    throw error
  } finally {
    if (reservation?.lockPath) await fs.rm(reservation.lockPath, { force: true }).catch(() => {})
  }
}
