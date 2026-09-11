import fs from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { spawn as nodeSpawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import {
  ensureManagedFfmpeg,
  isManagedFfmpegAutoDownloadEnabled,
  resolveFfmpegPath,
} from './ffmpeg-runtime.js'
import { fetchPexelsJson, getLatestPexelsQuota, pexelsApiKey } from './pexels-api.js'
import { parsePexelsVideoResults, resolveGreatShotsFontFile } from './great-shots-commercial.js'
import {
  backgroundMusicMetadata,
  commercialBackgroundMusicVolume,
  resolveCommercialBackgroundMusicFile,
} from './commercial-background-music.js'

export const FUNNY_SHOTS_COMMERCIAL_JOB_ID = 'createShortFormFunnyShotsSmall'
export const FUNNY_SHOTS_COMMERCIAL_JOB_NAME = 'Create Short-form Funny Shots - Small'
export const FUNNY_SHOTS_COMMERCIAL_FILE_TAG = 'FunnyShotShort'
export const FUNNY_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS = 30

const MIN_SOURCE_DURATION_SECONDS = 2
const DEFAULT_FETCH_TIMEOUT_MS = 15000
const DEFAULT_VIDEO_TIMEOUT_MS = 30000
const DEFAULT_MAX_VIDEO_BYTES = 60 * 1024 * 1024
const MAX_HISTORY_RUNS = 2000
const PEXELS_RESULTS_PER_QUERY = 50
const PEXELS_VIDEO_SEARCH_URL = 'https://api.pexels.com/v1/videos/search'

const FUNNY_PEXELS_QUERIES = Object.freeze([
  'funny golf fail golfer',
  'golfer misses ball funny',
  'funny golf swing golfer',
  'golf shank funny golfer',
  'funny golf trick shot',
  'golfer funny reaction shot',
])

const GOLF_RE = /\b(?:golf|golfer|golfing|tee|fairway|putt|putting|chip|bunker|golf club|golf ball)\b/i
const ACTION_RE = /\b(?:swing|shot|hit|hits|hitting|drive|driving|tee shot|putt|putting|chip|chipping|miss|misses|missed|shank|duff|slice|hook|trick shot|bounce|bank)\b/i
const PERSON_RE = /\b(?:golfer|player|man|woman|boy|girl|kid|child|person|amateur|professional|senior)\b/i
const FUNNY_RE = /\b(?:funny|hilarious|laugh|laughing|fail|fails|failed|miss|misses|missed|shank|duff|oops|awkward|wild|crazy|ridiculous|unexpected|reaction|trick shot|bounce|bank)\b/i
const REJECT_RE = /\b(?:drone|flyover|course tour|empty course|animation|animated|video game|gameplay|virtual reality|simulator|simulation|podcast|interview|press conference|equipment review|club review|product review|lesson|tutorial|instruction|documentary|trailer|advertisement|promo)\b/i

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

function fetchTimeoutMs() {
  return boundedInteger(process.env.FUNNY_SHOTS_FETCH_TIMEOUT_MS, DEFAULT_FETCH_TIMEOUT_MS, 1000, 60000)
}

function videoTimeoutMs() {
  return boundedInteger(process.env.FUNNY_SHOTS_VIDEO_TIMEOUT_MS, DEFAULT_VIDEO_TIMEOUT_MS, 1000, 120000)
}

function maxVideoBytes() {
  return boundedInteger(process.env.FUNNY_SHOTS_MAX_VIDEO_BYTES, DEFAULT_MAX_VIDEO_BYTES, 1_000_000, 150_000_000)
}

function sourceAbortSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

function throwIfCancelled(signal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) {
    if (!reason.code) reason.code = 'SCHEDULED_JOB_CANCELLED'
    throw reason
  }
  const error = new Error('Funny-shots commercial job was cancelled')
  error.code = 'SCHEDULED_JOB_CANCELLED'
  throw error
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function candidateText(candidate) {
  return stripHtml([candidate?.title, candidate?.description, candidate?.query].filter(Boolean).join(' '))
}

function knownDuration(candidate) {
  const value = Number(candidate?.durationSeconds || 0)
  return Number.isFinite(value) && value > 0 ? value : null
}

export function isFunnyShotVideoCandidate(candidate) {
  if (!candidate?.key || candidate?.provider !== 'Pexels' || !candidate?.downloadUrl) return false
  const text = candidateText(candidate)
  if (!text || REJECT_RE.test(text)) return false
  if (!GOLF_RE.test(text) || !ACTION_RE.test(text) || !PERSON_RE.test(text) || !FUNNY_RE.test(text)) return false
  const duration = knownDuration(candidate)
  if (duration !== null && (duration < MIN_SOURCE_DURATION_SECONDS || duration > FUNNY_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS)) return false
  return true
}

function candidateScore(candidate) {
  const text = candidateText(candidate)
  const duration = knownDuration(candidate)
  const portrait = Number(candidate?.height || 0) >= Number(candidate?.width || 0) && Number(candidate?.height || 0) > 0 ? 25 : 0
  const short = duration !== null && duration <= 12 ? 20 : duration !== null && duration <= 20 ? 15 : 8
  const explicitFunny = FUNNY_RE.test(stripHtml([candidate?.title, candidate?.description].filter(Boolean).join(' '))) ? 30 : 10
  const action = ACTION_RE.test(text) ? 15 : 0
  return portrait + short + explicitFunny + action
}

export async function fetchFunnyShotCandidates({
  fetchImpl = globalThis.fetch,
  signal = null,
  correlationId = null,
  logApi = () => {},
  logScheduledJob = () => {},
} = {}) {
  if (!pexelsApiKey()) {
    const error = new Error('PEXELS_API_KEY is required for the Funny Shots scheduled job')
    error.code = 'PEXELS_API_KEY_MISSING'
    throw error
  }

  const output = []
  for (const query of FUNNY_PEXELS_QUERIES) {
    throwIfCancelled(signal)
    const startedAt = Date.now()
    try {
      const url = new URL(PEXELS_VIDEO_SEARCH_URL)
      url.searchParams.set('query', query)
      url.searchParams.set('per_page', String(PEXELS_RESULTS_PER_QUERY))
      url.searchParams.set('orientation', 'portrait')
      const { payload } = await fetchPexelsJson(url.toString(), {
        fetchImpl,
        signal,
        timeoutMs: fetchTimeoutMs(),
        jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID,
        correlationId,
        logApi,
        logScheduledJob,
      })
      const parsed = parsePexelsVideoResults(payload, 'amateur', query)
        .map((candidate) => ({ ...candidate, category: 'funny', categories: ['funny'] }))
        .filter(isFunnyShotVideoCandidate)
      output.push(...parsed)
      const details = { correlationId, jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID, provider: 'Pexels', query, candidateCount: parsed.length, durationMs: Date.now() - startedAt }
      logApi('funny_shots_source_fetch_completed', details)
      logScheduledJob('funny_shots_source_fetch_completed', details)
    } catch (error) {
      if (signal?.aborted) throw error
      const details = { correlationId, jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID, provider: 'Pexels', query, errorCode: error?.code || null, errorMessage: error?.message || String(error), durationMs: Date.now() - startedAt, level: 'warn' }
      logApi('funny_shots_source_fetch_failed', details)
      logScheduledJob('funny_shots_source_fetch_failed', details)
      if (error?.code === 'PEXELS_RATE_LIMITED' || error?.statusCode === 401 || error?.statusCode === 403) throw error
    }
  }

  const deduped = new Map()
  for (const candidate of output) {
    const previous = deduped.get(candidate.key)
    if (!previous || candidateScore(candidate) > candidateScore(previous)) deduped.set(candidate.key, candidate)
  }
  return [...deduped.values()].sort((a, b) => candidateScore(b) - candidateScore(a) || a.key.localeCompare(b.key))
}

export function parseUsedFunnyShotKeys(rows = []) {
  const keys = new Set()
  for (const row of rows) {
    let output = row?.output_json ?? row?.outputJson ?? row?.output
    if (typeof output === 'string') {
      try { output = JSON.parse(output) } catch { output = null }
    }
    for (const video of Array.isArray(output?.videos) ? output.videos : []) {
      if (video?.key) keys.add(String(video.key))
    }
  }
  return keys
}

export async function loadPreviouslyUsedFunnyShotKeys(pool) {
  if (!pool?.query) return new Set()
  const [rows] = await pool.query(
    `SELECT output_json FROM scheduled_job_runs WHERE job_id = ? AND status = 'success' AND output_json IS NOT NULL ORDER BY completed_at DESC, started_at DESC LIMIT ${MAX_HISTORY_RUNS}`,
    [FUNNY_SHOTS_COMMERCIAL_JOB_ID],
  )
  return parseUsedFunnyShotKeys(Array.isArray(rows) ? rows : [])
}

export function selectFunnyShotVideos(candidates = [], usedKeys = new Set()) {
  const available = candidates
    .filter((candidate) => !usedKeys.has(candidate?.key))
    .filter(isFunnyShotVideoCandidate)
    .sort((a, b) => candidateScore(b) - candidateScore(a) || a.key.localeCompare(b.key))

  if (!available.length) {
    const error = new Error('No unused Pexels funny golf-shot video could be found. The video must show a person hitting or reacting to a funny golf shot and must be 30 seconds or less.')
    error.code = 'FUNNY_SHOT_VIDEO_UNAVAILABLE'
    throw error
  }

  for (let i = 0; i < available.length; i += 1) {
    const firstDuration = knownDuration(available[i])
    if (firstDuration == null) continue
    for (let j = i + 1; j < available.length; j += 1) {
      const secondDuration = knownDuration(available[j])
      if (secondDuration == null) continue
      if (firstDuration + secondDuration <= FUNNY_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS) {
        return [{ ...available[i], category: 'funny' }, { ...available[j], category: 'funny' }]
      }
    }
  }
  return [{ ...available[0], category: 'funny' }]
}

function extensionForVideo(contentType, url) {
  const type = String(contentType || '').toLowerCase()
  if (type.includes('mp4')) return '.mp4'
  if (type.includes('webm')) return '.webm'
  if (type.includes('ogg')) return '.ogv'
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase()
    if (['.mp4', '.webm', '.ogv', '.ogg', '.m4v', '.mov'].includes(ext)) return ext === '.ogg' ? '.ogv' : ext
  } catch {
    // Ignore malformed URL here; the caller will report unsupported media.
  }
  return null
}

