import { Buffer } from 'node:buffer'
import dns from 'node:dns/promises'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isPrivateNetworkAddress } from './golf-course-public-pages.js'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const GOLF_COURSE_EMAILS_OUTPUT_PATH = path.join(PROJECT_ROOT, 'docs', 'golfCourseEmails.csv')
const DEFAULT_TIMEOUT_MS = 7_000
const DEFAULT_CONCURRENCY = 12
const DEFAULT_MAX_PAGES_PER_COURSE = 8
const PROGRESS_LOG_COURSE_INTERVAL = 100
const DEFAULT_CHECKPOINT_COURSE_INTERVAL = 50
const MAX_RESPONSE_BYTES = 1_000_000
const MAX_REDIRECTS = 3
const USER_AGENT = 'GolfHomiezGolfCourseEmailBuilder/1.0 (+https://golfhomiez.com)'
const EMAIL_PATTERN = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi
const CONTACT_LINK_KEYWORDS = [
  ['contact', 100],
  ['staff', 95],
  ['directory', 90],
  ['team', 80],
  ['management', 80],
  ['about', 70],
  ['leadership', 70],
  ['pro-shop', 60],
  ['proshop', 60],
]
const POSITION_PATTERNS = [
  'general manager',
  'club manager',
  'course manager',
  'director of golf',
  'head golf professional',
  'golf professional',
  'head professional',
  'golf operations manager',
  'operations manager',
  'tournament director',
  'tournament coordinator',
  'events director',
  'event director',
  'events coordinator',
  'event coordinator',
  'sales director',
  'sales manager',
  'marketing director',
  'marketing manager',
  'membership director',
  'membership manager',
  'superintendent',
  'owner',
  'president',
  'manager',
]

function positiveInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function cleanText(value, maxLength = 500) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, maxLength) : ''
}

function decodeHtmlEntities(value) {
  const named = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—' }
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, key) => named[key.toLowerCase()] ?? match)
}

function htmlToText(value) {
  return cleanText(
    decodeHtmlEntities(String(value || ''))
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
    5_000,
  )
}

function pageTitleFromHtml(value) {
  const match = String(value || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  return match ? htmlToText(match[1]).slice(0, 191) : ''
}

export function normalizeGolfCourseWebsiteUrl(value) {
  const raw = cleanText(value, 2048)
  if (!raw) return null
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

async function assertPublicWebsiteUrl(value) {
  const normalized = normalizeGolfCourseWebsiteUrl(value)
  if (!normalized) throw new Error('Golf course website is not a valid HTTP(S) URL')
  const url = new URL(normalized)
  const hostname = url.hostname.toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Golf course website hostname is not publicly routable')
  }
  if (net.isIP(hostname)) {
    if (isPrivateNetworkAddress(hostname)) throw new Error('Golf course website resolves to a private network address')
    return url
  }
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some((entry) => isPrivateNetworkAddress(entry.address))) {
    throw new Error('Golf course website resolves to a private network address')
  }
  return url
}

