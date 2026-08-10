import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'
import { logApi, logWarn } from './logger.js'

const MAX_WEBSITE_HTML_BYTES = 1_000_000
const WEBSITE_FETCH_TIMEOUT_MS = 7_500
const MAX_REDIRECTS = 3
const GOLF_COURSE_PAGE_USER_AGENT = 'GolfHomiezCoursePageBuilder/1.0 (+https://golfhomiez.com)'
const MAX_UPLOADED_BANNER_BYTES = 700 * 1024

function cleanText(value, maxLength = 5000) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

function estimateDataUrlBytes(value) {
  const encoded = String(value || '').split(',')[1] || ''
  return Math.ceil((encoded.length * 3) / 4)
}

export function sanitizeUploadedBannerData(value) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  if (!/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(normalized)) {
    throw new Error('Golf-course banner must be an uploaded JPG, PNG, or WebP image.')
  }
  if (estimateDataUrlBytes(normalized) > MAX_UPLOADED_BANNER_BYTES) {
    throw new Error('Golf-course banner is too large. Upload an image smaller than 700 KB after compression.')
  }
  return normalized
}

function normalizeStateCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
}

function normalizeCourseName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toLowerCase()
}

export function buildGolfCoursePageBaseSlug(golfCourseName, stateCode) {
  const namePart = normalizeCourseName(golfCourseName) || 'golfcourse'
  const statePart = normalizeStateCode(stateCode).toLowerCase() || 'us'
  return `${namePart}${statePart}`.slice(0, 180)
}

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    quot: '"',
    lt: '<',
    gt: '>',
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
  }
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, key) => named[key.toLowerCase()] ?? match)
}

function stripHtml(value) {
  return cleanText(decodeHtmlEntities(String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')), 5000)
}

function parseTagAttributes(tag) {
  const attributes = {}
  const attributePattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
  let match
  while ((match = attributePattern.exec(tag))) {
    attributes[String(match[1] || '').toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

function resolveWebsiteAssetUrl(value, websiteUrl) {
  const candidate = cleanText(value, 1024)
  if (!candidate) return null
  try {
    const url = new URL(candidate, websiteUrl)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return url.toString()
  } catch {
    return null
  }
}

export function extractGolfCourseWebsiteMetadata(html, websiteUrl) {
  const source = String(html || '')
  const meta = {}
  for (const tag of source.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = parseTagAttributes(tag)
    const key = String(attrs.property || attrs.name || '').trim().toLowerCase()
    const content = cleanText(attrs.content, 5000)
    if (key && content && !meta[key]) meta[key] = content
  }

  const titleMatch = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  const paragraphCandidates = [...source.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter((value) => value && value.length >= 40)

  const summary = cleanText(
    meta['og:description'] ||
    meta.description ||
    meta['twitter:description'] ||
    paragraphCandidates[0] ||
    '',
    2000,
  )
  const bannerImageUrl = resolveWebsiteAssetUrl(
    meta['og:image'] || meta['twitter:image'] || meta['twitter:image:src'] || '',
    websiteUrl,
  )

  return {
    title: cleanText(meta['og:title'] || stripHtml(titleMatch?.[1] || ''), 191),
    summary,
    bannerImageUrl,
  }
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

function isPrivateIpv6(address) {
  const normalized = String(address || '').toLowerCase().split('%')[0]
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
}

export function isPrivateNetworkAddress(address) {
  const family = net.isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family === 6) return isPrivateIpv6(address)
  return true
}

async function assertSafeWebsiteUrl(value) {
  const url = new URL(String(value || '').trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Golf-course website must use HTTP or HTTPS.')
  const hostname = url.hostname.toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Golf-course website hostname is not publicly routable.')
  }
  if (net.isIP(hostname)) {
    if (isPrivateNetworkAddress(hostname)) throw new Error('Golf-course website resolves to a private network address.')
    return url
  }
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some((entry) => isPrivateNetworkAddress(entry.address))) {
    throw new Error('Golf-course website resolves to a private network address.')
  }
  return url
}

async function readResponseTextWithLimit(response, maxBytes = MAX_WEBSITE_HTML_BYTES) {
  const length = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(length) && length > maxBytes) throw new Error('Golf-course website response exceeded the maximum supported size.')
  if (!response.body?.getReader) {
    const text = await response.text()
    if (Buffer.byteLength(text) > maxBytes) throw new Error('Golf-course website response exceeded the maximum supported size.')
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
      throw new Error('Golf-course website response exceeded the maximum supported size.')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function fetchGolfCourseWebsiteMetadata(websiteUrl, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return { summary: null, bannerImageUrl: null, title: null }
  let currentUrl = await assertSafeWebsiteUrl(websiteUrl)

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs) || WEBSITE_FETCH_TIMEOUT_MS)
    let response
    try {
      response = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'User-Agent': GOLF_COURSE_PAGE_USER_AGENT,
        },
      })
    } finally {
      clearTimeout(timeout)
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirectCount >= MAX_REDIRECTS) throw new Error('Golf-course website exceeded the redirect limit.')
      currentUrl = await assertSafeWebsiteUrl(new URL(location, currentUrl).toString())
      continue
    }
    if (!response.ok) throw new Error(`Golf-course website returned HTTP ${response.status}.`)
    const contentType = String(response.headers.get('content-type') || '').toLowerCase()
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error('Golf-course website did not return HTML content.')
    }
    const html = await readResponseTextWithLimit(response)
    return extractGolfCourseWebsiteMetadata(html, currentUrl.toString())
  }
  return { summary: null, bannerImageUrl: null, title: null }
}

