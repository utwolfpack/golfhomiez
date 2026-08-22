import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'
import process from 'node:process'
import { getMountainTimeParts, mountainLocalTimeToUtc } from './cancelled-tournament-cleanup.js'
import { normalizeStateCode } from './us-states.js'
import { normalizeUsPhoneForDisplay } from './us-phone.js'

export const GET_TOURNAMENTS_TIME_ZONE = 'America/Denver'
export const GET_TOURNAMENTS_HOUR = 2
export const GET_TOURNAMENTS_MINUTE = 0

const TOURNAMENT_KEYWORDS = [
  'tournament',
  'scramble',
  'outing',
  'championship',
  'charity golf',
  'fundraiser',
  'golf classic',
  'member-guest',
  'member guest',
  'open championship',
]
const TOURNAMENT_LINK_KEYWORDS = [...TOURNAMENT_KEYWORDS, 'events', 'event', 'calendar']
const MONTHS = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
}
const MONTH_PATTERN = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')
const DEFAULT_MAX_PAGES_PER_COURSE = 4
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 2_000_000
const TOURNAMENT_SEARCH_PAGE_SIZE = 20
export const GOLF_HOMIEZ_TOURNAMENT_SOURCE = 'golfhomiez'
export const EXTERNAL_TOURNAMENT_SOURCE = 'external'
export const TOURNAMENT_DISCOVERY_MONTHS_AHEAD = 6

function intEnv(name, fallback, min, max) {
  const value = Number.parseInt(String(process.env[name] || ''), 10)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

function cancellationError(signal, output = null) {
  const reason = signal?.reason
  const error = reason instanceof Error ? reason : new Error('Scheduled job cancellation requested')
  if (!error.code) error.code = 'SCHEDULED_JOB_CANCELLED'
  if (output) error.output = { ...output, cancelled: true }
  return error
}

function throwIfCancelled(signal, output = null) {
  if (signal?.aborted) throw cancellationError(signal, output)
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

function normalizeFuzzyText(value) {
  return cleanText(value, 1000)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function levenshteinDistance(left, right, maxDistance = Infinity) {
  if (left === right) return 0
  if (!left) return right.length
  if (!right) return left.length
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    let rowMinimum = current[0]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const insertion = current[rightIndex - 1] + 1
      const deletion = previous[rightIndex] + 1
      const substitution = previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      const distance = Math.min(insertion, deletion, substitution)
      current.push(distance)
      rowMinimum = Math.min(rowMinimum, distance)
    }
    if (rowMinimum > maxDistance) return maxDistance + 1
    previous = current
  }
  return previous[right.length]
}

function fuzzyTokenMatch(candidateToken, queryToken) {
  if (candidateToken === queryToken) return true
  if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) return true
  const longest = Math.max(candidateToken.length, queryToken.length)
  const allowedDistance = longest >= 8 ? 2 : longest >= 4 ? 1 : 0
  return allowedDistance > 0 && levenshteinDistance(candidateToken, queryToken, allowedDistance) <= allowedDistance
}

export function fuzzyTextMatch(value, query) {
  const normalizedQuery = normalizeFuzzyText(query)
  if (!normalizedQuery) return true
  const normalizedValue = normalizeFuzzyText(value)
  if (!normalizedValue) return false
  if (normalizedValue.includes(normalizedQuery)) return true

  const candidateTokens = normalizedValue.split(' ').filter(Boolean)
  const queryTokens = normalizedQuery.split(' ').filter(Boolean)
  return queryTokens.every((queryToken) => candidateTokens.some((candidateToken) => fuzzyTokenMatch(candidateToken, queryToken)))
}

function zipCodeMatch(value, query) {
  const rawQuery = cleanText(query, 32)
  if (!rawQuery) return true
  const candidateDigits = String(value || '').replace(/\D/g, '')
  const queryDigits = rawQuery.replace(/\D/g, '')
  if (queryDigits) return candidateDigits.startsWith(queryDigits)
  return String(value || '').toLowerCase().startsWith(rawQuery.toLowerCase())
}

function dateOnlyUtc(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null
  return value
}

function addUtcMonths(date, months) {
  const result = new Date(date.getTime())
  const originalDay = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const lastDayOfTargetMonth = new Date(Date.UTC(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    0,
    12,
    0,
    0,
  )).getUTCDate()
  result.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth))
  return result
}

function todayUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0))
}

export function nextGetTournamentsRun(now = new Date(), timeZone = GET_TOURNAMENTS_TIME_ZONE) {
  const local = getMountainTimeParts(now, timeZone)
  const alreadyPassed = local.hour > GET_TOURNAMENTS_HOUR ||
    (local.hour === GET_TOURNAMENTS_HOUR && local.minute > GET_TOURNAMENTS_MINUTE) ||
    (local.hour === GET_TOURNAMENTS_HOUR && local.minute === GET_TOURNAMENTS_MINUTE && local.second > 0)
  const target = new Date(Date.UTC(local.year, local.month - 1, local.day + (alreadyPassed ? 1 : 0), 12, 0, 0))
  return mountainLocalTimeToUtc(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    GET_TOURNAMENTS_HOUR,
    GET_TOURNAMENTS_MINUTE,
    0,
    timeZone,
  )
}

function decodeHtmlEntities(value) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  }
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match)
}

function htmlToLines(html) {
  return decodeHtmlEntities(String(html || ''))
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|p|div|li|tr|section|article|h[1-6]|header|footer|main|aside)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .split(/\n+/)
    .map((line) => cleanText(line, 1200))
    .filter(Boolean)
}

function extractPageTitle(html) {
  const title = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''
  const heading = String(html || '').match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || ''
  return cleanText(decodeHtmlEntities((heading || title).replace(/<[^>]+>/g, ' ')), 255)
}

