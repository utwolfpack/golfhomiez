import { Buffer } from 'node:buffer'
import dns from 'node:dns/promises'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { isPrivateNetworkAddress } from './golf-course-public-pages.js'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const GOLF_COURSE_EMAILS_OUTPUT_PATH = path.join(PROJECT_ROOT, 'docs', 'golfCourseEmails.csv')
const DEFAULT_TIMEOUT_MS = 7_000
const DEFAULT_CONCURRENCY = 12
const MAX_PAGE_ATTEMPTS_PER_COURSE = 2
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

export function extractGolfCourseEmailContacts(html) {
  const source = decodeHtmlEntities(String(html || ''))
  const byEmail = new Map()
  let match
  EMAIL_PATTERN.lastIndex = 0
  while ((match = EMAIL_PATTERN.exec(source))) {
    const email = normalizeEmail(match[0])
    if (!email || byEmail.has(email)) continue
    byEmail.set(email, { email, ...inferContactDetails(contextAroundEmail(source, match.index, match[0]), email) })
  }
  return [...byEmail.values()]
}

export function findBestGolfCourseContactPage(html, baseUrl) {
  const source = String(html || '')
  let best = null
  const linkPattern = /<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi
  let match
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
    if (!best || score > best.score) best = { url: normalized, score }
  }
  return best?.url || null
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
    })
  }
  return [...byEmail.values()]
}

function transientFetchError(error) {
  const status = Number(error?.statusCode || 0)
  return status === 408 || status === 425 || status === 429 || status >= 500 || error?.code === 'GOLF_COURSE_EMAIL_TIMEOUT' || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error?.code)
}

async function crawlGolfCourseForEmails(course, options) {
  const { fetchImpl, timeoutMs, signal } = options
  const rootUrl = normalizeGolfCourseWebsiteUrl(course.website || course.golf_course_website)
  if (!rootUrl) return { contacts: [], pagesAttempted: 0, pagesFetched: 0, error: 'invalid_website' }

  let pagesAttempted = 0
  let pagesFetched = 0
  let root
  try {
    pagesAttempted += 1
    root = await fetchHtml(rootUrl, { fetchImpl, timeoutMs, signal })
    pagesFetched += 1
  } catch (error) {
    throwIfCancelled(signal)
    if (!transientFetchError(error) || pagesAttempted >= MAX_PAGE_ATTEMPTS_PER_COURSE) throw error
    pagesAttempted += 1
    root = await fetchHtml(rootUrl, { fetchImpl, timeoutMs, signal })
    pagesFetched += 1
  }

  let contacts = extractGolfCourseEmailContacts(root.html)
  const secondPageUrl = pagesAttempted < MAX_PAGE_ATTEMPTS_PER_COURSE ? findBestGolfCourseContactPage(root.html, root.url) : null
  if (secondPageUrl) {
    try {
      pagesAttempted += 1
      const secondPage = await fetchHtml(secondPageUrl, { fetchImpl, timeoutMs, signal })
      pagesFetched += 1
      contacts = mergeContacts(contacts, extractGolfCourseEmailContacts(secondPage.html))
    } catch (error) {
      throwIfCancelled(signal)
      return { contacts, pagesAttempted, pagesFetched, error: error?.message || String(error), secondPageUrl }
    }
  }
  return { contacts, pagesAttempted, pagesFetched, error: null, secondPageUrl }
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
  const rows = [['Golf Course Name', 'Email Address', 'First Name', 'Last Name', 'Position']]
  for (const record of dedupeGolfCourseEmailRecords(records)) {
    rows.push([record.golfCourseName, record.email, record.firstName || '', record.lastName || '', record.position || ''])
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
       AND COALESCE(NULLIF(TRIM(website), ''), NULLIF(TRIM(golf_course_website), '')) IS NOT NULL
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

export async function runBuildGolfCourseEmails(db, {
  correlationId = null,
  triggeredBy = 'manual',
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
  signal = null,
  fetchImpl = globalThis.fetch,
  outputPath = GOLF_COURSE_EMAILS_OUTPUT_PATH,
  concurrency = positiveInt(process.env.GOLF_COURSE_EMAILS_CONCURRENCY, DEFAULT_CONCURRENCY, 1, 24),
  timeoutMs = positiveInt(process.env.GOLF_COURSE_EMAILS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 30_000),
} = {}) {
  throwIfCancelled(signal)
  const courses = await loadGolfCourses(db)
  const records = []
  const stats = {
    golfCoursesEligible: courses.length,
    golfCoursesProcessed: 0,
    golfCoursesWithEmails: 0,
    golfCoursesFailed: 0,
    pagesAttempted: 0,
    pagesFetched: 0,
    emailRecords: 0,
    duplicateEmailRecordsSkipped: 0,
  }
  const startDetails = { correlationId, triggeredBy, courseCount: courses.length, concurrency, timeoutMs, maxPageAttemptsPerCourse: MAX_PAGE_ATTEMPTS_PER_COURSE, outputPath }
  logApi('build_golf_course_emails_started', startDetails)
  logScheduledJob('build_golf_course_emails_started', startDetails)

  await mapWithConcurrency(courses, concurrency, async (course) => {
    throwIfCancelled(signal)
    try {
      const result = await crawlGolfCourseForEmails(course, { fetchImpl, timeoutMs, signal })
      stats.golfCoursesProcessed += 1
      stats.pagesAttempted += result.pagesAttempted
      stats.pagesFetched += result.pagesFetched
      if (result.contacts.length) {
        stats.golfCoursesWithEmails += 1
        for (const contact of result.contacts) {
          records.push({
            golfCourseName: cleanText(course.name, 191),
            email: contact.email,
            firstName: contact.firstName || '',
            lastName: contact.lastName || '',
            position: contact.position || '',
          })
        }
        logScheduledJob('build_golf_course_emails_course_completed', {
          correlationId,
          golfCourseId: course.id,
          golfCourseName: course.name,
          emailCount: result.contacts.length,
          pagesAttempted: result.pagesAttempted,
          pagesFetched: result.pagesFetched,
          secondaryPageError: result.error || null,
        })
      } else if (result.error) {
        logScheduledJob('build_golf_course_emails_course_partial_failure', {
          correlationId,
          golfCourseId: course.id,
          golfCourseName: course.name,
          pagesAttempted: result.pagesAttempted,
          pagesFetched: result.pagesFetched,
          error: result.error,
          level: 'warn',
        })
      }
    } catch (error) {
      if (signal?.aborted || error?.code === 'SCHEDULED_JOB_CANCELLED') throw error
      stats.golfCoursesProcessed += 1
      stats.golfCoursesFailed += 1
      logError('Build Golf Course Emails course crawl failed; continuing to next course', {
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
        level: 'warn',
      })
    }
  })

  throwIfCancelled(signal)
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
  const output = { ...stats, outputFile: path.relative(PROJECT_ROOT, outputPath).replace(/\\/g, '/'), maxPageAttemptsPerCourse: MAX_PAGE_ATTEMPTS_PER_COURSE }
  logApi('build_golf_course_emails_completed', { correlationId, ...output })
  logScheduledJob('build_golf_course_emails_completed', { correlationId, ...output })
  return output
}