function buildFallbackSummary(course) {
  const location = [cleanText(course?.city, 128), normalizeStateCode(course?.state_code)].filter(Boolean).join(', ')
  const details = [course?.holes_count ? `${course.holes_count} holes` : '', course?.par_total ? `par ${course.par_total}` : ''].filter(Boolean).join(', ')
  const locationText = location ? ` in ${location}` : ''
  const detailText = details ? ` featuring ${details}` : ''
  return `${course?.name || 'This golf course'} is a golf destination${locationText}${detailText}. Visit the course website for current course details, tee times, and operating information.`
}

async function findCatalogCourse(db, { golfCourseId = '', golfCourseName = '', stateCode = '' }) {
  const normalizedId = cleanText(golfCourseId, 64)
  const normalizedName = cleanText(golfCourseName, 191)
  const normalizedState = normalizeStateCode(stateCode)
  if (normalizedId) {
    const [rows] = await db.execute('SELECT * FROM golf_courses WHERE id = ? LIMIT 1', [normalizedId])
    if (rows[0]) return rows[0]
  }
  if (!normalizedName) return null
  const [rows] = await db.execute(
    `SELECT *
       FROM golf_courses
      WHERE (? = '' OR state_code = ?)
        AND (LOWER(TRIM(name)) = LOWER(?) OR normalized_name = ?)
      ORDER BY active DESC, name ASC
      LIMIT 1`,
    [normalizedState, normalizedState, normalizedName, normalizeCourseName(normalizedName)],
  )
  return rows[0] || null
}

async function nextAvailableSlug(db, baseSlug) {
  const [rows] = await db.execute(
    `SELECT slug
       FROM golf_course_public_pages
      WHERE slug = ? OR slug LIKE ?`,
    [baseSlug, `${baseSlug}%`],
  )
  const used = new Set((rows || []).map((row) => String(row.slug || '').toLowerCase()))
  if (!used.has(baseSlug)) return baseSlug
  let suffix = 2
  while (used.has(`${baseSlug}${suffix}`)) suffix += 1
  return `${baseSlug}${suffix}`
}

function mapTournament(row) {
  const identifier = row.tournament_identifier || row.id
  return {
    id: row.id,
    tournamentIdentifier: row.tournament_identifier || null,
    name: row.name || row.title || `Tournament ${row.id}`,
    startDate: row.start_date || null,
    status: row.status || null,
    portalPath: `/tournaments/${encodeURIComponent(identifier)}`,
  }
}