function hasTournamentKeyword(value) {
  const normalized = cleanText(value, 5000).toLowerCase()
  return TOURNAMENT_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

function buildDateFromParts(year, month, day, rangeStart, rangeEnd) {
  const date = dateOnlyUtc(year, month, day)
  if (!date || date < rangeStart || date > rangeEnd) return null
  return date
}

function inferYearForMonthDay(month, day, rangeStart, rangeEnd) {
  const years = [rangeStart.getUTCFullYear(), rangeStart.getUTCFullYear() + 1]
  for (const year of years) {
    const date = buildDateFromParts(year, month, day, rangeStart, rangeEnd)
    if (date) return date
  }
  return null
}

export function extractDateCandidates(value, { now = new Date(), maxDate = addUtcMonths(todayUtc(now), TOURNAMENT_DISCOVERY_MONTHS_AHEAD) } = {}) {
  const text = cleanText(value, 5000)
  const rangeStart = todayUtc(now)
  const rangeEnd = todayUtc(maxDate)
  const found = new Map()
  const add = (date) => {
    if (!date) return
    found.set(isoDate(date), date)
  }

  for (const match of text.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    add(buildDateFromParts(Number(match[1]), Number(match[2]), Number(match[3]), rangeStart, rangeEnd))
  }
  for (const match of text.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2}|\d{2})\b/g)) {
    let year = Number(match[3])
    if (year < 100) year += 2000
    add(buildDateFromParts(year, Number(match[1]), Number(match[2]), rangeStart, rangeEnd))
  }
  const monthFirst = new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, 'gi')
  for (const match of text.matchAll(monthFirst)) {
    const month = MONTHS[match[1].toLowerCase()]
    const day = Number(match[2])
    const date = match[3]
      ? buildDateFromParts(Number(match[3]), month, day, rangeStart, rangeEnd)
      : inferYearForMonthDay(month, day, rangeStart, rangeEnd)
    add(date)
  }
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\.?\\s+(20\\d{2})\\b`, 'gi')
  for (const match of text.matchAll(dayFirst)) {
    add(buildDateFromParts(Number(match[3]), MONTHS[match[2].toLowerCase()], Number(match[1]), rangeStart, rangeEnd))
  }

  return Array.from(found.values()).sort((a, b) => a.getTime() - b.getTime())
}

function candidateTitle(lines, index, pageTitle) {
  const nearby = [lines[index - 1], lines[index], lines[index + 1]].filter(Boolean)
  const tournamentLine = nearby.find((line) => hasTournamentKeyword(line)) || ''
  const title = cleanText(tournamentLine || pageTitle, 255)
  return title && title.length <= 255 ? title : null
}

export function extractTournamentCandidatesFromHtml(html, {
  courseId,
  golfCourseName,
  state,
  city = null,
  zipCode = null,
  sourceUrl,
  now = new Date(),
  maxDate = addUtcMonths(todayUtc(now), TOURNAMENT_DISCOVERY_MONTHS_AHEAD),
} = {}) {
  const lines = htmlToLines(html)
  const pageTitle = extractPageTitle(html)
  const pageContext = `${sourceUrl || ''} ${pageTitle}`
  const pageLooksTournamentRelated = hasTournamentKeyword(pageContext)
  const candidatesByDate = new Map()

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const nearby = [lines[index - 1], line, lines[index + 1]].filter(Boolean).join(' · ')
    if (!pageLooksTournamentRelated && !hasTournamentKeyword(nearby)) continue
    const dates = extractDateCandidates(nearby, { now, maxDate })
    for (const date of dates) {
      const dateString = isoDate(date)
      const title = candidateTitle(lines, index, pageTitle)
      const candidate = {
        golfCourseId: cleanText(courseId, 64) || null,
        golfCourseName: cleanText(golfCourseName, 191),
        tournamentName: title,
        state: normalizeStateCode(state),
        city: cleanText(city, 128) || null,
        zipCode: cleanText(zipCode, 32) || null,
        tournamentDate: dateString,
        tournamentWebsite: cleanText(sourceUrl, 1024) || null,
        sourceUrl: cleanText(sourceUrl, 1024),
        discoveredText: cleanText(nearby, 1500),
      }
      const existing = candidatesByDate.get(dateString)
      const quality = (item) => {
        const itemTitle = cleanText(item?.tournamentName, 255)
        const containsDate = extractDateCandidates(itemTitle, { now, maxDate }).length > 0
        return (containsDate ? 0 : 1000) + itemTitle.length
      }
      if (!existing || quality(candidate) > quality(existing)) candidatesByDate.set(dateString, candidate)
    }
  }

  return Array.from(candidatesByDate.values())
}

export function extractTournamentLinks(html, baseUrl, limit = DEFAULT_MAX_PAGES_PER_COURSE - 1) {
  const links = []
  const seen = new Set()
  for (const match of String(html || '').matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtmlEntities(match[1]).trim()
    const label = cleanText(decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ')), 300)
    const haystack = `${href} ${label}`.toLowerCase()
    if (!TOURNAMENT_LINK_KEYWORDS.some((keyword) => haystack.includes(keyword))) continue
    try {
      const resolved = new URL(href, baseUrl)
      const base = new URL(baseUrl)
      if (!['http:', 'https:'].includes(resolved.protocol) || resolved.origin !== base.origin) continue
      resolved.hash = ''
      const normalized = resolved.toString()
      if (seen.has(normalized) || normalized === base.toString()) continue
      seen.add(normalized)
      links.push(normalized)
      if (links.length >= limit) break
    } catch {
      // Ignore malformed links discovered in third-party page markup.
    }
  }
  return links
}

function normalizeWebsiteUrl(value) {
  const raw = cleanText(value, 2048)
  if (!raw) return null
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withProtocol)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function websiteComparisonKey(value) {
  const normalized = normalizeWebsiteUrl(value)
  if (normalized) {
    const url = new URL(normalized)
    url.hostname = url.hostname.toLowerCase()
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
      url.port = ''
    }
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString()
  }

  // Invalid values still need stable comparison so a repeatedly failing unchanged
  // website value can be routed to retryFailedTournamentWebsites instead of being
  // attempted by every getTournaments run.
  return cleanText(value, 2048).replace(/\/+$/, '').toLowerCase()
}

function hasFailedCrawlForCurrentWebsite(course) {
  if (cleanText(course?.crawl_state_last_status, 32).toLowerCase() !== 'failed') return false
  const currentWebsite = websiteComparisonKey(course?.golf_course_website)
  const failedWebsite = websiteComparisonKey(course?.crawl_state_website)
  return Boolean(currentWebsite && failedWebsite && currentWebsite === failedWebsite)
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true
  const [a, b] = parts
  return a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
}

function isPrivateIp(address) {
  const family = net.isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family === 6) {
    const normalized = address.toLowerCase()
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.')
  }
  return true
}

async function assertPublicHttpUrl(value) {
  const normalized = normalizeWebsiteUrl(value)
  if (!normalized) throw new Error('Golf course website is not a valid HTTP(S) URL')
  const url = new URL(normalized)
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw new Error('Local/private website addresses are not crawlable')
  const literalFamily = net.isIP(hostname)
  if (literalFamily && isPrivateIp(hostname)) throw new Error('Private network website addresses are not crawlable')
  if (!literalFamily) {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true })
    if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new Error('Website resolved to a private or unavailable network address')
  }
  return url.toString()
}

async function fetchText(url, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch, signal = null } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('HTTP fetch is unavailable in this Node runtime')
  throwIfCancelled(signal)
  let currentUrl = await assertPublicHttpUrl(url)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    throwIfCancelled(signal)
    const controller = new AbortController()
    const timeoutError = new Error(`Website request timed out after ${timeoutMs} ms`)
    timeoutError.code = 'TOURNAMENT_CRAWL_TIMEOUT'
    const onExternalAbort = () => controller.abort(signal?.reason || cancellationError(signal))
    if (signal) signal.addEventListener('abort', onExternalAbort, { once: true })
    const timeout = setTimeout(() => controller.abort(timeoutError), timeoutMs)
    try {
      const response = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'GolfHomiezTournamentDiscovery/1.0 (+https://golfhomiez.com)',
          'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2',
        },
      })
      throwIfCancelled(signal)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location) throw new Error(`Website redirect ${response.status} did not include a Location header`)
        currentUrl = await assertPublicHttpUrl(new URL(location, currentUrl).toString())
        continue
      }
      if (!response.ok) {
        const error = new Error(`Website returned HTTP ${response.status}`)
        error.statusCode = response.status
        throw error
      }
      const contentType = String(response.headers.get('content-type') || '').toLowerCase()
      if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml') && !contentType.includes('text/plain')) {
        throw new Error(`Unsupported website content type: ${contentType}`)
      }
      const declaredLength = Number(response.headers.get('content-length') || 0)
      if (declaredLength > MAX_RESPONSE_BYTES) throw new Error('Website response is too large to crawl safely')
      const text = await response.text()
      throwIfCancelled(signal)
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error('Website response exceeded the crawl size limit')
      return { url: currentUrl, text }
    } catch (error) {
      if (signal?.aborted) throw cancellationError(signal)
      if (controller.signal.aborted && controller.signal.reason?.code === 'TOURNAMENT_CRAWL_TIMEOUT') throw controller.signal.reason
      throw error
    } finally {
      clearTimeout(timeout)
      if (signal) signal.removeEventListener('abort', onExternalAbort)
    }
  }
  throw new Error('Website redirected too many times')
}

function robotsAgentMatches(agent, crawlerAgent) {
  if (agent === '*') return 0
  return crawlerAgent.includes(agent) ? agent.length : -1
}

export function parseRobotsTxt(text, crawlerAgent = 'golfhomieztournamentdiscovery') {
  const groups = []
  const sitemaps = []
  let current = null
  let currentHasRules = false

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const [name, ...rest] = line.split(':')
    const directive = name.trim().toLowerCase()
    const value = rest.join(':').trim()

    if (directive === 'sitemap' && value) {
      sitemaps.push(value)
      continue
    }
    if (directive === 'user-agent') {
      if (!current || currentHasRules) {
        current = { agents: [], rules: [] }
        groups.push(current)
        currentHasRules = false
      }
      if (value) current.agents.push(value.toLowerCase())
      continue
    }
    if ((directive === 'allow' || directive === 'disallow') && current) {
      currentHasRules = true
      if (value) current.rules.push({ type: directive, path: value })
    }
  }

  const agent = String(crawlerAgent || '').toLowerCase()
  let bestSpecificity = -1
  const matchingGroups = []
  for (const group of groups) {
    const specificity = Math.max(-1, ...group.agents.map((entry) => robotsAgentMatches(entry, agent)))
    if (specificity < 0) continue
    if (specificity > bestSpecificity) {
      bestSpecificity = specificity
      matchingGroups.length = 0
      matchingGroups.push(group)
    } else if (specificity === bestSpecificity) {
      matchingGroups.push(group)
    }
  }

  const allow = []
  const disallow = []
  for (const group of matchingGroups) {
    for (const rule of group.rules) {
      if (rule.type === 'allow') allow.push(rule.path)
      else disallow.push(rule.path)
    }
  }
  return { allow, disallow, sitemaps }
}

function robotsRuleMatches(path, rule) {
  const rawRule = String(rule || '')
  if (!rawRule) return false
  const anchored = rawRule.endsWith('$')
  const body = anchored ? rawRule.slice(0, -1) : rawRule
  const pattern = body
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path)
}

export function robotsAllows(url, rules = { allow: [], disallow: [] }) {
  const target = new URL(url)
  const path = `${target.pathname || '/'}${target.search || ''}`
  const matches = []
  for (const rule of rules.disallow || []) {
    if (robotsRuleMatches(path, rule)) matches.push({ type: 'disallow', length: String(rule).replace(/[*$]/g, '').length })
  }
  for (const rule of rules.allow || []) {
    if (robotsRuleMatches(path, rule)) matches.push({ type: 'allow', length: String(rule).replace(/[*$]/g, '').length })
  }
  if (!matches.length) return true
  matches.sort((a, b) => b.length - a.length || (a.type === 'allow' ? -1 : 1))
  return matches[0].type === 'allow'
}

async function readRobotsRules(rootUrl, options) {
  try {
    const root = new URL(rootUrl)
    const robotsUrl = `${root.origin}/robots.txt`
    const response = await fetchText(robotsUrl, options)
    return parseRobotsTxt(response.text)
  } catch (error) {
    if (options?.signal?.aborted) throw cancellationError(options.signal)
    if (error?.statusCode === 404 || error?.statusCode === 410) return { allow: [], disallow: [], sitemaps: [] }
    return { allow: [], disallow: [], sitemaps: [] }
  }
}

function discoveryKey(candidate) {
  const material = `${candidate.golfCourseId || candidate.golfCourseName}|${candidate.tournamentDate}`
  return crypto.createHash('sha256').update(material).digest('hex')
}

function golfHomiezDiscoveryKey(tournamentId) {
  return crypto.createHash('sha256').update(`golfhomiez:${String(tournamentId || '').trim()}`).digest('hex')
}

function golfHomiezTournamentPath(identifier, tournamentId) {
  return `/tournaments/${encodeURIComponent(cleanText(identifier || tournamentId, 191))}`
}

export async function syncGolfHomiezTournamentSearchRecord(db, tournamentId, {
  correlationId = `golfhomiez-tournament-sync-${crypto.randomUUID()}`,
  tournamentUrl = null,
} = {}) {
  const resolvedTournamentId = cleanText(tournamentId, 191)
  if (!resolvedTournamentId) throw new Error('Tournament id is required to synchronize the GolfHomiez tournament search record')

  const [rows] = await db.execute(
    `SELECT t.id, t.name, t.description, t.start_date, t.status, t.archived_at, t.tournament_identifier, t.host_account_id,
            COALESCE(NULLIF(TRIM(gc_by_id.id), ''), NULLIF(TRIM(gc_by_name.id), ''),
                     NULLIF(TRIM(gcpp.golf_course_id), ''), NULLIF(TRIM(ha.golf_course_id), '')) AS golf_course_id,
            COALESCE(NULLIF(TRIM(gc_by_id.name), ''), NULLIF(TRIM(gc_by_name.name), ''),
                     NULLIF(TRIM(gcpp.golf_course_name), ''), NULLIF(TRIM(ha.golf_course_name), ''),
                     NULLIF(TRIM(hra.golf_course_name), ''), 'Golf course') AS golf_course_name,
            COALESCE(NULLIF(TRIM(gc_by_id.state_code), ''), NULLIF(TRIM(gc_by_name.state_code), ''),
                     NULLIF(TRIM(gcpp.state_code), ''), '') AS state_code,
            COALESCE(NULLIF(TRIM(gc_by_id.city), ''), NULLIF(TRIM(gc_by_name.city), ''),
                     NULLIF(TRIM(gcpp.city), '')) AS city,
            COALESCE(NULLIF(TRIM(gc_by_id.postal_code), ''), NULLIF(TRIM(gc_by_name.postal_code), ''),
                     NULLIF(TRIM(gcpp.postal_code), '')) AS postal_code
       FROM tournaments t
       LEFT JOIN host_role_accounts hra ON BINARY hra.id = BINARY t.host_account_id
       LEFT JOIN host_accounts ha ON BINARY ha.id = BINARY t.host_account_id
       LEFT JOIN golf_course_public_pages gcpp ON BINARY gcpp.host_account_id = BINARY t.host_account_id
       LEFT JOIN golf_courses gc_by_id ON BINARY gc_by_id.id = BINARY COALESCE(ha.golf_course_id, gcpp.golf_course_id)
       LEFT JOIN golf_courses gc_by_name
         ON LOWER(TRIM(CONVERT(gc_by_name.name USING utf8mb4))) COLLATE utf8mb4_general_ci =
            LOWER(TRIM(CONVERT(COALESCE(NULLIF(gcpp.golf_course_name, ''), NULLIF(ha.golf_course_name, ''), NULLIF(hra.golf_course_name, '')) USING utf8mb4))) COLLATE utf8mb4_general_ci
        AND (COALESCE(NULLIF(TRIM(gcpp.state_code), ''), '') = ''
             OR LOWER(TRIM(CONVERT(gc_by_name.state_code USING utf8mb4))) COLLATE utf8mb4_general_ci =
                LOWER(TRIM(CONVERT(gcpp.state_code USING utf8mb4))) COLLATE utf8mb4_general_ci)
      WHERE t.id = ?
      LIMIT 1`,
    [resolvedTournamentId],
  )
  const tournament = rows[0] || null
  if (!tournament) return { action: 'not_found', tournamentId: resolvedTournamentId, active: false }

  const status = String(tournament.status || '').trim().toLowerCase()
  const visibleOnCoursePage = ['published', 'completed'].includes(status) && !tournament.archived_at
  if (!visibleOnCoursePage) {
    const [result] = await db.execute(
      `UPDATE golf_course_tournaments
          SET active = 0,
              last_seen_at = UTC_TIMESTAMP(),
              correlation_id = ?
        WHERE source_type = ?
          AND golfhomiez_tournament_id = ?`,
      [correlationId, GOLF_HOMIEZ_TOURNAMENT_SOURCE, resolvedTournamentId],
    )
    return {
      action: 'deactivated',
      tournamentId: resolvedTournamentId,
      active: false,
      affectedRows: Number(result?.affectedRows || 0),
    }
  }

  const tournamentDate = typeof tournament.start_date === 'string'
    ? tournament.start_date.slice(0, 10)
    : tournament.start_date instanceof Date
      ? isoDate(tournament.start_date)
      : ''
  if (!tournamentDate) throw new Error('Published GolfHomiez tournaments require a start date before they can appear in tournament search')

  const path = golfHomiezTournamentPath(tournament.tournament_identifier, tournament.id)
  const resolvedTournamentUrl = cleanText(tournamentUrl, 1024) || path
  const id = crypto.randomUUID()
  const key = golfHomiezDiscoveryKey(tournament.id)
  const discoveredText = cleanText([tournament.name, tournament.description].filter(Boolean).join(' '), 5000)

  await db.execute(
    `INSERT INTO golf_course_tournaments
      (id, discovery_key, golf_course_id, golf_course_name, tournament_name, state_code, city, zip_code,
       tournament_date, tournament_website, source_url, discovered_text, active, first_seen_at, last_seen_at,
       correlation_id, source_type, golfhomiez_tournament_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       golf_course_id = COALESCE(VALUES(golf_course_id), golf_course_id),
       golf_course_name = COALESCE(NULLIF(VALUES(golf_course_name), ''), golf_course_name),
       tournament_name = VALUES(tournament_name),
       state_code = VALUES(state_code),
       city = VALUES(city),
       zip_code = VALUES(zip_code),
       tournament_date = VALUES(tournament_date),
       tournament_website = VALUES(tournament_website),
       source_url = VALUES(source_url),
       discovered_text = VALUES(discovered_text),
       active = 1,
       last_seen_at = UTC_TIMESTAMP(),
       correlation_id = VALUES(correlation_id),
       source_type = VALUES(source_type),
       golfhomiez_tournament_id = VALUES(golfhomiez_tournament_id)`,
    [
      id,
      key,
      tournament.golf_course_id || null,
      cleanText(tournament.golf_course_name, 191) || 'Golf course',
      cleanText(tournament.name, 255) || 'GolfHomiez Tournament',
      cleanText(tournament.state_code, 8),
      cleanText(tournament.city, 128) || null,
      cleanText(tournament.postal_code, 32) || null,
      tournamentDate,
      resolvedTournamentUrl,
      resolvedTournamentUrl,
      discoveredText || null,
      correlationId,
      GOLF_HOMIEZ_TOURNAMENT_SOURCE,
      tournament.id,
    ],
  )

  return {
    action: 'upserted',
    tournamentId: tournament.id,
    active: true,
    tournamentPath: path,
    tournamentUrl: resolvedTournamentUrl,
    golfCourseId: tournament.golf_course_id || null,
    golfCourseName: cleanText(tournament.golf_course_name, 191) || 'Golf course',
  }
}

async function upsertTournament(db, candidate, correlationId) {
  const id = crypto.randomUUID()
  const key = discoveryKey(candidate)
  await db.execute(
    `INSERT INTO golf_course_tournaments
      (id, discovery_key, golf_course_id, golf_course_name, tournament_name, state_code, city, zip_code,
       tournament_date, tournament_website, source_url, discovered_text, active, first_seen_at, last_seen_at, correlation_id,
       source_type, golfhomiez_tournament_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       golf_course_name = VALUES(golf_course_name),
       tournament_name = COALESCE(NULLIF(VALUES(tournament_name), ''), tournament_name),
       state_code = VALUES(state_code),
       city = COALESCE(NULLIF(VALUES(city), ''), city),
       zip_code = COALESCE(NULLIF(VALUES(zip_code), ''), zip_code),
       tournament_website = COALESCE(NULLIF(VALUES(tournament_website), ''), tournament_website),
       source_url = VALUES(source_url),
       discovered_text = VALUES(discovered_text),
       active = 1,
       last_seen_at = UTC_TIMESTAMP(),
       correlation_id = VALUES(correlation_id),
       source_type = VALUES(source_type),
       golfhomiez_tournament_id = NULL`,
    [
      id, key, candidate.golfCourseId, candidate.golfCourseName, candidate.tournamentName, candidate.state,
      candidate.city, candidate.zipCode, candidate.tournamentDate, candidate.tournamentWebsite, candidate.sourceUrl,
      candidate.discoveredText, correlationId, EXTERNAL_TOURNAMENT_SOURCE,
    ],
  )
  return key
}

async function recordCrawlState(db, course, { status, pagesCrawled = 0, tournamentsFound = 0, error = null, correlationId }) {
  // Keep next_crawl_after NULL. getTournaments uses the matching website and last_status
  // fields to defer current failed URLs to retryFailedTournamentWebsites, while changed
  // website values remain eligible for the normal discovery job.
  const nextCrawlAt = null
  await db.execute(
    `INSERT INTO golf_course_tournament_crawl_state
      (golf_course_id, golf_course_name, website, last_crawled_at, last_success_at, next_crawl_after,
       last_status, last_error, pages_crawled, tournaments_found, correlation_id)
     VALUES (?, ?, ?, UTC_TIMESTAMP(), ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       golf_course_name = VALUES(golf_course_name),
       website = VALUES(website),
       last_crawled_at = UTC_TIMESTAMP(),
       last_success_at = COALESCE(VALUES(last_success_at), last_success_at),
       next_crawl_after = VALUES(next_crawl_after),
       last_status = VALUES(last_status),
       last_error = VALUES(last_error),
       pages_crawled = VALUES(pages_crawled),
       tournaments_found = VALUES(tournaments_found),
       correlation_id = VALUES(correlation_id)`,
    [
      course.id, course.name, course.golf_course_website,
      status === 'success' ? new Date() : null,
      nextCrawlAt,
      status,
      error ? cleanText(error, 2000) : null,
      pagesCrawled,
      tournamentsFound,
      correlationId,
    ],
  )
}

async function crawlCourseWebsite(db, course, { correlationId, logApi, logError, logScheduledJob, fetchImpl, signal = null, now = new Date(), maxDate = addUtcMonths(todayUtc(now), TOURNAMENT_DISCOVERY_MONTHS_AHEAD) }) {
  throwIfCancelled(signal)
  const rootUrl = normalizeWebsiteUrl(course.golf_course_website)
  if (!rootUrl) throw new Error('Golf course website is blank or invalid')
  const timeoutMs = intEnv('TOURNAMENT_CRAWL_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 1000, 30000)
  const maxPages = intEnv('TOURNAMENT_CRAWL_MAX_PAGES_PER_COURSE', DEFAULT_MAX_PAGES_PER_COURSE, 1, 10)
  const fetchOptions = { timeoutMs, fetchImpl, signal }
  const robots = await readRobotsRules(rootUrl, fetchOptions)
  throwIfCancelled(signal)
  if (!robotsAllows(rootUrl, robots)) {
    const result = {
      pagesCrawled: 0,
      tournamentsFound: 0,
      tournamentsStored: 0,
      skipped: true,
      skipReason: 'robots_disallowed',
    }
    logApi('tournament_crawl_course_skipped_robots', { correlationId, golfCourseId: course.id, golfCourseName: course.name, website: rootUrl })
    logScheduledJob('tournament_crawl_course_skipped_robots', { correlationId, golfCourseId: course.id, golfCourseName: course.name, website: rootUrl, level: 'info' })
    return result
  }

  const home = await fetchText(rootUrl, fetchOptions)
  const pageUrls = [home.url, ...extractTournamentLinks(home.text, home.url, maxPages - 1)].slice(0, maxPages)
  const candidateMap = new Map()
  let pagesCrawled = 0

  for (let index = 0; index < pageUrls.length; index += 1) {
    throwIfCancelled(signal)
    const pageUrl = pageUrls[index]
    if (!robotsAllows(pageUrl, robots)) continue
    let page = index === 0 ? home : null
    try {
      if (!page) page = await fetchText(pageUrl, fetchOptions)
      throwIfCancelled(signal)
      pagesCrawled += 1
      const candidates = extractTournamentCandidatesFromHtml(page.text, {
        courseId: course.id,
        golfCourseName: course.name,
        state: course.state_code,
        city: course.city,
        zipCode: course.postal_code,
        sourceUrl: page.url,
        now,
        maxDate,
      })
      for (const candidate of candidates) candidateMap.set(discoveryKey(candidate), candidate)
    } catch (error) {
      if (signal?.aborted) throw cancellationError(signal)
      logApi('tournament_crawl_page_failed', { correlationId, golfCourseId: course.id, golfCourseName: course.name, pageUrl, error: error?.message || String(error) })
      logScheduledJob('tournament_crawl_page_failed', { correlationId, golfCourseId: course.id, golfCourseName: course.name, pageUrl, level: 'warn', error: error?.message || String(error) })
    }
  }

  let stored = 0
  for (const candidate of candidateMap.values()) {
    throwIfCancelled(signal)
    try {
      await upsertTournament(db, candidate, correlationId)
      stored += 1
    } catch (error) {
      if (signal?.aborted) throw cancellationError(signal)
      logError('Tournament discovery upsert failed', { correlationId, golfCourseId: course.id, tournamentDate: candidate.tournamentDate, sourceUrl: candidate.sourceUrl, error })
    }
  }

  return { pagesCrawled, tournamentsFound: candidateMap.size, tournamentsStored: stored, skipped: false, skipReason: null }
}

export async function runGetTournaments(db, {
  correlationId = `getTournaments-${crypto.randomUUID()}`,
  triggeredBy = 'scheduled',
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
  fetchImpl = globalThis.fetch,
  signal = null,
  now = new Date(),
} = {}) {
  throwIfCancelled(signal)
  const discoveryStartDate = todayUtc(now)
  const discoveryEndDate = addUtcMonths(discoveryStartDate, TOURNAMENT_DISCOVERY_MONTHS_AHEAD)
  // Rebuild only the externally discovered catalog. GolfHomiez-hosted tournament
  // records are persistent application records and must survive every crawler refresh.
  await db.execute(
    `DELETE FROM golf_course_tournaments
      WHERE COALESCE(NULLIF(TRIM(source_type), ''), ?) <> ?`,
    [EXTERNAL_TOURNAMENT_SOURCE, GOLF_HOMIEZ_TOURNAMENT_SOURCE],
  )
  throwIfCancelled(signal)

  // Intentionally do not LIMIT this query. A single getTournaments run evaluates every
  // golf-course record that has a website value. Crawl state is included so an unchanged
  // website whose most recent attempt failed can be skipped and handled by the dedicated
  // retryFailedTournamentWebsites job. A changed website remains eligible immediately.
  // Prefer the source golf_courses.website column requested by the job specification,
  // while retaining golf_course_website as a compatibility fallback for existing data.
  const [courses] = await db.execute(
    `SELECT gc.id, gc.name, gc.state_code, gc.city, gc.postal_code,
            COALESCE(NULLIF(TRIM(gc.website), ''), NULLIF(TRIM(gc.golf_course_website), '')) AS golf_course_website,
            crawl.website AS crawl_state_website,
            crawl.last_status AS crawl_state_last_status,
            crawl.last_error AS crawl_state_last_error
       FROM golf_courses gc
       LEFT JOIN golf_course_tournament_crawl_state crawl
         ON crawl.golf_course_id = gc.id
      WHERE COALESCE(NULLIF(TRIM(gc.website), ''), NULLIF(TRIM(gc.golf_course_website), '')) IS NOT NULL
      ORDER BY gc.state_code ASC,
               gc.name ASC,
               gc.id ASC`,
  )

  const summary = {
    correlationId,
    candidateCourseCount: courses.length,
    coursesProcessed: 0,
    coursesSucceeded: 0,
    coursesSkipped: 0,
    coursesSkippedRobots: 0,
    coursesSkippedPreviousFailure: 0,
    coursesFailed: 0,
    crawlStateWriteFailures: 0,
    pagesCrawled: 0,
    tournamentsFound: 0,
    tournamentsStored: 0,
    failures: [],
    dateRangeStart: isoDate(discoveryStartDate),
    dateRangeEnd: isoDate(discoveryEndDate),
  }

  const addFailure = (course, phase, error) => {
    const message = error?.message || String(error)
    if (summary.failures.length < 100) {
      summary.failures.push({
        golfCourseId: course?.id || null,
        golfCourseName: course?.name || null,
        website: course?.golf_course_website || null,
        phase,
        error: message,
      })
    }
    return message
  }

  const persistCrawlState = async (course, state) => {
    try {
      throwIfCancelled(signal, summary)
      await recordCrawlState(db, course, { ...state, correlationId })
      return true
    } catch (stateError) {
      if (signal?.aborted) throw cancellationError(signal, summary)
      summary.crawlStateWriteFailures += 1
      const message = addFailure(course, 'crawl_state', stateError)
      logError('Tournament crawl state update failed; continuing to next golf course', {
        correlationId,
        golfCourseId: course.id,
        golfCourseName: course.name,
        website: course.golf_course_website,
        error: stateError,
      })
      logScheduledJob('tournament_crawl_state_update_failed', {
        correlationId,
        golfCourseId: course.id,
        golfCourseName: course.name,
        website: course.golf_course_website,
        level: 'error',
        error: message,
      })
      return false
    }
  }

  throwIfCancelled(signal, summary)
  logApi('get_tournaments_started', {
    correlationId,
    triggeredBy,
    candidateCourseCount: courses.length,
    allWebsiteRecordsEvaluated: true,
    matchingFailedWebsitesSkipped: true,
    dateRangeStart: summary.dateRangeStart,
    dateRangeEnd: summary.dateRangeEnd,
  })
  logScheduledJob('get_tournaments_started', {
    correlationId,
    triggeredBy,
    candidateCourseCount: courses.length,
    allWebsiteRecordsEvaluated: true,
    matchingFailedWebsitesSkipped: true,
    dateRangeStart: summary.dateRangeStart,
    dateRangeEnd: summary.dateRangeEnd,
  })

  for (const course of courses) {
    throwIfCancelled(signal, summary)
    summary.coursesProcessed += 1

    if (hasFailedCrawlForCurrentWebsite(course)) {
      summary.coursesSkipped += 1
      summary.coursesSkippedPreviousFailure += 1
      const skipDetails = {
        correlationId,
        golfCourseId: course.id,
        golfCourseName: course.name,
        state: course.state_code,
        website: course.golf_course_website,
        crawlStateWebsite: course.crawl_state_website,
        crawlStateLastStatus: course.crawl_state_last_status,
        previousError: cleanText(course.crawl_state_last_error, 2000) || null,
        reason: 'previous_failed_crawl_for_current_website',
        courseSequence: summary.coursesProcessed,
        candidateCourseCount: courses.length,
        continuing: true,
      }
      logApi('tournament_crawl_course_skipped_previous_failure', skipDetails)
      logScheduledJob('tournament_crawl_course_skipped_previous_failure', {
        ...skipDetails,
        level: 'warn',
      })
      continue
    }

    logApi('tournament_crawl_course_started', {
      correlationId,
      golfCourseId: course.id,
      golfCourseName: course.name,
      state: course.state_code,
      website: course.golf_course_website,
      courseSequence: summary.coursesProcessed,
      candidateCourseCount: courses.length,
    })

    try {
      const result = await crawlCourseWebsite(db, course, {
        correlationId,
        logApi,
        logError,
        logScheduledJob,
        fetchImpl,
        signal,
        now,
        maxDate: discoveryEndDate,
      })
      throwIfCancelled(signal, summary)
      summary.pagesCrawled += result.pagesCrawled
      summary.tournamentsFound += result.tournamentsFound
      summary.tournamentsStored += result.tournamentsStored

      if (result.skipped) {
        summary.coursesSkipped += 1
        if (result.skipReason === 'robots_disallowed') summary.coursesSkippedRobots += 1
        await persistCrawlState(course, {
          status: result.skipReason === 'robots_disallowed' ? 'skipped_robots' : 'skipped',
          ...result,
        })
        logApi('tournament_crawl_course_skipped', {
          correlationId,
          golfCourseId: course.id,
          golfCourseName: course.name,
          reason: result.skipReason,
        })
        continue
      }

      summary.coursesSucceeded += 1
      await persistCrawlState(course, { status: 'success', ...result })
      logApi('tournament_crawl_course_completed', {
        correlationId,
        golfCourseId: course.id,
        golfCourseName: course.name,
        ...result,
      })
    } catch (error) {
      // Cancellation is the only per-course condition allowed to stop the exhaustive run.
      // All crawl/extraction/persistence errors are captured and the loop continues with
      // the next golf_courses.website record.
      if (signal?.aborted || error?.code === 'SCHEDULED_JOB_CANCELLED') {
        throw cancellationError(signal, summary)
      }

      summary.coursesFailed += 1
      const message = addFailure(course, 'course_crawl', error)
      await persistCrawlState(course, { status: 'failed', error: message })
      logError('Tournament crawl failed for golf course; continuing to next website', {
        correlationId,
        golfCourseId: course.id,
        golfCourseName: course.name,
        website: course.golf_course_website,
        error,
      })
      logScheduledJob('tournament_crawl_course_failed', {
        correlationId,
        golfCourseId: course.id,
        golfCourseName: course.name,
        website: course.golf_course_website,
        level: 'error',
        error: message,
        continuing: true,
      })
      continue
    }
  }

  throwIfCancelled(signal, summary)
  logApi('get_tournaments_completed', summary)
  logScheduledJob('get_tournaments_completed', summary)
  return summary
}

export async function runRetryFailedTournamentWebsites(db, {
  correlationId = `retryFailedTournamentWebsites-${crypto.randomUUID()}`,
  triggeredBy = 'manual',
  logApi = () => {},
  logError = () => {},
  logScheduledJob = () => {},
  fetchImpl = globalThis.fetch,
  signal = null,
  now = new Date(),
} = {}) {
  throwIfCancelled(signal)
  const discoveryEndDate = addUtcMonths(todayUtc(now), TOURNAMENT_DISCOVERY_MONTHS_AHEAD)

  // Only retry a failure when the crawl-state website still matches the golf course's
  // current website value. If the website changed after the failure, getTournaments is
  // allowed to evaluate the new value normally instead of retrying a stale URL.
  const [courses] = await db.execute(
    `SELECT gc.id, gc.name, gc.state_code, gc.city, gc.postal_code,
            COALESCE(NULLIF(TRIM(gc.website), ''), NULLIF(TRIM(gc.golf_course_website), '')) AS golf_course_website,
            crawl.website AS crawl_state_website,
            crawl.last_status AS crawl_state_last_status,
            crawl.last_error AS crawl_state_last_error
       FROM golf_course_tournament_crawl_state crawl
       JOIN golf_courses gc
         ON gc.id = crawl.golf_course_id
      WHERE LOWER(TRIM(COALESCE(crawl.last_status, ''))) = 'failed'
        AND COALESCE(NULLIF(TRIM(gc.website), ''), NULLIF(TRIM(gc.golf_course_website), '')) IS NOT NULL
        AND TRIM(crawl.website) = TRIM(COALESCE(NULLIF(TRIM(gc.website), ''), NULLIF(TRIM(gc.golf_course_website), '')))
      ORDER BY gc.state_code ASC,
               gc.name ASC,
               gc.id ASC`,
  )

  const summary = {
    correlationId,
    candidateCourseCount: courses.length,
    coursesProcessed: 0,
    coursesSucceeded: 0,
    coursesSkipped: 0,
    coursesSkippedRobots: 0,
    coursesFailed: 0,
    crawlStateWriteFailures: 0,
    pagesCrawled: 0,
    tournamentsFound: 0,
    tournamentsStored: 0,
    failures: [],
  }

  const addFailure = (course, phase, error) => {
    const message = error?.message || String(error)
    if (summary.failures.length < 100) {
      summary.failures.push({
        golfCourseId: course?.id || null,
        golfCourseName: course?.name || null,
        website: course?.golf_course_website || null,
        phase,
        error: message,
      })
    }
    return message
  }

  const persistCrawlState = async (course, state) => {
    try {
      throwIfCancelled(signal, summary)
      await recordCrawlState(db, course, { ...state, correlationId })
      return true
    } catch (stateError) {
      if (signal?.aborted) throw cancellationError(signal, summary)
      summary.crawlStateWriteFailures += 1
      const message = addFailure(course, 'crawl_state', stateError)
      logError('Retry failed tournament website crawl-state update failed; continuing to next website', {
        correlationId,
        golfCourseId: course.id,
        golfCourseName: course.name,
        website: course.golf_course_website,
        error: stateError,
      })
      logScheduledJob('retry_failed_tournament_website_crawl_state_update_failed', {
        correlationId,
        golfCourseId: course.id,
        golfCourseName: course.name,
        website: course.golf_course_website,
        level: 'error',
        error: message,
      })
      return false
    }
  }

  logApi('retry_failed_tournament_websites_started', { correlationId, triggeredBy, candidateCourseCount: courses.length })
  logScheduledJob('retry_failed_tournament_websites_started', { correlationId, triggeredBy, candidateCourseCount: courses.length })

  for (const course of courses) {
    throwIfCancelled(signal, summary)
    summary.coursesProcessed += 1
    logApi('retry_failed_tournament_website_started', {
      correlationId,
      golfCourseId: course.id,
      golfCourseName: course.name,
      website: course.golf_course_website,
      priorError: course.crawl_state_last_error || null,
      courseSequence: summary.coursesProcessed,
      candidateCourseCount: courses.length,
    })

    try {
      const result = await crawlCourseWebsite(db, course, {
        correlationId,
        logApi,
        logError,
        logScheduledJob,
        fetchImpl,
        signal,
        now,
        maxDate: discoveryEndDate,
      })
      throwIfCancelled(signal, summary)
      summary.pagesCrawled += result.pagesCrawled
      summary.tournamentsFound += result.tournamentsFound
      summary.tournamentsStored += result.tournamentsStored

      if (result.skipped) {
        summary.coursesSkipped += 1
        if (result.skipReason === 'robots_disallowed') summary.coursesSkippedRobots += 1
        await persistCrawlState(course, {
          status: result.skipReason === 'robots_disallowed' ? 'skipped_robots' : 'skipped',
          ...result,
        })
        logApi('retry_failed_tournament_website_skipped', {
          correlationId,
          golfCourseId: course.id,
          golfCourseName: course.name,
          website: course.golf_course_website,
          reason: result.skipReason,
        })
        continue
      }

      summary.coursesSucceeded += 1
      await persistCrawlState(course, { status: 'success', ...result })
      logApi('retry_failed_tournament_website_completed', {
        correlationId,
        golfCourseId: course.id,
        golfCourseName: course.name,
        website: course.golf_course_website,
        ...result,
      })
      logScheduledJob('retry_failed_tournament_website_completed', {
        correlationId,
        golfCourseId: course.id,
        golfCourseName: course.name,
        website: course.golf_course_website,
        status: 'success',
        ...result,
      })
    } catch (error) {
      if (signal?.aborted || error?.code === 'SCHEDULED_JOB_CANCELLED') throw cancellationError(signal, summary)
      summary.coursesFailed += 1
      const message = addFailure(course, 'course_crawl', error)
      await persistCrawlState(course, { status: 'failed', error: message })
      logError('Retry failed tournament website crawl failed; continuing to next failed website', {
        correlationId,
        golfCourseId: course.id,
        golfCourseName: course.name,
        website: course.golf_course_website,
        error,
      })
      logScheduledJob('retry_failed_tournament_website_failed', {
        correlationId,
        golfCourseId: course.id,
        golfCourseName: course.name,
        website: course.golf_course_website,
        level: 'error',
        error: message,
        continuing: true,
      })
    }
  }

  throwIfCancelled(signal, summary)
  logApi('retry_failed_tournament_websites_completed', summary)
  logScheduledJob('retry_failed_tournament_websites_completed', summary)
  return summary
}

function parseIsoDate(value, fieldName) {
  const raw = cleanText(value, 20)
  if (!raw) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${fieldName} must use YYYY-MM-DD format`)
  const [year, month, day] = raw.split('-').map(Number)
  const parsed = dateOnlyUtc(year, month, day)
  if (!parsed) throw new Error(`${fieldName} is not a valid date`)
  return parsed
}

export function normalizeTournamentSearchFilters(filters = {}, now = new Date()) {
  const today = todayUtc(now)
  const maxDate = addUtcMonths(today, TOURNAMENT_DISCOVERY_MONTHS_AHEAD)
  const fromDate = parseIsoDate(filters.fromDate, 'From date') || today
  const toDate = parseIsoDate(filters.toDate, 'To date') || maxDate
  if (fromDate < today) throw new Error('From date cannot be before today')
  if (fromDate > maxDate) throw new Error('From date cannot be more than six months from today')
  if (toDate < fromDate) throw new Error('To date cannot be before from date')
  if (toDate > maxDate) throw new Error('To date cannot be more than six months from today')

  const state = normalizeStateCode(filters.state)
  const city = cleanText(filters.city, 128)
  const zipCode = cleanText(filters.zipCode || filters.zip, 32)
  const golfCourseName = cleanText(filters.golfCourseName || filters.course, 191)
  return {
    state,
    city,
    zipCode,
    golfCourseName,
    fromDate: isoDate(fromDate),
    toDate: isoDate(toDate),
  }
}

export async function searchGolfCourseTournaments(db, filters = {}, {
  now = new Date(),
  page = 1,
  viewerUserId = '',
  viewerEmail = '',
} = {}) {
  const normalized = normalizeTournamentSearchFilters(filters, now)
  const where = ['gct.active = 1', 'gct.tournament_date BETWEEN ? AND ?']
  const resolvedViewerUserId = cleanText(viewerUserId, 191)
  const resolvedViewerEmail = cleanText(viewerEmail, 191).toLowerCase()
  const params = [
    resolvedViewerUserId,
    resolvedViewerUserId,
    resolvedViewerEmail,
    resolvedViewerEmail,
    normalized.fromDate,
    normalized.toDate,
  ]
  if (normalized.state) {
    where.push('gct.state_code = ?')
    params.push(normalized.state)
  }

  // City and golf-course-name matching is intentionally performed in application code.
  // This avoids MySQL ESCAPE-clause differences that previously produced ER_PARSE_ERROR,
  // and allows typo-tolerant token matching instead of exact LIKE-only behavior. ZIP is
  // filtered here as well so %, _, and backslash input can never alter SQL wildcard rules.
  const [rows] = await db.execute(
    `SELECT gct.id, gct.golf_course_id, gct.golf_course_name, gct.tournament_name, gct.state_code, gct.city, gct.zip_code,
            gct.tournament_date, gct.tournament_website, gct.source_url, gct.first_seen_at, gct.last_seen_at,
            COALESCE(NULLIF(TRIM(gct.source_type), ''), '${EXTERNAL_TOURNAMENT_SOURCE}') AS source_type,
            gct.golfhomiez_tournament_id,
            gcpp_search.slug AS golf_course_public_page_slug,
            COALESCE(NULLIF(TRIM(gcpp_search.contact_phone), ''), NULLIF(TRIM(gc_search.phone), '')) AS golf_course_phone,
            COALESCE(NULLIF(TRIM(gc_search.website), ''), NULLIF(TRIM(gct.source_url), '')) AS golf_course_website,
            COALESCE(NULLIF(TRIM(t.tournament_identifier), ''), gct.golfhomiez_tournament_id) AS golfhomiez_tournament_identifier,
            CASE
              WHEN gct.source_type = '${GOLF_HOMIEZ_TOURNAMENT_SOURCE}'
               AND EXISTS (
                 SELECT 1
                   FROM tournament_registrations tr
                  WHERE BINARY tr.tournament_id = BINARY gct.golfhomiez_tournament_id
                    AND tr.status = 'registered'
                    AND ((? <> '' AND tr.auth_user_id = ?) OR (? <> '' AND LOWER(tr.email) = ?))
               )
              THEN 1 ELSE 0
            END AS is_registered
       FROM golf_course_tournaments gct
       LEFT JOIN tournaments t ON BINARY t.id = BINARY gct.golfhomiez_tournament_id
       LEFT JOIN golf_course_public_pages gcpp_search
         ON gcpp_search.is_published = 1
        AND gct.golf_course_id IS NOT NULL
        AND BINARY gcpp_search.golf_course_id = BINARY gct.golf_course_id
       LEFT JOIN golf_courses gc_search
         ON gct.golf_course_id IS NOT NULL
        AND BINARY gc_search.id = BINARY gct.golf_course_id
      WHERE ${where.join('\n        AND ')}
      ORDER BY CASE WHEN gct.source_type = '${GOLF_HOMIEZ_TOURNAMENT_SOURCE}' THEN 0 ELSE 1 END ASC,
               gct.tournament_date ASC, gct.state_code ASC, gct.golf_course_name ASC`,
    params,
  )

  const matchingRows = rows.filter((row) => (
    fuzzyTextMatch(row.city, normalized.city) &&
    zipCodeMatch(row.zip_code, normalized.zipCode) &&
    fuzzyTextMatch(row.golf_course_name, normalized.golfCourseName)
  ))

  const requestedPage = Math.max(Number.parseInt(String(page || 1), 10) || 1, 1)
  const totalResults = matchingRows.length
  const totalPages = totalResults === 0 ? 0 : Math.ceil(totalResults / TOURNAMENT_SEARCH_PAGE_SIZE)
  const resolvedPage = totalPages > 0 ? Math.min(requestedPage, totalPages) : 1
  const offset = (resolvedPage - 1) * TOURNAMENT_SEARCH_PAGE_SIZE
  const pageRows = matchingRows.slice(offset, offset + TOURNAMENT_SEARCH_PAGE_SIZE)

  return {
    filters: normalized,
    pagination: {
      page: resolvedPage,
      pageSize: TOURNAMENT_SEARCH_PAGE_SIZE,
      totalResults,
      totalPages,
    },
    tournaments: pageRows.map((row) => ({
      id: row.id,
      golfCourseId: row.golf_course_id || null,
      golfCourseName: row.golf_course_name,
      tournamentName: row.tournament_name || null,
      state: row.state_code,
      city: row.city || null,
      zipCode: row.zip_code || null,
      tournamentDate: typeof row.tournament_date === 'string' ? row.tournament_date.slice(0, 10) : isoDate(new Date(row.tournament_date)),
      tournamentWebsite: row.tournament_website || row.source_url || null,
      golfCoursePagePath: row.golf_course_public_page_slug ? `/${row.golf_course_public_page_slug}` : null,
      golfCoursePhone: normalizeUsPhoneForDisplay(row.golf_course_phone),
      golfCourseWebsiteUrl: row.golf_course_website || null,
      sourceUrl: row.source_url || null,
      sourceType: row.source_type || EXTERNAL_TOURNAMENT_SOURCE,
      isGolfHomiezTournament: row.source_type === GOLF_HOMIEZ_TOURNAMENT_SOURCE,
      golfHomiezTournamentId: row.golfhomiez_tournament_id || null,
      tournamentPath: row.source_type === GOLF_HOMIEZ_TOURNAMENT_SOURCE
        ? golfHomiezTournamentPath(row.golfhomiez_tournament_identifier, row.golfhomiez_tournament_id)
        : null,
      isRegistered: Boolean(Number(row.is_registered)),
      firstSeenAt: row.first_seen_at || null,
      lastSeenAt: row.last_seen_at || null,
    })),
  }
}