export async function downloadFunnyShotVideo(candidate, {
  tempDir,
  fetchImpl = globalThis.fetch,
  signal = null,
  correlationId = null,
  logApi = () => {},
  logScheduledJob = () => {},
} = {}) {
  if (!candidate?.downloadUrl || !tempDir) throw new Error('Funny-shot candidate download URL and temporary directory are required')
  throwIfCancelled(signal)
  const startedAt = Date.now()
  const response = await fetchImpl(candidate.downloadUrl, {
    method: 'GET',
    redirect: 'follow',
    signal: sourceAbortSignal(signal, videoTimeoutMs()),
    headers: {
      Accept: 'video/mp4,video/webm,video/*;q=0.9,*/*;q=0.5',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'GolfHomiez/1.0 (+https://golfhomiez.com)',
      Referer: candidate.sourcePageUrl,
    },
  })
  if (!response?.ok) {
    const error = new Error(`Pexels video download returned HTTP ${response?.status || 'unknown'}`)
    error.code = 'FUNNY_SHOT_VIDEO_DOWNLOAD_FAILED'
    throw error
  }
  const advertised = Number.parseInt(response.headers?.get?.('content-length') || '0', 10)
  if (Number.isFinite(advertised) && advertised > maxVideoBytes()) throw new Error(`Funny-shot video exceeds ${maxVideoBytes()} byte limit`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length || buffer.length > maxVideoBytes()) throw new Error('Funny-shot video is empty or exceeds the configured byte limit')
  const contentType = response.headers?.get?.('content-type') || ''
  const extension = extensionForVideo(contentType, candidate.downloadUrl)
  if (!extension) throw new Error(`Unsupported funny-shot video content type: ${contentType || 'unknown'}`)
  const safeId = String(candidate.id || randomUUID()).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(-48)
  const localPath = path.join(tempDir, `funny-pexels-${safeId}${extension}`)
  await fs.writeFile(localPath, buffer)
  const details = { correlationId, jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID, videoKey: candidate.key, provider: 'Pexels', sourcePageUrl: candidate.sourcePageUrl, bytes: buffer.length, contentType, durationMs: Date.now() - startedAt }
  logApi('funny_shots_video_download_completed', details)
  logScheduledJob('funny_shots_video_download_completed', details)
  return { ...candidate, localPath, downloadedBytes: buffer.length }
}