function mapPage(row, { baseUrl = '', tournaments = [] } = {}) {
  if (!row) return null
  const path = `/${row.slug}`
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/$/, '')
  return {
    id: row.id,
    hostAccountId: row.host_account_id,
    golfCourseId: row.golf_course_id || null,
    slug: row.slug,
    path,
    url: normalizedBaseUrl ? `${normalizedBaseUrl}${path}` : path,
    golfCourseName: row.golf_course_name,
    summary: row.summary || '',
    bannerImageUrl: row.banner_image_url || null,
    bannerImageData: row.banner_image_data || null,
    websiteUrl: row.website_url || null,
    contactPhone: row.contact_phone || null,
    addressLine1: row.address_line1 || null,
    city: row.city || null,
    stateCode: row.state_code || null,
    postalCode: row.postal_code || null,
    isPublished: Boolean(row.is_published),
    sourceWebsiteUrl: row.source_website_url || null,
    sourceLastSyncedAt: row.source_last_synced_at || null,
    tournamentCount: tournaments.length,
    tournaments,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

async function listPublicTournaments(db, hostAccountId) {
  const [rows] = await db.execute(
    `SELECT id, tournament_identifier, name, title, start_date, status
       FROM tournaments
      WHERE host_account_id = ?
        AND (is_public = 1 OR status = 'published')
        AND archived_at IS NULL
        AND COALESCE(status, '') NOT IN ('cancelled', 'deleted')
      ORDER BY CASE WHEN start_date IS NULL THEN 1 ELSE 0 END,
               start_date ASC,
               created_at DESC`,
    [hostAccountId],
  )
  return rows.map(mapTournament)
}

export async function createGolfCoursePublicPageForApprovedHost(db, input = {}) {
  const hostAccountId = cleanText(input.hostAccountId, 191)
  if (!hostAccountId) throw new Error('Host account id is required to create a golf-course page.')

  const [existingRows] = await db.execute('SELECT * FROM golf_course_public_pages WHERE host_account_id = ? LIMIT 1', [hostAccountId])
  if (existingRows[0]) return mapPage(existingRows[0], { baseUrl: input.baseUrl })

  const course = await findCatalogCourse(db, input)
  const golfCourseName = cleanText(course?.name || input.golfCourseName, 191)
  const stateCode = normalizeStateCode(course?.state_code || input.stateCode)
  if (!golfCourseName || !stateCode) throw new Error('Golf-course name and state are required to create the public page.')

  const sourceWebsiteUrl = cleanText(course?.golf_course_website || course?.website, 1024)
  let metadata = { summary: null, bannerImageUrl: null, title: null }
  if (sourceWebsiteUrl) {
    try {
      metadata = await fetchGolfCourseWebsiteMetadata(sourceWebsiteUrl, input)
      logApi('golf_course_public_page_source_loaded', {
        hostAccountId,
        golfCourseId: course?.id || null,
        website: sourceWebsiteUrl,
        hasSummary: Boolean(metadata.summary),
        hasBannerImage: Boolean(metadata.bannerImageUrl),
      })
    } catch (error) {
      logWarn('golf_course_public_page_source_load_failed', {
        hostAccountId,
        golfCourseId: course?.id || null,
        website: sourceWebsiteUrl,
        error,
      })
    }
  }

  const baseSlug = buildGolfCoursePageBaseSlug(golfCourseName, stateCode)
  let lastDuplicateError = null
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = await nextAvailableSlug(db, baseSlug)
    const pageId = crypto.randomUUID().replace(/-/g, '')
    try {
      await db.execute(
        `INSERT INTO golf_course_public_pages (
           id, host_account_id, golf_course_id, slug, golf_course_name, summary,
           banner_image_url, banner_image_data, website_url, contact_phone, address_line1, city,
           state_code, postal_code, source_website_url, source_last_synced_at,
           is_published, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          pageId,
          hostAccountId,
          course?.id || cleanText(input.golfCourseId, 64),
          slug,
          golfCourseName,
          metadata.summary || buildFallbackSummary(course || { name: golfCourseName, state_code: stateCode }),
          metadata.bannerImageUrl,
          null,
          sourceWebsiteUrl,
          cleanText(course?.phone, 64),
          cleanText(course?.address, 255),
          cleanText(course?.city, 128),
          stateCode,
          cleanText(course?.postal_code, 32),
          sourceWebsiteUrl,
          sourceWebsiteUrl ? new Date() : null,
        ],
      )
      await db.execute('UPDATE host_accounts SET golf_course_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [course?.id || cleanText(input.golfCourseId, 64), hostAccountId])
      const [rows] = await db.execute('SELECT * FROM golf_course_public_pages WHERE id = ? LIMIT 1', [pageId])
      const page = mapPage(rows[0], { baseUrl: input.baseUrl })
      logApi('golf_course_public_page_created', {
        hostAccountId,
        golfCourseId: page?.golfCourseId || null,
        slug: page?.slug || slug,
        publicPagePath: page?.path || `/${slug}`,
      })
      return page
    } catch (error) {
      if (String(error?.code || '') !== 'ER_DUP_ENTRY') throw error
      lastDuplicateError = error
    }
  }
  throw lastDuplicateError || new Error('Could not allocate a unique golf-course page URL.')
}

export async function getGolfCoursePublicPageByHostAccount(db, hostAccountId, options = {}) {
  const [rows] = await db.execute('SELECT * FROM golf_course_public_pages WHERE host_account_id = ? LIMIT 1', [hostAccountId])
  return mapPage(rows[0] || null, { baseUrl: options.baseUrl })
}

export async function getGolfCoursePublicPageBySlug(db, slug, options = {}) {
  const normalizedSlug = normalizeCourseName(slug).slice(0, 191)
  if (!normalizedSlug) return null
  const [rows] = await db.execute('SELECT * FROM golf_course_public_pages WHERE slug = ? AND is_published = 1 LIMIT 1', [normalizedSlug])
  if (!rows[0]) return null
  const tournaments = await listPublicTournaments(db, rows[0].host_account_id)
  return mapPage(rows[0], { baseUrl: options.baseUrl, tournaments })
}

function firstProvidedValue(input, keys, fallback) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) return input[key]
  }
  return fallback
}

export async function syncGolfCoursePublicPageCatalogDefaults(db, hostAccountId, options = {}) {
  const [rows] = await db.execute(
    `SELECT gcpp.*,
            gc.name AS catalog_golf_course_name,
            gc.phone AS catalog_phone,
            gc.address AS catalog_address_line1,
            gc.city AS catalog_city,
            gc.state_code AS catalog_state_code,
            gc.postal_code AS catalog_postal_code,
            COALESCE(NULLIF(TRIM(gc.website), ''), NULLIF(TRIM(gc.golf_course_website), '')) AS catalog_website_url
       FROM golf_course_public_pages gcpp
       LEFT JOIN golf_courses gc ON gc.id = gcpp.golf_course_id
      WHERE gcpp.host_account_id = ?
      LIMIT 1`,
    [hostAccountId],
  )
  const existing = rows[0]
  if (!existing) return null

  const values = {
    golfCourseName: cleanText(existing.catalog_golf_course_name || existing.golf_course_name, 191),
    websiteUrl: cleanText(existing.website_url || existing.catalog_website_url, 1024),
    contactPhone: cleanText(existing.contact_phone || existing.catalog_phone, 64),
    addressLine1: cleanText(existing.address_line1 || existing.catalog_address_line1, 255),
    city: cleanText(existing.city || existing.catalog_city, 128),
    stateCode: normalizeStateCode(existing.state_code || existing.catalog_state_code),
    postalCode: cleanText(existing.postal_code || existing.catalog_postal_code, 32),
  }

  const changed =
    values.golfCourseName !== cleanText(existing.golf_course_name, 191) ||
    values.websiteUrl !== cleanText(existing.website_url, 1024) ||
    values.contactPhone !== cleanText(existing.contact_phone, 64) ||
    values.addressLine1 !== cleanText(existing.address_line1, 255) ||
    values.city !== cleanText(existing.city, 128) ||
    values.stateCode !== normalizeStateCode(existing.state_code) ||
    values.postalCode !== cleanText(existing.postal_code, 32)

  if (changed) {
    await db.execute(
      `UPDATE golf_course_public_pages
          SET golf_course_name = ?, website_url = ?, contact_phone = ?, address_line1 = ?,
              city = ?, state_code = ?, postal_code = ?, updated_at = CURRENT_TIMESTAMP
        WHERE host_account_id = ?`,
      [
        values.golfCourseName,
        values.websiteUrl,
        values.contactPhone,
        values.addressLine1,
        values.city,
        values.stateCode,
        values.postalCode,
        hostAccountId,
      ],
    )
    logApi('golf_course_public_page_catalog_defaults_applied', {
      correlationId: options.correlationId || null,
      hostAccountId,
      golfCourseId: existing.golf_course_id || null,
      phoneApplied: Boolean(!existing.contact_phone && values.contactPhone),
      websiteApplied: Boolean(!existing.website_url && values.websiteUrl),
      addressApplied: Boolean(!existing.address_line1 && values.addressLine1),
    })
  }
  return getGolfCoursePublicPageByHostAccount(db, hostAccountId, options)
}

export async function updateGolfCoursePublicPageForHost(db, hostAccountId, input = {}, options = {}) {
  const [existingRows] = await db.execute('SELECT * FROM golf_course_public_pages WHERE host_account_id = ? LIMIT 1', [hostAccountId])
  const existing = existingRows[0]
  if (!existing) throw new Error('Golf-course public page not found.')

  const values = {
    golfCourseName: cleanText(firstProvidedValue(input, ['golfCourseName'], existing.golf_course_name), 191),
    summary: cleanText(firstProvidedValue(input, ['summary', 'publicPageSummary'], existing.summary), 5000),
    bannerImageUrl: cleanText(firstProvidedValue(input, ['bannerImageUrl', 'publicPageBannerImageUrl'], existing.banner_image_url), 1024),
    bannerImageData: sanitizeUploadedBannerData(firstProvidedValue(input, ['bannerImageData', 'publicPageBannerImageData'], existing.banner_image_data)),
    websiteUrl: cleanText(firstProvidedValue(input, ['websiteUrl', 'publicPageWebsiteUrl'], existing.website_url), 1024),
    contactPhone: cleanText(firstProvidedValue(input, ['contactPhone', 'publicContactPhone'], existing.contact_phone), 64),
    addressLine1: cleanText(firstProvidedValue(input, ['addressLine1', 'publicAddressLine1'], existing.address_line1), 255),
    city: cleanText(firstProvidedValue(input, ['city', 'publicCity'], existing.city), 128),
    stateCode: normalizeStateCode(firstProvidedValue(input, ['stateCode', 'publicStateCode'], existing.state_code)),
    postalCode: cleanText(firstProvidedValue(input, ['postalCode', 'publicPostalCode'], existing.postal_code), 32),
    isPublished: Object.prototype.hasOwnProperty.call(input, 'isPublished') ? Boolean(input.isPublished) : Boolean(existing.is_published),
  }
  if (!values.golfCourseName) throw new Error('Golf-course name is required.')
  if (!values.summary) throw new Error('Golf-course page summary is required.')
  if (!values.stateCode) throw new Error('Golf-course page state is required.')
  for (const [label, value] of [['Website URL', values.websiteUrl], ['Banner image URL', values.bannerImageUrl]]) {
    if (!value) continue
    let url
    try { url = new URL(value) } catch { throw new Error(`${label} must be a valid URL.`) }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label} must use HTTP or HTTPS.`)
  }

  await db.execute(
    `UPDATE golf_course_public_pages
        SET golf_course_name = ?, summary = ?, banner_image_url = ?, banner_image_data = ?, website_url = ?,
            contact_phone = ?, address_line1 = ?, city = ?, state_code = ?, postal_code = ?,
            is_published = ?, updated_at = CURRENT_TIMESTAMP
      WHERE host_account_id = ?`,
    [
      values.golfCourseName,
      values.summary,
      values.bannerImageUrl,
      values.bannerImageData,
      values.websiteUrl,
      values.contactPhone,
      values.addressLine1,
      values.city,
      values.stateCode,
      values.postalCode,
      values.isPublished ? 1 : 0,
      hostAccountId,
    ],
  )
  const page = await getGolfCoursePublicPageByHostAccount(db, hostAccountId, options)
  logApi('golf_course_public_page_updated', {
    hostAccountId,
    slug: page?.slug || null,
    isPublished: page?.isPublished ?? null,
    hasBannerImage: Boolean(page?.bannerImageData || page?.bannerImageUrl),
    hasUploadedBanner: Boolean(page?.bannerImageData),
    hasWebsite: Boolean(page?.websiteUrl),
  })
  return page
}