async function responseTextWithLimit(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('Website response exceeded the maximum supported size')
  if (!response.body?.getReader) {
    const text = await response.text()
    if (Buffer.byteLength(text) > maxBytes) throw new Error('Website response exceeded the maximum supported size')
    return text
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('Website response exceeded the maximum supported size')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function cancellationError(signal) {
  const reason = signal?.reason
  if (reason instanceof Error) {
    if (!reason.code) reason.code = 'SCHEDULED_JOB_CANCELLED'
    return reason
  }
  const error = new Error('Scheduled job cancellation requested')
  error.code = 'SCHEDULED_JOB_CANCELLED'
  return error
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw cancellationError(signal)
}

async function fetchHtml(url, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, signal = null } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('HTTP fetch is unavailable in this Node runtime')
  throwIfCancelled(signal)
  let currentUrl = await assertPublicWebsiteUrl(url)

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    throwIfCancelled(signal)
    const controller = new AbortController()
    const onAbort = () => controller.abort(signal?.reason || cancellationError(signal))
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    const timeoutError = new Error(`Website request timed out after ${timeoutMs} ms`)
    timeoutError.code = 'GOLF_COURSE_EMAIL_TIMEOUT'
    const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs)
    try {
      const response = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1',
          'User-Agent': USER_AGENT,
        },
      })
      throwIfCancelled(signal)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location || redirectCount >= MAX_REDIRECTS) throw new Error('Golf course website exceeded the redirect limit')
        currentUrl = await assertPublicWebsiteUrl(new URL(location, currentUrl).toString())
        continue
      }
      if (!response.ok) {
        const error = new Error(`Golf course website returned HTTP ${response.status}`)
        error.statusCode = response.status
        throw error
      }
      const contentType = String(response.headers.get('content-type') || '').toLowerCase()
      if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml') && !contentType.includes('text/plain')) {
        throw new Error(`Unsupported golf course website content type: ${contentType}`)
      }
      return { url: currentUrl.toString(), html: await responseTextWithLimit(response) }
    } catch (error) {
      if (signal?.aborted) throw cancellationError(signal)
      if (controller.signal.aborted && controller.signal.reason?.code === 'GOLF_COURSE_EMAIL_TIMEOUT') throw controller.signal.reason
      throw error
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
  }
  throw new Error('Golf course website exceeded the redirect limit')
}

function normalizeEmail(value) {
  const email = String(value || '').trim().replace(/^mailto:/i, '').split('?')[0].trim().replace(/[)>.,;:]+$/g, '').toLowerCase()
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  if (/\.(?:png|jpe?g|gif|svg|webp|ico)$/i.test(email)) return null
  return email
}

function likelyName(value) {
  const candidate = cleanText(value, 120).replace(/^[\s|,:;\-–—]+|[\s|,:;\-–—]+$/g, '')
  if (!candidate || candidate.includes('@') || /\b(?:contact|email|phone|golf|course|club|manager|director|staff|team|office|pro shop)\b/i.test(candidate)) return null
  const match = candidate.match(/\b([A-Z][A-Za-z'’-]{1,30})\s+([A-Z][A-Za-z'’-]{1,40})\b/)
  return match ? { firstName: match[1], lastName: match[2] } : null
}

function inferContactDetails(contextText, email) {
  const text = cleanText(String(contextText || '').replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' '), 900)
  const lower = text.toLowerCase()
  const position = POSITION_PATTERNS.find((entry) => lower.includes(entry)) || ''
  const chunks = text.split(/[|•·\n\r]+|\s[-–—]\s|\s{2,}/).map((part) => cleanText(part, 160)).filter(Boolean)
  let name = null
  for (const chunk of chunks) {
    name = likelyName(chunk)
    if (name) break
  }
  if (!name) {
    for (const candidate of text.match(/\b[A-Z][A-Za-z'’-]{1,30}\s+[A-Z][A-Za-z'’-]{1,40}\b/g) || []) {
      name = likelyName(candidate)
      if (name) break
    }
  }
  if (!name) name = likelyName(text)
  return {
    firstName: name?.firstName || '',
    lastName: name?.lastName || '',
    position: position ? position.replace(/\b\w/g, (char) => char.toUpperCase()) : '',
  }
}

function contextAroundEmail(html, index, email) {
  const start = Math.max(0, index - 500)
  const end = Math.min(html.length, index + email.length + 500)
  return htmlToText(html.slice(start, end))
}

export function extractGolfCourseEmailContacts(html, { sourceUrl = '', sourcePageTitle = '' } = {}) {
  const source = decodeHtmlEntities(String(html || ''))
  const byEmail = new Map()
  let match
  EMAIL_PATTERN.lastIndex = 0
  while ((match = EMAIL_PATTERN.exec(source))) {
    const email = normalizeEmail(match[0])
    if (!email || byEmail.has(email)) continue
    byEmail.set(email, {
      email,
      ...inferContactDetails(contextAroundEmail(source, match.index, match[0]), email),
      sourceUrl: cleanText(sourceUrl, 2048),
      sourcePageTitle: cleanText(sourcePageTitle, 191),
    })
  }
  return [...byEmail.values()]
}