export function parseFfmpegDurationText(value) {
  const match = String(value || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i)
  if (!match) return null
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

function spawnCapture(executable, args, { spawnImpl = nodeSpawn, signal = null, cwd = process.cwd() } = {}) {
  throwIfCancelled(signal)
  return new Promise((resolve, reject) => {
    let child
    try { child = spawnImpl(executable, args, { cwd, windowsHide: true }) } catch (error) { reject(error); return }
    let stdout = ''
    let stderr = ''
    let settled = false
    const cleanup = () => signal?.removeEventListener?.('abort', onAbort)
    const finishReject = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => {
      try { child.kill?.('SIGTERM') } catch { /* best effort */ }
      const error = new Error('Funny-shots ffmpeg process was cancelled')
      error.code = 'SCHEDULED_JOB_CANCELLED'
      finishReject(error)
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on?.('data', (chunk) => { stdout += String(chunk) })
    child.stderr?.on?.('data', (chunk) => { stderr += String(chunk) })
    child.once('error', finishReject)
    child.once('close', (code) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ code, stdout, stderr })
    })
  })
}

export async function probeFunnyShotVideoDuration(candidate, {
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
  if (!candidate?.localPath) throw new Error('Downloaded funny-shot video is required for duration validation')
  let executable = resolveFfmpegPath({ projectRoot, configuredPath: ffmpegPath })
  let result
  try {
    result = await spawnCapture(executable, ['-hide_banner', '-i', candidate.localPath, '-f', 'null', '-'], { spawnImpl, signal, cwd: projectRoot })
  } catch (error) {
    if (error?.code !== 'ENOENT' || !autoDownloadFfmpeg) throw error
    executable = await ensureFfmpegImpl({ projectRoot, signal, correlationId, logApi, logScheduledJob })
    result = await spawnCapture(executable, ['-hide_banner', '-i', candidate.localPath, '-f', 'null', '-'], { spawnImpl, signal, cwd: projectRoot })
  }
  const durationSeconds = parseFfmpegDurationText(`${result.stderr}\n${result.stdout}`)
  if (!durationSeconds) {
    const error = new Error('Unable to determine funny-shot video duration from ffmpeg metadata')
    error.code = 'FUNNY_SHOT_DURATION_UNKNOWN'
    throw error
  }
  const details = { correlationId, jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID, videoKey: candidate.key, durationSeconds: Number(durationSeconds.toFixed(3)) }
  logApi('funny_shots_video_duration_validated', details)
  logScheduledJob('funny_shots_video_duration_validated', details)
  return durationSeconds
}

function funnyCommercialDuration(clips) {
  const duration = clips.reduce((total, clip) => total + Number(clip.durationSeconds || 0), 0)
  if (!Number.isFinite(duration) || duration <= 0 || duration > FUNNY_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS + 0.05) throw new Error('Funny-shot commercial duration is invalid')
  return Number(duration.toFixed(3))
}

function filterPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

function attributionFor(clip) {
  return `Pexels · ${String(clip?.author || 'Pexels creator').replace(/[\r\n]+/g, ' ').trim()} · Pexels License`
}

async function runFfmpeg(executable, args, options) {
  const result = await spawnCapture(executable, args, options)
  if (result.code !== 0) {
    const error = new Error(`ffmpeg exited with code ${result.code ?? 'unknown'}${result.stderr ? `: ${result.stderr.slice(-900)}` : ''}`)
    error.code = 'FFMPEG_FAILED'
    throw error
  }
  return result
}

export async function renderFunnyShotsCommercial({
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
  if (!outputPath) throw new Error('Funny-shots commercial output path is required')
  if (!Array.isArray(clips) || clips.length < 1 || clips.length > 2 || clips.some((clip) => !clip?.localPath || !clip?.durationSeconds)) throw new Error('One or two validated funny-shot clips are required')
  const outputDir = path.dirname(outputPath)
  await fs.mkdir(outputDir, { recursive: true })
  const tempDir = path.join(projectRoot, 'jobs', 'commercials', `.tmp-funny-shots-${randomUUID()}`)
  await fs.mkdir(tempDir, { recursive: true })
  const renderPath = path.join(tempDir, 'commercial.mp4')
  const emblemPath = path.join(projectRoot, 'src', 'assets', 'GolfHomiezEmblem.png')

  try {
    await fs.access(emblemPath)
    const commercialDuration = funnyCommercialDuration(clips)
    const ctaStart = Math.max(0, commercialDuration - 3)
    const resolvedFontFile = await resolveFontFileImpl({ configuredPath: fontFile, projectRoot })
    const resolvedBackgroundMusicFile = await resolveBackgroundMusicFileImpl({ configuredPath: backgroundMusicFile, projectRoot })
    const musicVolume = commercialBackgroundMusicVolume(backgroundMusicVolume)
    const fontOption = `fontfile='${filterPath(resolvedFontFile)}':`
    const filterParts = []
    const attributionFiles = []
    for (let index = 0; index < clips.length; index += 1) {
      const creditFile = path.join(tempDir, `credit-${index + 1}.txt`)
      await fs.writeFile(creditFile, attributionFor(clips[index]), 'utf8')
      attributionFiles.push(creditFile)
      const duration = Number(clips[index].durationSeconds)
      filterParts.push(`[${index}:v]trim=start=0:duration=${duration.toFixed(3)},setpts=PTS-STARTPTS,scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30,format=yuv420p,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.08:t=fill,drawbox=x=32:y=78:w=520:h=154:color=0x071d13@0.78:t=fill,drawbox=x=32:y=78:w=10:h=154:color=0xF6BE36@1:t=fill,drawtext=${fontOption}text='FUNNY SHOT':fontcolor=0xF6BE36:fontsize=28:x=58:y=98,drawtext=${fontOption}text='GOLF HAPPENS.':fontcolor=white:fontsize=46:x=58:y=143,drawtext=${fontOption}text='We have all been there.':fontcolor=white@0.92:fontsize=26:x=58:y=196,drawbox=x=0:y=1152:w=iw:h=128:color=0x071d13@0.78:t=fill,drawtext=${fontOption}textfile='${filterPath(creditFile)}':fontcolor=white@0.78:fontsize=20:x=28:y=1168[scene${index}]`)
    }
    if (clips.length === 2) filterParts.push('[scene0][scene1]concat=n=2:v=1:a=0[story]')
    else filterParts.push('[scene0]null[story]')
    const logoInputIndex = clips.length
    const musicInputIndex = clips.length + 1
    filterParts.push(`[${logoInputIndex}:v]scale=142:-1,setsar=1[logo]`)
    filterParts.push(`[story][logo]overlay=W-w-24:18:format=auto,drawbox=x=28:y=900:w=664:h=198:color=0x071d13@0.82:t=fill:enable='gte(t,${ctaStart.toFixed(3)})',drawtext=${fontOption}text='FUNNY SHOT?':fontcolor=0xF6BE36:fontsize=30:x=(W-text_w)/2:y=928:enable='gte(t,${ctaStart.toFixed(3)})',drawtext=${fontOption}text='LOG IT. SHARE IT. LAUGH AGAIN.':fontcolor=white:fontsize=30:x=(W-text_w)/2:y=978:enable='gte(t,${ctaStart.toFixed(3)})',drawtext=${fontOption}text='GolfHomiez':fontcolor=white:fontsize=48:x=(W-text_w)/2:y=1025:enable='gte(t,${ctaStart.toFixed(3)})',drawtext=${fontOption}text='golfhomiez.com':fontcolor=white:fontsize=24:x=28:y=1225[vout]`)
    const fadeOutStart = Math.max(0, commercialDuration - 0.8)
    filterParts.push(`[${musicInputIndex}:a]atrim=start=0:duration=${commercialDuration.toFixed(3)},asetpts=PTS-STARTPTS,volume=${musicVolume.toFixed(3)},afade=t=in:st=0:d=0.35,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.8[aout]`)

    const args = []
    for (const clip of clips) args.push('-i', clip.localPath)
    args.push('-loop', '1', '-i', emblemPath, '-stream_loop', '-1', '-i', resolvedBackgroundMusicFile,
      '-filter_complex', filterParts.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', commercialDuration.toFixed(3),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', '-shortest', '-y', renderPath)

    let executable = resolveFfmpegPath({ projectRoot, configuredPath: ffmpegPath })
    const startedDetails = { correlationId, jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID, outputPath, ffmpegPath: executable, durationSeconds: commercialDuration, videoKeys: clips.map((clip) => clip.key), backgroundMusic: backgroundMusicMetadata(resolvedBackgroundMusicFile, musicVolume) }
    logApi('funny_shots_ffmpeg_started', startedDetails)
    logScheduledJob('funny_shots_ffmpeg_started', startedDetails)
    try {
      await runFfmpeg(executable, args, { spawnImpl, signal, cwd: projectRoot })
    } catch (error) {
      if (error?.code !== 'ENOENT' || !autoDownloadFfmpeg) throw error
      executable = await ensureFfmpegImpl({ projectRoot, signal, correlationId, logApi, logScheduledJob })
      await runFfmpeg(executable, args, { spawnImpl, signal, cwd: projectRoot })
    }
    await fs.copyFile(renderPath, outputPath, fsConstants.COPYFILE_EXCL)
    const stats = await fs.stat(outputPath)
    const completed = { correlationId, jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID, outputPath, bytes: stats.size, durationSeconds: commercialDuration, width: 720, height: 1280, selectionMode: clips.length === 2 ? 'funny-pair' : 'single-funny', videoKeys: clips.map((clip) => clip.key), providers: ['Pexels'], backgroundMusic: backgroundMusicMetadata(resolvedBackgroundMusicFile, musicVolume) }
    logApi('funny_shots_ffmpeg_completed', completed)
    logScheduledJob('funny_shots_ffmpeg_completed', completed)
    return completed
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

function dateStamp(date) {
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) throw new Error('Funny-shots commercial output date is invalid')
  return value.toISOString().slice(0, 10)
}

export function buildFunnyShotsCommercialOutputPath({ now = new Date(), projectRoot = process.cwd() } = {}) {
  const base = `${FUNNY_SHOTS_COMMERCIAL_JOB_NAME} - ${FUNNY_SHOTS_COMMERCIAL_FILE_TAG} - ${dateStamp(now)}`
  return path.join(projectRoot, 'jobs', 'commercials', `${base}.mp4`)
}

export async function reserveFunnyShotsCommercialOutputPath({ now = new Date(), projectRoot = process.cwd(), maxAttempts = 1000 } = {}) {
  const first = buildFunnyShotsCommercialOutputPath({ now, projectRoot })
  await fs.mkdir(path.dirname(first), { recursive: true })
  const ext = path.extname(first)
  const stem = first.slice(0, -ext.length)
  for (let sequence = 1; sequence <= maxAttempts; sequence += 1) {
    const outputPath = sequence === 1 ? first : `${stem} - ${sequence}${ext}`
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
      return { outputPath, lockPath, sequence }
    } catch (error) {
      if (handle) await handle.close().catch(() => {})
      if (error?.code === 'EEXIST') continue
      throw error
    }
  }
  const error = new Error(`Unable to reserve a unique Funny Shots commercial name after ${maxAttempts} attempts`)
  error.code = 'COMMERCIAL_OUTPUT_RESERVATION_FAILED'
  throw error
}

async function selectAndValidateFunnyClips(candidates, usedKeys, options) {
  const ordered = candidates.filter((candidate) => !usedKeys.has(candidate.key)).filter(isFunnyShotVideoCandidate).sort((a, b) => candidateScore(b) - candidateScore(a))
  const validated = []
  const rejected = new Set()
  for (const candidate of ordered) {
    if (rejected.has(candidate.key)) continue
    try {
      const downloaded = await downloadFunnyShotVideo(candidate, options)
      const durationSeconds = await probeFunnyShotVideoDuration(downloaded, options)
      if (durationSeconds < MIN_SOURCE_DURATION_SECONDS || durationSeconds > FUNNY_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS) {
        rejected.add(candidate.key)
        options.logScheduledJob?.('funny_shots_candidate_rejected', { correlationId: options.correlationId, jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID, videoKey: candidate.key, reason: `actual duration ${durationSeconds.toFixed(3)} seconds is outside 2-30 seconds`, level: 'warn' })
        continue
      }
      validated.push({ ...downloaded, durationSeconds: Number(durationSeconds.toFixed(3)), category: 'funny' })
      if (validated.length >= 6) break
    } catch (error) {
      if (options.signal?.aborted) throw error
      rejected.add(candidate.key)
      const details = { correlationId: options.correlationId, jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID, videoKey: candidate.key, errorCode: error?.code || null, errorMessage: error?.message || String(error), level: 'warn' }
      options.logApi?.('funny_shots_candidate_rejected', details)
      options.logScheduledJob?.('funny_shots_candidate_rejected', details)
    }
  }
  if (!validated.length) {
    const error = new Error('Pexels returned funny golf candidates, but none passed download and actual-duration validation.')
    error.code = 'FUNNY_SHOT_VIDEO_UNAVAILABLE'
    throw error
  }
  for (let i = 0; i < validated.length; i += 1) {
    for (let j = i + 1; j < validated.length; j += 1) {
      if (validated[i].durationSeconds + validated[j].durationSeconds <= FUNNY_SHOTS_COMMERCIAL_MAX_DURATION_SECONDS) return [validated[i], validated[j]]
    }
  }
  return [validated[0]]
}

export async function runCreateShortFormFunnyShotsSmall({
  pool = null,
  correlationId = `funny-shots-commercial-${randomUUID()}`,
  triggeredBy = 'manual',
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
  signal = null,
  fetchImpl = globalThis.fetch,
  candidates = null,
  usedVideoKeys = null,
  loadUsedVideoKeysImpl = loadPreviouslyUsedFunnyShotKeys,
  projectRoot = process.cwd(),
  now = new Date(),
  ffmpegPath = process.env.FFMPEG_PATH || null,
  spawnImpl = nodeSpawn,
  ensureFfmpegImpl = ensureManagedFfmpeg,
  autoDownloadFfmpeg = isManagedFfmpegAutoDownloadEnabled(),
  fontFile = process.env.GREAT_SHOTS_FONT_FILE || null,
  backgroundMusicFile = process.env.COMMERCIAL_BACKGROUND_MUSIC_FILE || null,
  backgroundMusicVolume = commercialBackgroundMusicVolume(),
  resolveBackgroundMusicFileImpl = resolveCommercialBackgroundMusicFile,
} = {}) {
  const startedAt = Date.now()
  const startDetails = { correlationId, jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID, jobName: FUNNY_SHOTS_COMMERCIAL_JOB_NAME, triggeredBy }
  logApi('funny_shots_commercial_started', startDetails)
  logScheduledJob('funny_shots_commercial_started', startDetails)
  let reservation = null
  let tempDir = null
  try {
    throwIfCancelled(signal)
    const usedKeys = usedVideoKeys instanceof Set ? usedVideoKeys : await loadUsedVideoKeysImpl(pool)
    const discovered = candidates || await fetchFunnyShotCandidates({ fetchImpl, signal, correlationId, logApi, logScheduledJob })
    const eligible = discovered.filter((candidate) => !usedKeys.has(candidate.key)).filter(isFunnyShotVideoCandidate)
    const diagnostics = { correlationId, jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID, discoveredCount: discovered.length, previouslyUsedCount: discovered.filter((candidate) => usedKeys.has(candidate.key)).length, unusedEligibleCount: eligible.length, pexelsQuota: getLatestPexelsQuota() }
    logApi('funny_shots_selection_diagnostics', diagnostics)
    logScheduledJob('funny_shots_selection_diagnostics', diagnostics)
    if (!eligible.length) selectFunnyShotVideos(discovered, usedKeys)

    tempDir = path.join(projectRoot, 'jobs', 'commercials', `.tmp-funny-shot-downloads-${randomUUID()}`)
    await fs.mkdir(tempDir, { recursive: true })
    const clips = await selectAndValidateFunnyClips(discovered, usedKeys, { tempDir, fetchImpl, signal, correlationId, logApi, logScheduledJob, projectRoot, ffmpegPath, spawnImpl, ensureFfmpegImpl, autoDownloadFfmpeg })
    reservation = await reserveFunnyShotsCommercialOutputPath({ now, projectRoot })
    logApi('funny_shots_output_reserved', { correlationId, jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID, outputPath: reservation.outputPath, outputSequence: reservation.sequence })
    logScheduledJob('funny_shots_output_reserved', { correlationId, jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID, outputPath: reservation.outputPath, outputSequence: reservation.sequence })

    const rendered = await renderFunnyShotsCommercial({ outputPath: reservation.outputPath, clips, projectRoot, ffmpegPath, fontFile, backgroundMusicFile, backgroundMusicVolume, resolveBackgroundMusicFileImpl, spawnImpl, ensureFfmpegImpl, autoDownloadFfmpeg, signal, correlationId, logApi, logScheduledJob })
    const output = {
      fileName: path.basename(reservation.outputPath),
      relativePath: path.relative(projectRoot, reservation.outputPath).replace(/\\/g, '/'),
      durationSeconds: rendered.durationSeconds,
      resolution: `${rendered.width}x${rendered.height}`,
      bytes: rendered.bytes,
      outputSequence: reservation.sequence,
      selectionMode: clips.length === 2 ? 'funny-pair' : 'single-funny',
      videos: clips.map((clip) => ({ key: clip.key, provider: clip.provider, id: clip.id, category: 'funny', title: clip.title, author: clip.author, authorUrl: clip.authorUrl || null, license: clip.license, licenseUrl: clip.licenseUrl || null, sourcePageUrl: clip.sourcePageUrl, durationSeconds: clip.durationSeconds })),
      pexelsVideoCount: clips.length,
      pexelsQuota: getLatestPexelsQuota(),
      backgroundMusic: rendered.backgroundMusic || null,
      completedInMs: Date.now() - startedAt,
    }
    logApi('funny_shots_commercial_completed', { correlationId, jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID, ...output })
    logScheduledJob('funny_shots_commercial_completed', { correlationId, jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID, ...output })
    return output
  } catch (error) {
    if (getLatestPexelsQuota()) error.output = { ...(error?.output && typeof error.output === 'object' ? error.output : {}), pexelsQuota: getLatestPexelsQuota() }
    const details = { correlationId, jobId: FUNNY_SHOTS_COMMERCIAL_JOB_ID, triggeredBy, errorName: error?.name || 'Error', errorCode: error?.code || null, errorMessage: error?.message || String(error), errorStack: error?.stack || null, level: 'error' }
    logApi('funny_shots_commercial_failed', details)
    logScheduledJob('funny_shots_commercial_failed', details)
    logError?.('Funny-shots commercial job failed', error)
    throw error
  } finally {
    if (reservation?.lockPath) await fs.rm(reservation.lockPath, { force: true }).catch(() => {})
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}