export function findGolfCourseContactPages(html, baseUrl, limit = DEFAULT_MAX_PAGES_PER_COURSE - 1) {
  const source = String(html || '')
  const candidates = new Map()
  const linkPattern = /<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi
  let match
  let order = 0
  while ((match = linkPattern.exec(source))) {
    const href = decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? '').trim()
    const label = htmlToText(match[4] || '')
    if (!href || /^(?:mailto:|tel:|javascript:|#)/i.test(href)) continue
    let resolved
    let base
    try {
      resolved = new URL(href, baseUrl)
      base = new URL(baseUrl)
    } catch {
      continue
    }
    if (!['http:', 'https:'].includes(resolved.protocol) || resolved.origin !== base.origin) continue
    if (/\.(?:pdf|docx?|xlsx?|zip|jpe?g|png|gif|svg)(?:$|[?#])/i.test(resolved.pathname)) continue
    resolved.hash = ''
    const normalized = resolved.toString()
    if (normalized === base.toString()) continue
    const haystack = `${resolved.pathname} ${label}`.toLowerCase()
    let score = 0
    for (const [keyword, points] of CONTACT_LINK_KEYWORDS) {
      if (haystack.includes(keyword)) score = Math.max(score, points)
    }
    if (!score) continue
    const current = candidates.get(normalized)
    if (!current || score > current.score) candidates.set(normalized, { url: normalized, score, order })
    order += 1
  }
  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, positiveInt(limit, DEFAULT_MAX_PAGES_PER_COURSE - 1, 1, 24))
    .map((candidate) => candidate.url)
}

export function findBestGolfCourseContactPage(html, baseUrl) {
  return findGolfCourseContactPages(html, baseUrl, 1)[0] || null
}

function mergeContacts(existing, incoming) {
  const byEmail = new Map(existing.map((contact) => [contact.email, contact]))
  for (const contact of incoming) {
    const current = byEmail.get(contact.email)
    if (!current) {
      byEmail.set(contact.email, contact)
      continue
    }
    byEmail.set(contact.email, {
      email: current.email,
      firstName: current.firstName || contact.firstName || '',
      lastName: current.lastName || contact.lastName || '',
      position: current.position || contact.position || '',
      sourceUrl: current.sourceUrl || contact.sourceUrl || '',
      sourcePageTitle: current.sourcePageTitle || contact.sourcePageTitle || '',
    })
  }
  return [...byEmail.values()]
}

async function crawlGolfCourseForEmails(course, options) {
  const { fetchImpl, timeoutMs, signal, maxPagesPerCourse } = options
  const rootUrl = normalizeGolfCourseWebsiteUrl(course.website || course.golf_course_website)
  if (!rootUrl) {
    return { contacts: [], pagesAttempted: 0, pagesFetched: 0, pageFailures: 0, error: 'missing_or_invalid_website', skipped: true }
  }

  let pagesAttempted = 1
  let pagesFetched = 0
  let pageFailures = 0
  let root
  try {
    root = await fetchHtml(rootUrl, { fetchImpl, timeoutMs, signal })
    pagesFetched += 1
  } catch (error) {
    throwIfCancelled(signal)
    return {
      contacts: [],
      pagesAttempted,
      pagesFetched,
      pageFailures: 1,
      error: error?.message || String(error),
      failed: true,
    }
  }

  let contacts = extractGolfCourseEmailContacts(root.html, {
    sourceUrl: root.url,
    sourcePageTitle: pageTitleFromHtml(root.html),
  })
  const pageUrls = findGolfCourseContactPages(root.html, root.url, Math.max(1, maxPagesPerCourse - 1))
  const pageErrors = []

  for (const pageUrl of pageUrls) {
    if (pagesAttempted >= maxPagesPerCourse) break
    throwIfCancelled(signal)
    pagesAttempted += 1
    try {
      const page = await fetchHtml(pageUrl, { fetchImpl, timeoutMs, signal })
      pagesFetched += 1
      contacts = mergeContacts(contacts, extractGolfCourseEmailContacts(page.html, {
        sourceUrl: page.url,
        sourcePageTitle: pageTitleFromHtml(page.html),
      }))
    } catch (error) {
      throwIfCancelled(signal)
      pageFailures += 1
      pageErrors.push({ url: pageUrl, error: error?.message || String(error) })
    }
  }

  return {
    contacts,
    pagesAttempted,
    pagesFetched,
    pageFailures,
    error: pageErrors.length ? pageErrors[pageErrors.length - 1].error : null,
    pageErrors,
  }
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function dedupeGolfCourseEmailRecords(records) {
  const uniqueRecords = []
  const seenEmails = new Set()
  for (const record of Array.isArray(records) ? records : []) {
    const normalizedEmail = String(record?.email || '').trim().toLowerCase()
    if (normalizedEmail && seenEmails.has(normalizedEmail)) continue
    if (normalizedEmail) seenEmails.add(normalizedEmail)
    uniqueRecords.push(record)
  }
  return uniqueRecords
}

export function buildGolfCourseEmailsCsv(records) {
  const rows = [['Golf Course Name', 'Email Address', 'First Name', 'Last Name', 'Position', 'City', 'State', 'Source URL', 'Source Page Title', 'Discovered At']]
  for (const record of dedupeGolfCourseEmailRecords(records)) {
    rows.push([
      record.golfCourseName,
      record.email,
      record.firstName || '',
      record.lastName || '',
      record.position || '',
      record.city || '',
      record.state || '',
      record.sourceUrl || '',
      record.sourcePageTitle || '',
      record.discoveredAt || '',
    ])
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

async function mapWithConcurrency(items, concurrency, worker) {
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index], index)
    }
  })
  await Promise.all(workers)
}

async function loadGolfCourses(db) {
  const [rows] = await db.execute(`
    SELECT id, name, state_code, city,
           COALESCE(NULLIF(TRIM(website), ''), NULLIF(TRIM(golf_course_website), '')) AS website
      FROM golf_courses
     WHERE active = 1
     ORDER BY state_code, name, id
  `)
  return Array.isArray(rows) ? rows : []
}

async function writeCsvAtomically(outputPath, csv) {
  const directory = path.dirname(outputPath)
  await mkdir(directory, { recursive: true })
  const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(tempPath, csv, 'utf8')
    await rename(tempPath, outputPath)
  } finally {
    await rm(tempPath, { force: true }).catch(() => {})
  }
}

function golfCourseCrawlFingerprint(courses) {
  const hash = createHash('sha256')
  for (const course of courses) {
    hash.update(`${String(course?.id || '')}|${String(course?.website || '')}\n`)
  }
  return hash.digest('hex')
}

async function readGolfCourseEmailCheckpoint(checkpointPath, fingerprint) {
  try {
    const parsed = JSON.parse(await readFile(checkpointPath, 'utf8'))
    if (!parsed || parsed.version !== 1 || parsed.courseFingerprint !== fingerprint) return null
    if (!Array.isArray(parsed.completedCourseIds) || !Array.isArray(parsed.records) || !parsed.stats || typeof parsed.stats !== 'object') return null
    return parsed
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    return null
  }
}

async function writeGolfCourseEmailCheckpoint(checkpointPath, checkpoint) {
  const directory = path.dirname(checkpointPath)
  await mkdir(directory, { recursive: true })
  const tempPath = `${checkpointPath}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(tempPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8')
    await rename(tempPath, checkpointPath)
  } finally {
    await rm(tempPath, { force: true }).catch(() => {})
  }
}

export async function runBuildGolfCourseEmails(db, {
  correlationId = null,
  triggeredBy = 'manual',
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
  reportProgress = () => {},
  signal = null,
  fetchImpl = globalThis.fetch,
  outputPath = GOLF_COURSE_EMAILS_OUTPUT_PATH,
  concurrency = positiveInt(process.env.GOLF_COURSE_EMAILS_CONCURRENCY, DEFAULT_CONCURRENCY, 1, 24),
  timeoutMs = positiveInt(process.env.GOLF_COURSE_EMAILS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 30_000),
  maxPagesPerCourse = positiveInt(process.env.GOLF_COURSE_EMAILS_MAX_PAGES_PER_COURSE, DEFAULT_MAX_PAGES_PER_COURSE, 2, 24),
  checkpointPath = `${outputPath}.checkpoint.json`,
  checkpointCourseInterval = positiveInt(process.env.GOLF_COURSE_EMAILS_CHECKPOINT_COURSE_INTERVAL, DEFAULT_CHECKPOINT_COURSE_INTERVAL, 1, 500),
} = {}) {
  throwIfCancelled(signal)
  const courses = await loadGolfCourses(db)
  const records = []
  const startedAtMs = Date.now()
  const discoveredAt = new Date(startedAtMs).toISOString()
  const courseFingerprint = golfCourseCrawlFingerprint(courses)
  const completedCourseIds = new Set()
  const stats = {
    golfCoursesTargeted: courses.length,
    golfCoursesEligible: courses.filter((course) => Boolean(normalizeGolfCourseWebsiteUrl(course.website))).length,
    golfCoursesWithoutWebsite: 0,
    golfCoursesProcessed: 0,
    golfCoursesWithEmails: 0,
    golfCoursesFailed: 0,
    pageFailures: 0,
    pagesAttempted: 0,
    pagesFetched: 0,
    emailRecords: 0,
    duplicateEmailRecordsSkipped: 0,
  }
  const checkpoint = await readGolfCourseEmailCheckpoint(checkpointPath, courseFingerprint)
  if (checkpoint) {
    for (const id of checkpoint.completedCourseIds) completedCourseIds.add(String(id))
    records.push(...checkpoint.records)
    for (const key of ['golfCoursesWithoutWebsite', 'golfCoursesProcessed', 'golfCoursesWithEmails', 'golfCoursesFailed', 'pageFailures', 'pagesAttempted', 'pagesFetched']) {
      const value = Number(checkpoint.stats?.[key])
      if (Number.isFinite(value) && value >= 0) stats[key] = value
    }
  }
  stats.golfCoursesProcessed = Math.min(courses.length, completedCourseIds.size)
  const resumedCourses = stats.golfCoursesProcessed
  let lastLoggedProgressCount = -1
  let lastCheckpointCount = completedCourseIds.size
  let checkpointWriteChain = Promise.resolve()

  const buildProgress = (phase = 'crawling') => {
    const nowMs = Date.now()
    const elapsedMs = Math.max(0, nowMs - startedAtMs)
    const totalCourses = stats.golfCoursesTargeted
    const processedCourses = stats.golfCoursesProcessed
    const percentComplete = totalCourses > 0 ? Math.min(100, (processedCourses / totalCourses) * 100) : 100
    const coursesProcessedThisRun = Math.max(0, processedCourses - resumedCourses)
    const coursesPerMinute = elapsedMs > 0 ? (coursesProcessedThisRun / elapsedMs) * 60_000 : 0
    const estimatedRemainingMs = coursesProcessedThisRun > 0 && processedCourses < totalCourses && coursesPerMinute > 0
      ? Math.round(((totalCourses - processedCourses) / coursesPerMinute) * 60_000)
      : processedCourses >= totalCourses ? 0 : null
    return {
      phase,
      correlationId,
      processedCourses,
      coursesProcessedThisRun,
      resumedCourses,
      totalCourses,
      eligibleCourses: stats.golfCoursesEligible,
      coursesWithoutWebsite: stats.golfCoursesWithoutWebsite,
      coursesWithEmails: stats.golfCoursesWithEmails,
      failedCourses: stats.golfCoursesFailed,
      pageFailures: stats.pageFailures,
      pagesAttempted: stats.pagesAttempted,
      pagesFetched: stats.pagesFetched,
      emailRecordsDiscovered: records.length,
      percentComplete: Number(percentComplete.toFixed(2)),
      elapsedMs,
      coursesPerMinute: Number(coursesPerMinute.toFixed(2)),
      estimatedRemainingMs,
      expectedCompletionAt: estimatedRemainingMs == null ? null : new Date(nowMs + estimatedRemainingMs).toISOString(),
      updatedAt: new Date(nowMs).toISOString(),
      maxPagesPerCourse,
      retryAttempts: 0,
      checkpointFile: path.relative(PROJECT_ROOT, checkpointPath).replace(/\\/g, '/'),
    }
  }

  const publishProgress = (phase = 'crawling', forceLog = false) => {
    const progress = buildProgress(phase)
    reportProgress(progress)
    const shouldLog = forceLog
      || progress.processedCourses === progress.totalCourses
      || progress.processedCourses === 0
      || progress.processedCourses - lastLoggedProgressCount >= PROGRESS_LOG_COURSE_INTERVAL
    if (shouldLog) {
      lastLoggedProgressCount = progress.processedCourses
      logScheduledJob('build_golf_course_emails_progress', progress)
      logApi('build_golf_course_emails_progress', progress)
    }
    return progress
  }

  const queueCheckpoint = (force = false) => {
    if (!force && completedCourseIds.size - lastCheckpointCount < checkpointCourseInterval) return checkpointWriteChain
    lastCheckpointCount = completedCourseIds.size
    const snapshot = {
      version: 1,
      courseFingerprint,
      startedAt: checkpoint?.startedAt || discoveredAt,
      updatedAt: new Date().toISOString(),
      completedCourseIds: [...completedCourseIds],
      stats: { ...stats },
      records: records.map((record) => ({ ...record })),
    }
    checkpointWriteChain = checkpointWriteChain
      .catch(() => {})
      .then(() => writeGolfCourseEmailCheckpoint(checkpointPath, snapshot))
    return checkpointWriteChain
  }

  const startDetails = {
    correlationId,
    triggeredBy,
    courseCount: courses.length,
    eligibleCourseCount: stats.golfCoursesEligible,
    concurrency,
    timeoutMs,
    maxPagesPerCourse,
    retryAttempts: 0,
    resumedCourses,
    checkpointCourseInterval,
    checkpointPath,
    outputPath,
  }
  logApi('build_golf_course_emails_started', startDetails)
  logScheduledJob('build_golf_course_emails_started', startDetails)
  if (resumedCourses > 0) {
    logApi('build_golf_course_emails_resumed', { correlationId, resumedCourses, checkpointPath })
    logScheduledJob('build_golf_course_emails_resumed', { correlationId, resumedCourses, checkpointPath })
  }
  publishProgress(resumedCourses > 0 ? 'resuming' : 'starting', true)

  const coursesToProcess = courses.filter((course) => !completedCourseIds.has(String(course.id)))
  try {
    await mapWithConcurrency(coursesToProcess, concurrency, async (course) => {
    throwIfCancelled(signal)
    try {
      const result = await crawlGolfCourseForEmails(course, { fetchImpl, timeoutMs, signal, maxPagesPerCourse })
      stats.golfCoursesProcessed += 1
      stats.pagesAttempted += result.pagesAttempted
      stats.pagesFetched += result.pagesFetched
      stats.pageFailures += result.pageFailures || 0

      if (result.skipped) {
        stats.golfCoursesWithoutWebsite += 1
        logScheduledJob('build_golf_course_emails_course_skipped', {
          correlationId,
          golfCourseId: course.id,
          golfCourseName: course.name,
          reason: result.error,
        })
      } else if (result.failed) {
        stats.golfCoursesFailed += 1
        logError('Build Golf Course Emails course crawl failed; continuing to next course without retry', {
          correlationId,
          golfCourseId: course.id,
          golfCourseName: course.name,
          website: course.website,
          error: result.error,
        })
        logScheduledJob('build_golf_course_emails_course_failed', {
          correlationId,
          golfCourseId: course.id,
          golfCourseName: course.name,
          website: course.website,
          pagesAttempted: result.pagesAttempted,
          pagesFetched: result.pagesFetched,
          error: result.error,
          retryAttempts: 0,
          level: 'warn',
        })
      } else {
        if (result.contacts.length) {
          stats.golfCoursesWithEmails += 1
          for (const contact of result.contacts) {
            records.push({
              golfCourseName: cleanText(course.name, 191),
              email: contact.email,
              firstName: contact.firstName || '',
              lastName: contact.lastName || '',
              position: contact.position || '',
              city: cleanText(course.city, 120),
              state: cleanText(course.state_code, 8),
              sourceUrl: contact.sourceUrl || '',
              sourcePageTitle: contact.sourcePageTitle || '',
              discoveredAt,
            })
          }
        }
        logScheduledJob('build_golf_course_emails_course_completed', {
          correlationId,
          golfCourseId: course.id,
          golfCourseName: course.name,
          emailCount: result.contacts.length,
          pagesAttempted: result.pagesAttempted,
          pagesFetched: result.pagesFetched,
          pageFailures: result.pageFailures || 0,
          secondaryPageError: result.error || null,
          retryAttempts: 0,
        })
      }
      completedCourseIds.add(String(course.id))
      publishProgress('crawling')
      await queueCheckpoint()
    } catch (error) {
      if (signal?.aborted || error?.code === 'SCHEDULED_JOB_CANCELLED') throw error
      stats.golfCoursesProcessed += 1
      stats.golfCoursesFailed += 1
      logError('Build Golf Course Emails course processing failed; continuing to next course without retry', {
        correlationId,
        golfCourseId: course.id,
        golfCourseName: course.name,
        website: course.website,
        error,
      })
      logScheduledJob('build_golf_course_emails_course_failed', {
        correlationId,
        golfCourseId: course.id,
        golfCourseName: course.name,
        website: course.website,
        error: error?.message || String(error),
        retryAttempts: 0,
        level: 'warn',
      })
      completedCourseIds.add(String(course.id))
      publishProgress('crawling')
      await queueCheckpoint()
    }
    })
  } catch (error) {
    await queueCheckpoint(true).catch((checkpointError) => {
      logError('Build Golf Course Emails checkpoint write failed during interruption', { correlationId, checkpointPath, error: checkpointError })
    })
    if (signal?.aborted || error?.code === 'SCHEDULED_JOB_CANCELLED') {
      error.output = {
        cancelled: true,
        ...buildProgress('cancelled'),
        checkpointFile: path.relative(PROJECT_ROOT, checkpointPath).replace(/\\/g, '/'),
      }
    }
    throw error
  }

  throwIfCancelled(signal)
  await queueCheckpoint(true)
  publishProgress('writing_output', true)
  records.sort((a, b) => a.golfCourseName.localeCompare(b.golfCourseName) || a.email.localeCompare(b.email))
  const uniqueRecords = dedupeGolfCourseEmailRecords(records)
  stats.duplicateEmailRecordsSkipped = records.length - uniqueRecords.length
  stats.emailRecords = uniqueRecords.length
  if (stats.duplicateEmailRecordsSkipped > 0) {
    logScheduledJob('build_golf_course_emails_duplicates_skipped', {
      correlationId,
      duplicateEmailRecordsSkipped: stats.duplicateEmailRecordsSkipped,
      emailRecords: stats.emailRecords,
    })
  }
  await writeCsvAtomically(outputPath, buildGolfCourseEmailsCsv(uniqueRecords))
  await rm(checkpointPath, { force: true }).catch((error) => {
    logError('Build Golf Course Emails completed but could not remove checkpoint', { correlationId, checkpointPath, error })
  })
  const finalProgress = publishProgress('completed', true)
  const output = {
    ...stats,
    outputFile: path.relative(PROJECT_ROOT, outputPath).replace(/\\/g, '/'),
    maxPagesPerCourse,
    retryAttempts: 0,
    resumedCourses,
    checkpointFile: path.relative(PROJECT_ROOT, checkpointPath).replace(/\\/g, '/'),
    elapsedMs: finalProgress.elapsedMs,
    coursesPerMinute: finalProgress.coursesPerMinute,
  }
  logApi('build_golf_course_emails_completed', { correlationId, ...output })
  logScheduledJob('build_golf_course_emails_completed', { correlationId, ...output })
  return output
}
