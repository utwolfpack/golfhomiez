import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import { auth } from './auth.js'
import { getLatestPasswordReset, getLatestVerificationLink } from './auth-debug.js'
import storage from './storage/index.js'
import { getPool } from './db.js'
import { isValidPastOrTodayDate } from './lib/date-utils.js'
import { normalizeCreateTeamMembers, normalizeEmail, isEmail } from './lib/team-utils.js'
import { accessLogMiddleware, getLogPaths, logApi, logError, logFrontend, logInfo, requestContext, requestCorrelationMiddleware } from './lib/logger.js'
import { getNearestLocation as getNearestServerLocation, searchLocations as searchServerLocations } from './lib/location-service.js'
import { findGolfCourseForState, listGolfCourseNamesByState } from './lib/golf-course-service.js'
import { sendMail } from './mailer.js'
import { v4 as uuidv4 } from 'uuid'
import { authenticateHostLogin, clearHostSessionCookie, createHostPasswordReset, createHostSession, destroyHostSession, ensureHostAuthSchema, getHostAccountBySession, getHostPortalData, hostAuthMiddleware, redeemHostInvite, resetHostPassword, serializeHostSessionCookie } from './lib/host-auth.js'
import { authenticateOrganizerLogin, clearOrganizerSessionCookie, createOrganizerSession, destroyOrganizerSession, ensureOrganizerAuthSchema, getOrganizerAccountBySession, organizerAuthMiddleware, registerOrganizerAccount, serializeOrganizerSessionCookie } from './lib/organizer-auth.js'
import { approveHostAccountRequest, authenticateAdminRequest, clearAdminSessionCookie, createAdminResetToken, createAdminSessionCookie, refreshAdminSessionCookie, createAdminUser, createHostAccountRequest, createHostInvite, consumeAdminResetToken, deleteHostAccountRequest, getAdminUserByUsername, listAdminUsers, listPortalData, verifyPassword } from './lib/admin-portal.js'
import { buildOrganizerInviteDetails, createHostManagedTournament, createTournament, createTournamentOrganizerInvite, ensureTournamentInviteSchema, listHostAccounts, listHostManagedTournaments, listOrganizerTournaments, sanitizeOrganizerTournamentInvitePayload } from './lib/rbac.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.set('trust proxy', 1)
const PORT = Number(process.env.PORT)
if (!Number.isFinite(PORT) || PORT <= 0) throw new Error('PORT must be set to a valid positive number in the environment')
let storageReady = false
const clientOrigin = String(process.env.CLIENT_ORIGIN || '').trim()
const publicServerOrigin = String(process.env.BETTER_AUTH_URL || '').trim()
const allowedOrigins = new Set([
  clientOrigin,
  publicServerOrigin,
  process.env.DEV_CLIENT_ORIGIN,
  process.env.DEV_API_ORIGIN,
].filter(Boolean))

function getHostAppBaseUrl(req) {
  const explicit =
    process.env.APP_BASE_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.PUBLIC_WEB_URL ||
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    process.env.CLIENT_ORIGIN ||
    process.env.VITE_APP_URL ||
    ''

  const trimmed = String(explicit || '').trim()
  if (trimmed) return trimmed.replace(/\/$/, '')

  const originHeader = String(req?.headers?.origin || '').trim()
  if (originHeader) return originHeader.replace(/\/$/, '')

  const host = typeof req?.get === 'function' ? String(req.get('host') || '').trim() : ''
  if (host) return `${req.protocol || 'http'}://${host}`.replace(/\/$/, '')

  return clientOrigin || publicServerOrigin
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true)
    return callback(new Error(`CORS blocked for origin: ${origin}`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Timezone', 'X-Correlation-Id', 'X-Request-Id'],
}))
app.options('*', cors())
app.use(requestCorrelationMiddleware)
app.use(accessLogMiddleware)

const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')

app.get('/diag/pixel.gif', (req, res) => {
  logFrontend('frontend_stage', {

    correlationId: String(req.query.cid || '').trim() || null,
    stage: String(req.query.stage || '').trim() || 'unknown',
    detail: String(req.query.detail || '').trim() || null,
    path: String(req.query.path || req.path || '').trim() || null,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
    referer: req.headers.referer || null,
  })

  logApi('frontend_stage_pixel', { correlationId: req.correlationId || String(req.query.cid || '').trim() || null, path: String(req.query.path || req.path || '').trim() || null, detail: String(req.query.detail || '').trim() || null, stage: String(req.query.stage || '').trim() || 'unknown', ip: req.ip, userAgent: req.headers['user-agent'] || null })

  res.setHeader('Content-Type', 'image/gif')
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.send(TRANSPARENT_GIF)
})

app.get('/api/locations/search', (req, res) => {
  try {
    const query = String(req.query.q || '').trim()
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 20)
    const results = searchServerLocations(query, limit)
    logApi('location_search_completed', {
      ...requestContext(req),
      query,
      limit,
      resultCount: results.length,
    })
    res.json(results)
  } catch (error) {
    logRouteError('Location search error', req, error)
    res.status(500).json({ message: 'Location suggestions are temporarily unavailable.' })
  }
})

app.get('/api/golf-courses', async (req, res) => {
  try {
    const state = String(req.query.state || '').trim().toUpperCase()
    if (!state) return res.status(400).json({ message: 'state query parameter required' })

    const courses = await listGolfCourseNamesByState(state)
    logApi('golf_courses_list_completed', {
      ...requestContext(req),
      state,
      resultCount: courses.length,
    })
    return res.json(courses)
  } catch (error) {
    logRouteError('Golf course list error', req, error)
    return res.status(500).json({ message: 'Golf course catalog is temporarily unavailable.' })
  }
})

app.get('/api/locations/nearest', async (req, res) => {
  try {
    const latitude = Number(req.query.lat)
    const longitude = Number(req.query.lng)
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      return res.status(400).json({ message: 'lat and lng query parameters are required' })
    }

    const nearest = await getNearestServerLocation(latitude, longitude)
    logApi('location_nearest_completed', {
      ...requestContext(req),
      latitude,
      longitude,
      found: Boolean(nearest),
      selectedLabel: nearest?.label || null,
    })
    res.json(nearest || null)
  } catch (error) {
    logRouteError('Nearest location error', req, error)
    res.status(500).json({ message: 'Location lookup failed.' })
  }
})

app.all('/api/auth/*', toNodeHandler(auth))
app.use(express.json())

app.post(['/api/client-logs', '/api/client-log'], express.json({ limit: '64kb' }), (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const correlationId = String(body.correlationId || req.correlationId || '').trim() || req.correlationId || null
    const entry = {
      correlationId,
      level: String(body.level || 'info').trim() || 'info',
      type: String(body.type || 'frontend_event').trim() || 'frontend_event',
      message: String(body.message || 'frontend_event').trim() || 'frontend_event',
      action: body.action == null ? null : String(body.action),
      status: body.status == null ? null : String(body.status),
      route: body.route == null ? (req.headers.referer || null) : String(body.route),
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : null,
      userAgent: body.userAgent == null ? (req.headers['user-agent'] || null) : String(body.userAgent),
      source: req.headers['x-log-source'] || 'client',
      ip: req.ip,
    }

    logFrontend(entry.message, entry)
    logApi('client_log_ingested', {
      correlationId: entry.correlationId,
      type: entry.type,
      level: entry.level,
      route: entry.route,
      source: entry.source,
      path: req.originalUrl || req.url,
      ip: req.ip,
      userAgent: entry.userAgent,
    })

    return res.status(204).end()
  } catch (error) {
    logRouteError('Client log ingestion error', req, error, { body: req.body })
    return res.status(204).end()
  }
})

function logRouteError(message, req, error, extra = {}) {
  logError(message, {
    ...requestContext(req),
    ...extra,
    error,
  })
}

async function getAuthenticatedUserFromRequest(req) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
  if (!session?.user) return null
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  }
}

async function authMiddleware(req, res, next) {
  try {
    const user = await getAuthenticatedUserFromRequest(req)
    if (!user) return res.status(401).json({ message: 'Unauthorized' })
    req.user = user
    next()
  } catch (error) {
    logRouteError('Auth middleware error', req, error)
    res.status(500).json({ message: 'Authentication failed' })
  }
}

async function adminMiddleware(req, res, next) {
  try {
    const adminUser = await authenticateAdminRequest(req)
    if (!adminUser) return res.status(401).json({ message: 'Admin authentication required' })
    req.adminUser = adminUser
    res.setHeader('Set-Cookie', refreshAdminSessionCookie(adminUser))
    logApi('admin_session_ttl_refreshed', { ...requestContext(req), adminUserId: adminUser.id })
    next()
  } catch (error) {
    logRouteError('Admin middleware error', req, error)
    res.status(500).json({ message: 'Admin authentication failed' })
  }
}

function getApiBaseUrl(req) {
  return process.env.BETTER_AUTH_URL || `${req.protocol}://${req.get('host')}`
}

function getClientAppBaseUrl(req) {
  const requestOrigin = String(req.headers.origin || '').trim()
  if (requestOrigin && allowedOrigins.has(requestOrigin) && !/:(5001)$/.test(requestOrigin)) return requestOrigin
  return clientOrigin || getApiBaseUrl(req)
}

function buildRegisterInviteUrl(req, email) {
  const url = new URL('/register', getClientAppBaseUrl(req))
  url.searchParams.set('email', normalizeEmail(email))
  return url.toString()
}

function splitName(name = '', email = '') {
  const trimmed = String(name || '').trim()
  if (!trimmed) return { firstName: String(email || '').split('@')[0] || '', lastName: '' }
  const [firstName = '', ...rest] = trimmed.split(/\s+/)
  return { firstName, lastName: rest.join(' ') }
}

const ALCOHOL_PREFERENCES = new Set(['', 'alcohol_friendly'])
const CANNABIS_PREFERENCES = new Set(['', 'weed_friendly'])
const SOBRIETY_PREFERENCES = new Set(['', 'sober_only'])

function normalizeProfileValue(value) {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

function sanitizeProfilePayload(body = {}) {
  const primaryCity = normalizeProfileValue(body.primaryCity)
  const primaryState = normalizeProfileValue(body.primaryState)
  const primaryZipCode = normalizeProfileValue(body.primaryZipCode)
  const alcoholPreference = normalizeProfileValue(body.alcoholPreference) || ''
  const cannabisPreference = normalizeProfileValue(body.cannabisPreference) || ''
  const sobrietyPreference = normalizeProfileValue(body.sobrietyPreference) || ''

  if (!primaryCity || !primaryState || !primaryZipCode) {
    throw new Error('City, state, and zip code are required.')
  }
  if (!ALCOHOL_PREFERENCES.has(alcoholPreference)) throw new Error('Select a valid alcohol preference.')
  if (!CANNABIS_PREFERENCES.has(cannabisPreference)) throw new Error('Select a valid weed preference.')
  if (!SOBRIETY_PREFERENCES.has(sobrietyPreference)) throw new Error('Select a valid sobriety preference.')
  if (sobrietyPreference === 'sober_only' && (alcoholPreference === 'alcohol_friendly' || cannabisPreference === 'weed_friendly')) {
    throw new Error('Sober golf cannot be combined with alcohol or 420 preferences.')
  }

  return {
    primaryCity,
    primaryState,
    primaryZipCode,
    alcoholPreference,
    cannabisPreference,
    sobrietyPreference,
  }
}

async function ensureAppUserProfileRow(user) {
  const pool = getPool()
  await pool.execute(
    `INSERT INTO app_users (id, auth_user_id, email, name)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       email = VALUES(email),
       name = VALUES(name)`,
    [user.id, user.id, normalizeEmail(user.email), user.name || null],
  )

  const [rows] = await pool.execute(
    `SELECT id, auth_user_id, email, name,
            primary_city, primary_state, primary_zip_code,
            alcohol_preference, cannabis_preference, sobriety_preference,
            profile_enriched_at, created_at, updated_at
       FROM app_users
      WHERE auth_user_id = ?
      LIMIT 1`,
    [user.id],
  )
  return rows[0] || null
}

function mapProfileRow(row) {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    primaryCity: row.primary_city || '',
    primaryState: row.primary_state || '',
    primaryZipCode: row.primary_zip_code || '',
    alcoholPreference: row.alcohol_preference || '',
    cannabisPreference: row.cannabis_preference || '',
    sobrietyPreference: row.sobriety_preference || '',
    profileEnrichedAt: row.profile_enriched_at || null,
    needsEnrichment: !row.profile_enriched_at,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

function tournamentPortalPath(tournamentId) {
  return `/tournaments/${encodeURIComponent(String(tournamentId || ''))}`
}

function tournamentPortalUrl(req, tournamentId) {
  return new URL(tournamentPortalPath(tournamentId), getClientAppBaseUrl(req)).toString()
}

function mapTournamentRegistrationRow(row) {
  if (!row) return null
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    authUserId: row.auth_user_id || null,
    email: row.email || '',
    name: row.name || row.user_name || row.email || 'Registered golfer',
    status: row.status || 'registered',
    registeredAt: row.created_at || row.registered_at || null,
    updatedAt: row.updated_at || null,
  }
}

function mapTournamentPortalRow(row, req = null) {
  if (!row) return null
  return {
    id: row.id,
    organizerAccountId: row.organizer_account_id || null,
    hostAccountId: row.host_account_id || null,
    name: row.name || row.title,
    description: row.description,
    startDate: row.start_date || row.starts_at,
    endDate: row.end_date || row.ends_at,
    status: row.status,
    isPublic: Boolean(row.is_public),
    organizerName: row.organizer_name || null,
    hostGolfCourseName: row.host_golf_course_name || row.host_account_name || null,
    registrationCount: Number(row.registration_count || 0),
    registrations: Array.isArray(row.registrations) ? row.registrations : [],
    portalPath: tournamentPortalPath(row.tournament_identifier || row.id),
    portalUrl: req ? tournamentPortalUrl(req, row.tournament_identifier || row.id) : tournamentPortalPath(row.tournament_identifier || row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function listTournamentRegistrations(pool, tournamentIds = []) {
  const ids = [...new Set((tournamentIds || []).filter(Boolean).map((id) => String(id)))]
  if (!ids.length) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const [rows] = await pool.execute(
    `SELECT tr.id, tr.tournament_id, tr.auth_user_id, tr.email, tr.name, tr.status, tr.created_at, tr.updated_at
       FROM tournament_registrations tr
      WHERE tr.tournament_id IN (${placeholders})
        AND tr.status = 'registered'
      ORDER BY tr.created_at ASC`,
    ids,
  )
  const byTournament = new Map(ids.map((id) => [id, []]))
  for (const row of rows) {
    const tournamentId = String(row.tournament_id)
    if (!byTournament.has(tournamentId)) byTournament.set(tournamentId, [])
    byTournament.get(tournamentId).push(mapTournamentRegistrationRow(row))
  }
  return byTournament
}

async function attachTournamentRegistrations(pool, tournaments = []) {
  const registrationsByTournament = await listTournamentRegistrations(pool, tournaments.map((item) => item.id))
  return tournaments.map((item) => {
    const registrations = registrationsByTournament.get(String(item.id)) || []
    return { ...item, registrationCount: registrations.length, registrations }
  })
}

async function getTournamentPortalById(pool, tournamentId, req = null) {
  const [rows] = await pool.execute(
    `SELECT t.*, ora.organization_name AS organizer_name, hra.golf_course_name AS host_golf_course_name, ha.golf_course_name AS host_account_name,
            COUNT(tr.id) AS registration_count
       FROM tournaments t
       LEFT JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
       LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
       LEFT JOIN host_accounts ha ON ha.id = t.host_account_id
       LEFT JOIN tournament_registrations tr ON tr.tournament_id = t.id AND tr.status = 'registered'
      WHERE t.id = ? OR t.tournament_identifier = ?
      GROUP BY t.id
      LIMIT 1`,
    [tournamentId, tournamentId],
  )
  const row = rows[0]
  if (!row) return null
  const registrationsByTournament = await listTournamentRegistrations(pool, [row.id])
  const registrations = registrationsByTournament.get(String(row.id)) || []
  const tournament = { ...mapTournamentPortalRow({ ...row, registrations, registration_count: registrations.length }, req), tournamentIdentifier: row.tournament_identifier || null }
  return { tournament, registrationCount: registrations.length, registrations }
}

async function listTableColumns(pool, tableName) {
  const [rows] = await pool.execute(
    `SELECT COLUMN_NAME AS column_name
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName],
  )
  return new Set(rows.map((row) => row.column_name))
}

function columnExpr(columns, tableAlias, candidates, fallback = 'NULL') {
  const match = candidates.find((column) => columns.has(column))
  return match ? `${tableAlias}.${match}` : fallback
}

async function getOrganizerEditableTournament(pool, user, tournamentId) {
  const email = normalizeEmail(user?.email)
  const [organizerRows] = await pool.execute(
    `SELECT id FROM organizer_role_accounts
      WHERE auth_user_id = ? OR LOWER(email) = LOWER(?)`,
    [user?.id || '', email],
  )
  const organizerIds = organizerRows.map((row) => row.id).filter(Boolean)
  const organizerAccountFilter = organizerIds.length ? `OR t.organizer_account_id IN (${organizerIds.map(() => '?').join(',')})` : ''
  const params = [tournamentId, tournamentId, email, email, ...organizerIds]
  const [rows] = await pool.execute(
    `SELECT DISTINCT t.*, oti.id AS invite_id, oti.status AS invite_status
       FROM tournaments t
       LEFT JOIN organizer_tournament_invites oti ON oti.tournament_id = t.id
      WHERE (t.id = ? OR t.tournament_identifier = ?)
        AND (LOWER(COALESCE(oti.organizer_email, '')) = LOWER(?)
             OR LOWER(COALESCE(t.organizer_email, '')) = LOWER(?)
             ${organizerAccountFilter})
      LIMIT 1`,
    params,
  )
  return rows[0] || null
}

function sanitizeOrganizerTournamentUpdatePayload(body = {}) {
  const name = String(body.name || '').trim()
  if (!name) throw new Error('Tournament name is required.')
  const status = String(body.status || 'draft').trim()
  const allowedStatuses = new Set(['draft', 'published', 'completed', 'cancelled'])
  if (!allowedStatuses.has(status)) throw new Error('Tournament status is invalid.')
  return {
    name,
    description: body.description == null ? null : String(body.description).trim() || null,
    startDate: body.startDate ? String(body.startDate).slice(0, 10) : null,
    endDate: body.endDate ? String(body.endDate).slice(0, 10) : null,
    status,
    isPublic: Boolean(body.isPublic),
  }
}

async function updateOrganizerInvitedTournament(pool, user, tournamentId, input, req = null) {
  const existing = await getOrganizerEditableTournament(pool, user, tournamentId)
  if (!existing) return null
  await pool.execute(
    `UPDATE tournaments
        SET name = ?, description = ?, start_date = ?, end_date = ?, status = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [input.name, input.description, input.startDate, input.endDate, input.status, input.isPublic ? 1 : 0, existing.id],
  )
  const portal = await getTournamentPortalById(pool, existing.id, req)
  return portal?.tournament || null
}

async function getOrganizerPortalSummary(pool, user, req) {
  const email = normalizeEmail(user?.email)
  const organizerColumns = await listTableColumns(pool, 'organizer_role_accounts')
  const tournamentColumns = await listTableColumns(pool, 'tournaments')
  const inviteColumns = await listTableColumns(pool, 'organizer_tournament_invites')

  const organizerNameExpr = columnExpr(organizerColumns, 'ora', ['organization_name', 'organizer_name'], 'NULL')
  const roleAssignmentExpr = columnExpr(organizerColumns, 'ora', ['role_assignment_id'], 'NULL')
  const contactNameExpr = columnExpr(organizerColumns, 'ora', ['contact_name'], organizerNameExpr)
  const phoneExpr = columnExpr(organizerColumns, 'ora', ['phone'], 'NULL')
  const websiteExpr = columnExpr(organizerColumns, 'ora', ['website_url'], 'NULL')
  const notesExpr = columnExpr(organizerColumns, 'ora', ['notes'], 'NULL')
  const roleJoin = organizerColumns.has('role_assignment_id') ? 'LEFT JOIN user_role_assignments ura ON ura.id = ora.role_assignment_id' : 'LEFT JOIN user_role_assignments ura ON ura.auth_user_id = ora.auth_user_id OR LOWER(ura.email) = LOWER(ora.email)'

  const [organizerRows] = await pool.execute(
    `SELECT ora.id,
            ${roleAssignmentExpr} AS role_assignment_id,
            COALESCE(ora.auth_user_id, ura.auth_user_id) AS auth_user_id,
            COALESCE(ora.email, ura.email) AS email,
            ${organizerNameExpr} AS organization_name,
            ${contactNameExpr} AS contact_name,
            ${phoneExpr} AS phone,
            ${websiteExpr} AS website_url,
            ${notesExpr} AS notes,
            COALESCE(ura.role_key, 'organizer') AS role,
            ora.created_at,
            ora.updated_at
       FROM organizer_role_accounts ora
       ${roleJoin}
      WHERE COALESCE(ora.auth_user_id, ura.auth_user_id) = ?
         OR LOWER(COALESCE(ora.email, ura.email, '')) = LOWER(?)
      ORDER BY ora.updated_at DESC, ora.created_at DESC
      LIMIT 1`,
    [user.id, email],
  )

  const organizerRow = organizerRows[0] || null
  const organizerAccount = organizerRow
    ? {
        id: organizerRow.id,
        roleAssignmentId: organizerRow.role_assignment_id || '',
        authUserId: organizerRow.auth_user_id || user.id,
        email: organizerRow.email || email,
        role: organizerRow.role || 'organizer',
        organizationName: organizerRow.organization_name || organizerRow.contact_name || email,
        contactName: organizerRow.contact_name || organizerRow.organization_name || email,
        phone: organizerRow.phone || null,
        websiteUrl: organizerRow.website_url || null,
        notes: organizerRow.notes || null,
        createdAt: organizerRow.created_at || null,
        updatedAt: organizerRow.updated_at || null,
      }
    : null

  const tournamentTitleExpr = columnExpr(tournamentColumns, 't', ['name', 'title'], "''")
  const startDateExpr = columnExpr(tournamentColumns, 't', ['start_date', 'starts_at'], 'NULL')
  const endDateExpr = columnExpr(tournamentColumns, 't', ['end_date', 'ends_at'], 'NULL')
  const isPublicExpr = columnExpr(tournamentColumns, 't', ['is_public'], '1')
  const organizerEmailExpr = columnExpr(tournamentColumns, 't', ['organizer_email'], 'NULL')
  const tournamentIdentifierExpr = columnExpr(tournamentColumns, 't', ['tournament_identifier'], 'NULL')
  const organizerJoinNameExpr = columnExpr(organizerColumns, 'ora', ['organization_name', 'organizer_name'], 'NULL')
  const organizerAccountFilter = organizerAccount ? 't.organizer_account_id = ? OR' : ''
  const inviteJoin = inviteColumns.size
    ? 'LEFT JOIN organizer_tournament_invites oti ON oti.tournament_id = t.id'
    : 'LEFT JOIN (SELECT NULL AS tournament_id, NULL AS organizer_email, NULL AS id, NULL AS status, NULL AS invite_url) oti ON oti.tournament_id = t.id'
  const params = organizerAccount ? [organizerAccount.id, email, email] : [email, email]

  const [tournamentRows] = await pool.execute(
    `SELECT DISTINCT t.*,
            ${tournamentTitleExpr} AS name,
            ${startDateExpr} AS start_date,
            ${endDateExpr} AS end_date,
            ${isPublicExpr} AS is_public,
            ${organizerEmailExpr} AS organizer_email,
            ${tournamentIdentifierExpr} AS tournament_identifier,
            ${organizerJoinNameExpr} AS organizer_name,
            COALESCE(hra.golf_course_name, ha.golf_course_name) AS host_golf_course_name,
            oti.id AS invite_id,
            oti.status AS invite_status,
            oti.invite_url AS invite_url
       FROM tournaments t
       LEFT JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
       LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
       LEFT JOIN host_accounts ha ON ha.id = t.host_account_id
       ${inviteJoin}
      WHERE ${organizerAccountFilter} LOWER(COALESCE(t.organizer_email, '')) = LOWER(?)
         OR LOWER(COALESCE(oti.organizer_email, '')) = LOWER(?)
      ORDER BY start_date DESC, t.created_at DESC`,
    params,
  )

  const tournaments = tournamentRows.map((row) => ({
    ...mapTournamentPortalRow(row, req),
    tournamentIdentifier: row.tournament_identifier || null,
    organizerEmail: row.organizer_email || null,
    inviteId: row.invite_id || null,
    inviteStatus: row.invite_status || null,
    inviteUrl: row.invite_url || null,
    registrationUrl: String(row.status || '') === 'published' ? tournamentPortalUrl(req, row.tournament_identifier || row.id) : null,
  }))

  return {
    organizerAccount,
    tournaments: await attachTournamentRegistrations(pool, tournaments),
  }
}

async function listHostPortalTournaments(pool, hostAccount, req = null) {
  const [rows] = await pool.execute(
    `SELECT DISTINCT t.*, ora.organization_name AS organizer_name,
            COALESCE(hra.golf_course_name, ha.golf_course_name) AS host_golf_course_name
       FROM tournaments t
       LEFT JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
       LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
       LEFT JOIN user_role_assignments host_ura ON host_ura.id = hra.role_assignment_id
       LEFT JOIN host_accounts ha ON ha.id = t.host_account_id
      WHERE t.host_account_id = ?
         OR LOWER(COALESCE(hra.golf_course_name, ha.golf_course_name, '')) = LOWER(?)
         OR LOWER(COALESCE(host_ura.email, ha.email, '')) = LOWER(?)
      ORDER BY t.start_date DESC, t.created_at DESC`,
    [hostAccount?.id || '', hostAccount?.golfCourseName || hostAccount?.golf_course_name || '', hostAccount?.email || ''],
  )
  const tournaments = rows.map((row) => ({
    ...mapTournamentPortalRow(row, req),
    tournamentIdentifier: row.tournament_identifier || null,
    organizerEmail: row.organizer_email || null,
    registrationUrl: String(row.status || '') === 'published' ? (req ? tournamentPortalUrl(req, row.tournament_identifier || row.id) : tournamentPortalPath(row.tournament_identifier || row.id)) : null,
  }))
  return attachTournamentRegistrations(pool, tournaments)
}

async function getHostEditableTournament(pool, hostAccount, tournamentId) {
  const [rows] = await pool.execute(
    `SELECT DISTINCT t.*
       FROM tournaments t
       LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
       LEFT JOIN user_role_assignments host_ura ON host_ura.id = hra.role_assignment_id
       LEFT JOIN host_accounts ha ON ha.id = t.host_account_id
      WHERE (t.id = ? OR t.tournament_identifier = ?)
        AND (t.host_account_id = ?
             OR LOWER(COALESCE(hra.golf_course_name, ha.golf_course_name, '')) = LOWER(?)
             OR LOWER(COALESCE(host_ura.email, ha.email, '')) = LOWER(?))
      LIMIT 1`,
    [tournamentId, tournamentId, hostAccount?.id || '', hostAccount?.golfCourseName || hostAccount?.golf_course_name || '', hostAccount?.email || ''],
  )
  return rows[0] || null
}

async function updateHostOwnedTournament(pool, hostAccount, tournamentId, input, req = null) {
  const existing = await getHostEditableTournament(pool, hostAccount, tournamentId)
  if (!existing) return null
  await pool.execute(
    `UPDATE tournaments
        SET name = ?, description = ?, start_date = ?, end_date = ?, status = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [input.name, input.description, input.startDate, input.endDate, input.status, input.isPublic ? 1 : 0, existing.id],
  )
  const portal = await getTournamentPortalById(pool, existing.id, req)
  return portal?.tournament ? {
    ...portal.tournament,
    tournamentIdentifier: portal.tournament.tournamentIdentifier || existing.tournament_identifier || null,
    organizerEmail: existing.organizer_email || null,
    registrationUrl: input.status === 'published' ? tournamentPortalUrl(req, existing.tournament_identifier || existing.id) : null,
  } : null
}

async function sendRegistrationInviteEmail(req, { toEmail, customMessage, invitedBy, teamId = null, purpose = 'registration_invite' }) {
  const inviteUrl = buildRegisterInviteUrl(req, toEmail)
  const inviterLabel = invitedBy?.name || invitedBy?.email || 'Your Golf Homie'
  const messageText = String(customMessage || '').trim()
  const subject = 'You are invited to join Golf Homiez'
  const text = [
    messageText,
    '',
    `${inviterLabel} invited you to join Golf Homiez.`,
    'Track rounds, build teams, log scores, and keep your golf crew together in one place.',
    `Register here: ${inviteUrl}`,
  ].filter(Boolean).join('\n')
  const html = `
    <p>${messageText || `${inviterLabel} wants you on Golf Homiez.`}</p>
    <p><strong>${inviterLabel}</strong> invited you to join Golf Homiez.</p>
    <p>Keep your rounds, teams, and golf score history together in one place.</p>
    <p><a href="${inviteUrl}">Create your Golf Homiez account</a></p>
  `

  await sendMail({ to: toEmail, subject, text, html })

  try {
    const pool = getPool()
    await pool.execute(
      'INSERT INTO invitations (id, email, invited_by_user_id, invited_by_email, team_id, purpose, custom_message, invite_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [uuidv4(), normalizeEmail(toEmail), invitedBy?.id || null, invitedBy?.email || null, teamId, purpose, messageText || null, inviteUrl],
    )
  } catch (error) {
    logError('Invitation persistence failed', { error, email: toEmail, invitedByEmail: invitedBy?.email || null, teamId, purpose })
  }

  logApi('registration_invite_sent', { ...requestContext(req), email: normalizeEmail(toEmail), invitedByEmail: invitedBy?.email || null, teamId, purpose, inviteUrl })
  return { ok: true, inviteUrl }
}


function redirectToClientApp(req, res) {
  const target = new URL(req.originalUrl || req.url || '/', getClientAppBaseUrl(req))
  return res.redirect(302, target.toString())
}

async function proxyClientApp(req, res, next) {
  try {
    const target = new URL(req.originalUrl || req.url || '/', getClientAppBaseUrl(req))
    const upstream = await fetch(target, {
      method: 'GET',
      headers: {
        accept: req.get('accept') || 'text/html,*/*',
        'user-agent': req.get('user-agent') || 'GolfHomiezProxy/1.0',
      },
    })

    const contentType = upstream.headers.get('content-type')
    if (contentType) res.setHeader('Content-Type', contentType)
    const cacheControl = upstream.headers.get('cache-control')
    if (cacheControl) res.setHeader('Cache-Control', cacheControl)
    const location = upstream.headers.get('location')
    if (location) {
      const rewritten = new URL(location, target)
      rewritten.protocol = `${req.protocol}:`
      rewritten.host = req.get('host')
      res.setHeader('Location', rewritten.toString())
    }

    res.status(upstream.status)
    const body = Buffer.from(await upstream.arrayBuffer())
    return res.send(body)
  } catch (error) {
    logRouteError('Client app proxy error', req, error)
    return next()
  }
}

app.get(['/register', '/login', '/verify-contact', '/golfadmin', '/golfadmin/forgot-password', '/golfadmin/reset-password', '/host/register', '/host/redeem', '/host/login', '/host/request-password-reset', '/host/reset-password', '/host/portal'], async (req, res, next) => {
  const distDir = path.join(__dirname, '..', 'dist')
  if (fs.existsSync(distDir)) return next()

  const host = String(req.get('host') || '')
  let clientHost = ''
  try {
    clientHost = clientOrigin ? new URL(clientOrigin).host : ''
  } catch {
    clientHost = ''
  }

  const shouldProxyToClient = Boolean(clientOrigin) && Boolean(clientHost) && !host.includes(clientHost)
  if (shouldProxyToClient) return proxyClientApp(req, res, next)

  return next()
})

app.post('/api/admin/auth/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    if (!username) return res.status(400).json({ message: 'Username is required' })
    if (!password) return res.status(400).json({ message: 'Password is required' })

    const adminUser = await getAdminUserByUsername(username)
    if (!adminUser || !adminUser.is_active) {
      return res.status(401).json({ message: 'Invalid username or password' })
    }

    const verified = verifyPassword(password, adminUser.password_salt, adminUser.password_hash)
    if (!verified) return res.status(401).json({ message: 'Invalid username or password' })

    res.setHeader('Set-Cookie', createAdminSessionCookie(adminUser))
    logApi('admin_login_completed', { ...requestContext(req), adminUserId: adminUser.id, username: adminUser.username })
    res.json({ adminUser: { id: adminUser.id, username: adminUser.username, email: adminUser.email, isActive: !!adminUser.is_active } })
  } catch (error) {
    logRouteError('Admin login error', req, error)
    res.status(500).json({ message: 'Could not sign in to admin portal' })
  }
})

app.post('/api/admin/auth/logout', async (req, res) => {
  try {
    res.setHeader('Set-Cookie', clearAdminSessionCookie())
    res.status(204).end()
  } catch (error) {
    logRouteError('Admin logout error', req, error)
    res.status(500).json({ message: 'Could not sign out of admin portal' })
  }
})

app.get('/api/admin/session', async (req, res) => {
  try {
    const adminUser = await authenticateAdminRequest(req)
    if (adminUser) {
      res.setHeader('Set-Cookie', refreshAdminSessionCookie(adminUser))
      logApi('admin_session_ttl_refreshed', { ...requestContext(req), adminUserId: adminUser.id })
    }
    res.json({ adminUser: adminUser ? { id: adminUser.id, username: adminUser.username, email: adminUser.email, isActive: !!adminUser.is_active } : null })
  } catch (error) {
    logRouteError('Admin session fetch error', req, error)
    res.status(500).json({ message: 'Could not load admin session' })
  }
})

app.post('/api/admin/request-password-reset', async (req, res) => {
  try {
    const identifier = String(req.body?.identifier || req.body?.username || '').trim()
    if (!identifier) return res.status(400).json({ message: 'Username is required' })

    const adminUser = await getAdminUserByUsername(identifier)
    if (!adminUser) return res.json({ ok: true })

    await createAdminResetToken(adminUser.id)
    logApi('admin_password_reset_requested', { ...requestContext(req), adminUserId: adminUser.id, username: adminUser.username })
    res.json({ ok: true })
  } catch (error) {
    logRouteError('Admin password reset request error', req, error)
    res.status(500).json({ message: 'Could not start admin password reset' })
  }
})

app.post('/api/admin/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim()
    const password = String(req.body?.password || '')
    if (!token) return res.status(400).json({ message: 'Reset token required' })
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' })

    await consumeAdminResetToken(token, password)
    logApi('admin_password_reset_completed', { ...requestContext(req) })
    res.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && /invalid or expired/i.test(error.message)) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Admin password reset error', req, error)
    res.status(500).json({ message: 'Could not reset admin password' })
  }
})

app.get('/api/admin/portal', adminMiddleware, async (req, res) => {
  try {
    const data = await listPortalData()
    res.json({ ...data, adminUser: { id: req.adminUser.id, username: req.adminUser.username, email: req.adminUser.email, isActive: !!req.adminUser.is_active } })
  } catch (error) {
    logRouteError('Admin portal load error', req, error)
    res.status(500).json({ message: 'Could not load admin portal' })
  }
})

app.post('/api/admin/admin-users', adminMiddleware, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim()
    const email = normalizeEmail(req.body?.email)
    const password = String(req.body?.password || '')
    if (!username) return res.status(400).json({ message: 'Username is required' })
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid email is required' })
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' })

    const adminUser = await createAdminUser({ username, email, password })
    const adminUsers = await listAdminUsers()
    logApi('admin_user_created', { ...requestContext(req), createdAdminUserId: adminUser.id, adminUserId: req.adminUser.id })
    res.status(201).json({ adminUser, adminUsers })
  } catch (error) {
    logRouteError('Create admin user error', req, error)
    res.status(500).json({ message: 'Could not create admin user' })
  }
})

app.post('/api/admin/host-invites', adminMiddleware, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)
    const inviteeName = String(req.body?.inviteeName || '').trim()
    const golfCourseName = String(req.body?.golfCourseName || '').trim()
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid email is required' })
    if (!inviteeName) return res.status(400).json({ message: 'Invitee name is required' })
    if (!golfCourseName) return res.status(400).json({ message: 'Golf-course name is required' })

    const invite = await createHostInvite({ email, inviteeName, golfCourseName, adminUserId: req.adminUser.id })
    logApi('host_invite_created', { ...requestContext(req), adminUserId: req.adminUser.id, email, golfCourseName, inviteId: invite.id })
    res.status(201).json({ invite })
  } catch (error) {
    logRouteError('Create host invite error', req, error)
    res.status(500).json({ message: 'Could not create host invite' })
  }
})
app.post('/api/admin/host-account-requests/:id/approve', adminMiddleware, async (req, res) => {
  try {
    const requestId = String(req.params.id || '').trim()
    if (!requestId) return res.status(400).json({ message: 'Request id is required' })

    const result = await approveHostAccountRequest({
      requestId,
      adminUserId: req.adminUser.id,
      adminEmail: req.adminUser.email,
    })
    logApi('host_account_request_approved', { ...requestContext(req), requestId, adminUserId: req.adminUser.id, hostAccountId: result.hostAccountId || null })
    res.json(result)
  } catch (error) {
    if (error instanceof Error && /not found|already been reviewed/i.test(error.message)) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Approve host account request error', req, error)
    res.status(500).json({ message: 'Could not approve golf-course account request' })
  }
})


app.delete('/api/admin/host-account-requests/:id', adminMiddleware, async (req, res) => {
  try {
    const requestId = String(req.params.id || '').trim()
    if (!requestId) return res.status(400).json({ message: 'Request id is required' })

    const result = await deleteHostAccountRequest({
      requestId,
      adminUserId: req.adminUser.id,
      adminEmail: req.adminUser.email,
    })
    logApi('host_account_request_deleted', { ...requestContext(req), requestId, adminUserId: req.adminUser.id })
    res.json(result)
  } catch (error) {
    if (error instanceof Error && /not found|only pending/i.test(error.message)) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Delete host account request error', req, error)
    res.status(500).json({ message: 'Could not delete golf-course account request' })
  }
})

app.get('/api/host/session', async (req, res) => {
  try {
    const db = getPool()
    await ensureHostAuthSchema(db)
    const cookies = Object.fromEntries(
      String(req.headers.cookie || '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const idx = part.indexOf('=')
          return idx >= 0 ? [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))] : [part, '']
        }),
    )
    const hostSessionId = cookies.golfhomiez_host_session || ''
    const hostAccount = await getHostAccountBySession(req, hostSessionId)
    if (hostAccount) {
      res.setHeader('Set-Cookie', serializeHostSessionCookie(hostSessionId))
      logApi('host_session_ttl_refreshed', { ...requestContext(req), hostAccountId: hostAccount.id })
    }
    res.json({ hostAccount })
  } catch (error) {
    logRouteError('Host session fetch error', req, error)
    res.status(500).json({ message: 'Could not load host session' })
  }
})

app.post('/api/host/account-requests', async (req, res) => {
  try {
    const firstName = String(req.body?.firstName || '').trim()
    const lastName = String(req.body?.lastName || '').trim()
    const email = normalizeEmail(req.body?.email)
    const stateCode = String(req.body?.stateCode || '').trim().toUpperCase()
    const stateName = String(req.body?.stateName || '').trim()
    const golfCourseName = String(req.body?.golfCourseName || '').trim()
    const representativeDetails = String(req.body?.representativeDetails || '').trim()
    const password = String(req.body?.password || '')

    if (!firstName) return res.status(400).json({ message: 'First name is required.' })
    if (!lastName) return res.status(400).json({ message: 'Last name is required.' })
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid email address is required.' })
    if (!stateCode) return res.status(400).json({ message: 'State is required.' })
    if (!stateName) return res.status(400).json({ message: 'State is required.' })
    if (!golfCourseName) return res.status(400).json({ message: 'Golf course is required.' })
    if (!representativeDetails) return res.status(400).json({ message: 'Representative details are required.' })
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters.' })

    const request = await createHostAccountRequest({
      firstName,
      lastName,
      email,
      stateCode,
      stateName,
      golfCourseName,
      representativeDetails,
      password,
    })
    logApi('host_account_request_created', { ...requestContext(req), email, golfCourseName, stateCode, requestId: request.id })
    return res.status(201).json({ request })
  } catch (error) {
    logRouteError('Host account request error', req, error)
    return res.status(500).json({ message: 'Could not submit golf-course account request' })
  }
})

app.post('/api/host/register', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)
    const golfCourseName = String(req.body?.golfCourseName || '').trim()
    const securityKey = String(req.body?.securityKey || '').trim()
    const password = String(req.body?.password || '')
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid invite email is required' })
    if (!golfCourseName) return res.status(400).json({ message: 'Golf-course name is required' })
    if (!securityKey) return res.status(400).json({ message: 'Security key is required' })
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' })

    const db = getPool()
    const hostAccount = await redeemHostInvite(db, { email, golfCourseName, securityKey, password })
    const session = await createHostSession(db, hostAccount.id)
    res.setHeader('Set-Cookie', serializeHostSessionCookie(session.id, session.expiresAt))
    logApi('host_register_completed', { ...requestContext(req), email, golfCourseName, hostAccountId: hostAccount.id })
    res.status(201).json({ hostAccount })
  } catch (error) {
    if (error instanceof Error && /invite email and security key/i.test(error.message)) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host register error', req, error)
    res.status(500).json({ message: 'Could not create golf-course account' })
  }
})

app.post('/api/host/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)
    const password = String(req.body?.password || '')
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid email is required' })
    if (!password) return res.status(400).json({ message: 'Password is required' })
    const db = getPool()
    const hostAccount = await authenticateHostLogin(db, { email, password })
    if (!hostAccount) return res.status(401).json({ message: 'Invalid email or password' })
    const session = await createHostSession(db, hostAccount.id)
    res.setHeader('Set-Cookie', serializeHostSessionCookie(session.id, session.expiresAt))
    logApi('host_login_completed', { ...requestContext(req), email, hostAccountId: hostAccount.id })
    res.json({ hostAccount })
  } catch (error) {
    if (error instanceof Error && /Invalid email or password/i.test(error.message)) {
      return res.status(401).json({ message: error.message })
    }
    logRouteError('Host login error', req, error)
    res.status(500).json({ message: 'Could not sign in to golf-course account' })
  }
})

app.post('/api/host/logout', async (req, res) => {
  try {
    const db = getPool()
    await destroyHostSession(db, req)
    res.setHeader('Set-Cookie', clearHostSessionCookie())
    res.status(204).end()
  } catch (error) {
    logRouteError('Host logout error', req, error)
    res.status(500).json({ message: 'Could not sign out of golf-course account' })
  }
})

app.post('/api/host/request-password-reset', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid email is required' })
    const db = getPool()
    await createHostPasswordReset(db, { email, resetUrlBase: getHostAppBaseUrl(req) })
    logApi('host_password_reset_requested', { ...requestContext(req), email })
    res.json({ ok: true })
  } catch (error) {
    logRouteError('Host password reset request error', req, error)
    res.status(500).json({ message: 'Could not start golf-course password reset' })
  }
})

app.post('/api/host/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim()
    const password = String(req.body?.password || '')
    if (!token) return res.status(400).json({ message: 'Reset token required' })
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' })
    const db = getPool()
    await resetHostPassword(db, { token, password })
    logApi('host_password_reset_completed', { ...requestContext(req) })
    res.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && /invalid or expired/i.test(error.message)) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host password reset error', req, error)
    res.status(500).json({ message: 'Could not reset golf-course password' })
  }
})

app.get('/api/host/portal', hostAuthMiddleware, async (req, res) => {
  try {
    const db = getPool()
    const data = await getHostPortalData(db, req.hostAccount.id)
    if (!data) return res.status(404).json({ message: 'Golf-course account not found' })
    const account = data.account || data.host || req.hostAccount
    const tournaments = await listHostPortalTournaments(db, account, req)
    logApi('host_portal_loaded', { ...requestContext(req), hostAccountId: account?.id || req.hostAccount.id, tournamentCount: tournaments.length })
    res.json({ ...data, account, host: data.host || account, tournaments })
  } catch (error) {
    logRouteError('Host portal load error', req, error)
    res.status(500).json({ message: 'Could not load golf-course portal' })
  }
})


app.post('/api/host/tournaments', hostAuthMiddleware, async (req, res) => {
  try {
    const db = getPool()
    await ensureTournamentInviteSchema(db)
    const tournament = await createHostManagedTournament(db, req.hostAccount.id, req.body || {})
    logApi('host_tournament_created', { ...requestContext(req), hostAccountId: req.hostAccount.id, tournamentId: tournament.id, tournamentIdentifier: tournament.tournamentIdentifier, name: tournament.name })
    res.status(201).json({ tournament })
  } catch (error) {
    if (error instanceof Error && /Tournament|required|invalid/i.test(error.message)) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host tournament create error', req, error)
    res.status(500).json({ message: 'Could not create tournament' })
  }
})

app.put('/api/host/tournaments/:id', hostAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const input = sanitizeOrganizerTournamentUpdatePayload(req.body || {})
    const tournament = await updateHostOwnedTournament(getPool(), req.hostAccount, tournamentId, input, req)
    if (!tournament) {
      logApi('host_tournament_update_not_found', { ...requestContext(req), hostAccountId: req.hostAccount?.id || null, tournamentId })
      return res.status(404).json({ message: 'Tournament not found for this golf-course account.' })
    }
    logApi('host_tournament_updated', { ...requestContext(req), hostAccountId: req.hostAccount.id, tournamentId: tournament.id, status: tournament.status })
    res.json(tournament)
  } catch (error) {
    if (error instanceof Error && /required|invalid/i.test(error.message)) {
      logApi('host_tournament_update_validation_failed', { ...requestContext(req), validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host tournament update error', req, error)
    res.status(500).json({ message: 'Could not update tournament' })
  }
})

app.post('/api/host/tournaments/:id/invite', hostAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    if (!tournamentId) return res.status(400).json({ message: 'Tournament id is required.' })
    const payload = sanitizeOrganizerTournamentInvitePayload(req.body || {})
    const db = getPool()
    await ensureTournamentInviteSchema(db)
    const tournaments = await listHostManagedTournaments(db, req.hostAccount.id)
    const tournament = tournaments.find((item) => item.id === tournamentId)
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this host account.' })
    const inviteDetails = await buildOrganizerInviteDetails(db, payload.organizerEmail, tournament.tournamentIdentifier)
    const organizerUrl = `${getHostAppBaseUrl(req)}${inviteDetails.invitePath}?${inviteDetails.inviteQuery}`
    const invite = await createTournamentOrganizerInvite(db, { tournamentId, hostAccountId: req.hostAccount.id, organizerEmail: payload.organizerEmail, inviteUrl: organizerUrl })

    const subject = `Golf Homiez organizer invite for ${tournament.name}`
    const organizerActionLine = inviteDetails.organizerAccount
      ? `You already have an organizer account. Log in here: ${organizerUrl}`
      : `Create your organizer access here: ${organizerUrl}`
    const messageText = payload.message || `${req.hostAccount.golfCourseName || 'A host'} invited you to manage the tournament ${tournament.name}.`
    const tournamentUrl = `${getHostAppBaseUrl(req)}/organizer/portal?tournament=${encodeURIComponent(tournament.tournamentIdentifier)}`

    await sendMail({
      to: payload.organizerEmail,
      subject,
      text: [
        messageText,
        `Tournament: ${tournament.name}`,
        `Tournament identifier: ${tournament.tournamentIdentifier}`,
        organizerActionLine,
        `Organizer portal: ${tournamentUrl}`,
      ].join('\n'),
      html: `
        <p>${messageText}</p>
        <p><strong>Tournament:</strong> ${tournament.name}</p>
        <p><strong>Tournament identifier:</strong> ${tournament.tournamentIdentifier}</p>
        <p><a href="${organizerUrl}">${inviteDetails.organizerAccount ? 'Login to organizer portal' : 'Create organizer access'}</a></p>
        <p>After signing in, you will land on the <a href="${tournamentUrl}">organizer portal</a>.</p>
      `,
    })

    logApi('host_tournament_invite_sent', { ...requestContext(req), hostAccountId: req.hostAccount.id, tournamentId, tournamentIdentifier: tournament.tournamentIdentifier, organizerEmail: payload.organizerEmail, inviteId: invite.id, organizerInviteUrl: organizerUrl })
    res.status(201).json({ invite, organizerUrl })
  } catch (error) {
    if (error instanceof Error && /Organizer email is required/.test(error.message)) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host tournament invite error', req, error)
    res.status(500).json({ message: 'Could not send organizer invite' })
  }
})

async function findTeamByName(name) {
  return storage.getTeamByName(name)
}

async function isUserOnTeam(teamName, userEmail) {
  const team = await findTeamByName(teamName)
  if (!team) return false
  const e = normalizeEmail(userEmail)
  return (team.members || []).some((m) => normalizeEmail(m.email) === e)
}

app.get('/api/health', async (req, res) => {
  const backend = await storage.getBackendName().catch(() => 'unavailable')
  res.status(storageReady ? 200 : 503).json({ ok: storageReady, storage: backend })
})

function requireStorage(req, res, next) {
  if (storageReady) return next()
  return res.status(503).json({ message: 'Service temporarily unavailable' })
}

app.get('/api/auth-debug/latest-reset', (req, res) => {
  const email = String(req.query.email || '').trim()
  if (!email) return res.status(400).json({ message: 'email query parameter required' })
  const latest = getLatestPasswordReset(email)
  res.json(latest || null)
})

app.get('/api/auth-debug/latest-verification', (req, res) => {
  const email = String(req.query.email || '').trim()
  if (!email) return res.status(400).json({ message: 'email query parameter required' })
  const latest = getLatestVerificationLink(email)
  res.json(latest || null)
})


app.get('/api/golf-course-hosts', requireStorage, organizerAuthMiddleware, async (req, res) => {
  try {
    const hosts = await listHostAccounts(getPool())
    logApi('golf_course_hosts_list_completed', { ...requestContext(req), resultCount: hosts.length })
    res.json(hosts)
  } catch (error) {
    logRouteError('Golf-course host list error', req, error)
    res.status(500).json({ message: 'Could not load golf-course hosts' })
  }
})

app.get('/api/tournaments', requireStorage, organizerAuthMiddleware, async (req, res) => {
  try {
    const tournaments = await listOrganizerTournaments(getPool(), req.organizerUser.id)
    const withPortalLinks = tournaments.map((tournament) => ({ ...tournament, portalPath: tournamentPortalPath(tournament.id), portalUrl: tournamentPortalUrl(req, tournament.id) }))
    logApi('organizer_tournaments_list_completed', { ...requestContext(req), resultCount: withPortalLinks.length })
    res.json(withPortalLinks)
  } catch (error) {
    logRouteError('Organizer tournaments list error', req, error)
    res.status(500).json({ message: 'Could not load tournaments' })
  }
})

app.post('/api/tournaments', requireStorage, organizerAuthMiddleware, async (req, res) => {
  logApi('organizer_tournament_create_blocked', { ...requestContext(req), organizerUserId: req.organizerUser?.id || null, email: normalizeEmail(req.organizerUser?.email) })
  res.status(403).json({ message: 'Organizers can only modify tournaments they have been invited to by a host.' })
})

app.put('/api/organizer/tournaments/:id', requireStorage, organizerAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const input = sanitizeOrganizerTournamentUpdatePayload(req.body || {})
    const tournament = await updateOrganizerInvitedTournament(getPool(), req.organizerUser, tournamentId, input, req)
    if (!tournament) {
      logApi('organizer_tournament_update_not_found', { ...requestContext(req), tournamentId, email: normalizeEmail(req.organizerUser?.email) })
      return res.status(404).json({ message: 'Tournament not found for this organizer invitation.' })
    }
    logApi('organizer_tournament_updated', { ...requestContext(req), tournamentId: tournament.id, status: tournament.status, email: normalizeEmail(req.organizerUser?.email) })
    res.json(tournament)
  } catch (error) {
    if (error instanceof Error && /required|invalid/i.test(error.message)) {
      logApi('organizer_tournament_update_validation_failed', { ...requestContext(req), validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Organizer tournament update error', req, error)
    res.status(500).json({ message: 'Could not update tournament' })
  }
})


app.get('/api/organizer/session', requireStorage, async (req, res) => {
  try {
    const db = getPool()
    await ensureOrganizerAuthSchema(db)
    const cookies = Object.fromEntries(
      String(req.headers.cookie || '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const idx = part.indexOf('=')
          return idx >= 0 ? [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))] : [part, '']
        }),
    )
    const organizerAccount = await getOrganizerAccountBySession(req, cookies.golfhomiez_organizer_session || '')
    res.json({ organizerAccount })
  } catch (error) {
    logRouteError('Organizer session fetch error', req, error)
    res.status(500).json({ message: 'Could not load organizer session' })
  }
})

app.post('/api/organizer/register', requireStorage, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)
    const firstName = String(req.body?.firstName || '').trim()
    const lastName = String(req.body?.lastName || '').trim()
    const password = String(req.body?.password || '')
    if (!firstName) return res.status(400).json({ message: 'First name is required' })
    if (!lastName) return res.status(400).json({ message: 'Last name is required' })
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid email is required' })
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' })
    const db = getPool()
    const organizerAccount = await registerOrganizerAccount(db, { firstName, lastName, email, password })
    const session = await createOrganizerSession(db, organizerAccount.id)
    res.setHeader('Set-Cookie', serializeOrganizerSessionCookie(session.id))
    logApi('organizer_register_completed', { ...requestContext(req), email, organizerAccountId: organizerAccount.id })
    res.status(201).json({ organizerAccount })
  } catch (error) {
    if (error instanceof Error && /invite|required|already exists/i.test(error.message)) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Organizer register error', req, error)
    res.status(500).json({ message: 'Could not create organizer account' })
  }
})

app.post('/api/organizer/login', requireStorage, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)
    const password = String(req.body?.password || '')
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid email is required' })
    if (!password) return res.status(400).json({ message: 'Password is required' })
    const db = getPool()
    const organizerAccount = await authenticateOrganizerLogin(db, { email, password })
    if (!organizerAccount) return res.status(401).json({ message: 'Invalid organizer email or password' })
    const session = await createOrganizerSession(db, organizerAccount.id)
    res.setHeader('Set-Cookie', serializeOrganizerSessionCookie(session.id))
    logApi('organizer_login_completed', { ...requestContext(req), email, organizerAccountId: organizerAccount.id })
    res.json({ organizerAccount })
  } catch (error) {
    logRouteError('Organizer login error', req, error)
    res.status(500).json({ message: 'Could not sign in to organizer account' })
  }
})

app.post('/api/organizer/logout', requireStorage, async (req, res) => {
  try {
    const cookies = Object.fromEntries(
      String(req.headers.cookie || '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const idx = part.indexOf('=')
          return idx >= 0 ? [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))] : [part, '']
        }),
    )
    await destroyOrganizerSession(getPool(), cookies.golfhomiez_organizer_session || '')
    res.setHeader('Set-Cookie', clearOrganizerSessionCookie())
    res.status(204).end()
  } catch (error) {
    logRouteError('Organizer logout error', req, error)
    res.status(500).json({ message: 'Could not sign out of organizer account' })
  }
})

app.get('/api/organizer/portal', requireStorage, organizerAuthMiddleware, async (req, res) => {
  try {
    const summary = await getOrganizerPortalSummary(getPool(), req.organizerUser, req)
    if (!summary.organizerAccount && summary.tournaments.length === 0) {
      logApi('organizer_portal_forbidden', { ...requestContext(req), email: normalizeEmail(req.organizerUser.email) })
      return res.status(403).json({ message: 'No organizer account or tournament invitations were found for this Golf Homiez user.' })
    }
    logApi('organizer_portal_loaded', { ...requestContext(req), organizerAccountId: summary.organizerAccount?.id || null, tournamentCount: summary.tournaments.length })
    res.json(summary)
  } catch (error) {
    logRouteError('Organizer portal load error', req, error)
    res.status(500).json({ message: 'Could not load organizer portal' })
  }
})

app.get('/api/organizer/invite-eligibility', requireStorage, async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email || '')
    if (!email) return res.status(400).json({ message: 'email query parameter required' })
    const pool = getPool()
    const [accountRows] = await pool.execute(
      `SELECT id FROM organizer_role_accounts WHERE LOWER(email) = LOWER(?) LIMIT 1`,
      [email],
    )
    let inviteCount = 0
    try {
      const [inviteRows] = await pool.execute(
        `SELECT COUNT(*) AS invite_count
           FROM organizer_tournament_invites
          WHERE LOWER(organizer_email) = LOWER(?)
            AND status IN ('issued', 'sent', 'pending')`,
        [email],
      )
      inviteCount = Number(inviteRows[0]?.invite_count || 0)
    } catch (_) {
      inviteCount = 0
    }
    logApi('organizer_invite_eligibility_checked', { ...requestContext(req), email, inviteCount, hasOrganizerAccount: accountRows.length > 0 })
    res.json({ email, eligible: accountRows.length > 0 || inviteCount > 0, inviteCount, hasOrganizerAccount: accountRows.length > 0 })
  } catch (error) {
    logRouteError('Organizer invite eligibility error', req, error)
    res.status(500).json({ message: 'Could not check organizer invite eligibility' })
  }
})

app.get('/api/tournament-portals/:id', requireStorage, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    const pool = getPool()
    const portal = await getTournamentPortalById(pool, id, req)
    if (!portal) return res.status(404).json({ message: 'Tournament not found' })
    if (!portal.tournament.isPublic && portal.tournament.status === 'draft') return res.status(404).json({ message: 'Tournament not found' })

    let viewer = null
    try {
      viewer = await getAuthenticatedUserFromRequest(req)
    } catch (authError) {
      logRouteError('Tournament portal viewer auth check error', req, authError, { tournamentId: portal.tournament.id })
    }

    let viewerRegistration = null
    if (viewer?.id) {
      const [registrationRows] = await pool.execute(
        `SELECT id, tournament_id, auth_user_id, email, name, status, created_at, updated_at
           FROM tournament_registrations
          WHERE tournament_id = ?
            AND auth_user_id = ?
            AND status = 'registered'
          LIMIT 1`,
        [portal.tournament.id, viewer.id],
      )
      viewerRegistration = registrationRows[0] ? mapTournamentRegistrationRow(registrationRows[0]) : null
    }

    logApi('tournament_portal_loaded', { ...requestContext(req), tournamentId: id, registrationCount: portal.registrationCount, viewerRegistered: Boolean(viewerRegistration) })
    res.json({ ...portal, viewerRegistration, isViewerRegistered: Boolean(viewerRegistration) })
  } catch (error) {
    logRouteError('Tournament portal load error', req, error)
    res.status(500).json({ message: 'Could not load tournament portal' })
  }
})

app.post('/api/tournament-portals/:id/register', requireStorage, authMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const pool = getPool()
    const portal = await getTournamentPortalById(pool, tournamentId, req)
    if (!portal) return res.status(404).json({ message: 'Tournament not found' })
    if (portal.tournament.status === 'cancelled' || portal.tournament.status === 'completed') return res.status(400).json({ message: 'Tournament registration is closed.' })
    const resolvedTournamentId = portal.tournament.id
    const [existingRows] = await pool.execute(
      `SELECT id, tournament_id, auth_user_id, email, name, status, created_at, updated_at
         FROM tournament_registrations
        WHERE tournament_id = ?
          AND auth_user_id = ?
          AND status = 'registered'
        LIMIT 1`,
      [resolvedTournamentId, req.user.id],
    )
    if (existingRows[0]) {
      const existingRegistration = mapTournamentRegistrationRow(existingRows[0])
      logApi('tournament_registration_duplicate_blocked', { ...requestContext(req), tournamentId: resolvedTournamentId, requestedTournamentId: tournamentId, authUserId: req.user.id, email: normalizeEmail(req.user.email), registrationId: existingRegistration.id })
      return res.status(409).json({ ok: false, alreadyRegistered: true, tournamentId: resolvedTournamentId, requestedTournamentId: tournamentId, status: 'registered', registration: existingRegistration, message: 'You are already registered for this tournament.' })
    }

    const registrationId = uuidv4()
    await pool.execute(
      `INSERT INTO tournament_registrations (id, tournament_id, auth_user_id, email, name, status, correlation_id)
       VALUES (?, ?, ?, ?, ?, 'registered', ?)`,
      [registrationId, resolvedTournamentId, req.user.id, normalizeEmail(req.user.email), req.user.name || null, req.correlationId || null],
    )
    const registrationUrl = portal.tournament.portalUrl || tournamentPortalUrl(req, portal.tournament.tournamentIdentifier || resolvedTournamentId)
    try {
      await sendMail({
        to: normalizeEmail(req.user.email),
        subject: `Registration confirmed: ${portal.tournament.name}`,
        text: [
          `You are registered for ${portal.tournament.name}.`,
          portal.tournament.startDate ? `Start date: ${portal.tournament.startDate}` : '',
          portal.tournament.endDate ? `End date: ${portal.tournament.endDate}` : '',
          portal.tournament.hostGolfCourseName ? `Host: ${portal.tournament.hostGolfCourseName}` : '',
          portal.tournament.organizerName ? `Organizer: ${portal.tournament.organizerName}` : '',
          `Tournament link: ${registrationUrl}`,
        ].filter(Boolean).join('\n'),
        html: `
          <p>You are registered for <strong>${portal.tournament.name}</strong>.</p>
          ${portal.tournament.startDate ? `<p><strong>Start date:</strong> ${portal.tournament.startDate}</p>` : ''}
          ${portal.tournament.endDate ? `<p><strong>End date:</strong> ${portal.tournament.endDate}</p>` : ''}
          ${portal.tournament.hostGolfCourseName ? `<p><strong>Host:</strong> ${portal.tournament.hostGolfCourseName}</p>` : ''}
          ${portal.tournament.organizerName ? `<p><strong>Organizer:</strong> ${portal.tournament.organizerName}</p>` : ''}
          <p><a href="${registrationUrl}">View tournament details</a></p>
        `,
      })
      logApi('tournament_registration_confirmation_email_sent', { ...requestContext(req), tournamentId: resolvedTournamentId, authUserId: req.user.id, email: normalizeEmail(req.user.email) })
    } catch (mailError) {
      logRouteError('Tournament registration confirmation email error', req, mailError)
    }
    logApi('tournament_registration_completed', { ...requestContext(req), tournamentId: resolvedTournamentId, requestedTournamentId: tournamentId, authUserId: req.user.id, email: normalizeEmail(req.user.email) })
    res.status(201).json({ ok: true, tournamentId: resolvedTournamentId, requestedTournamentId: tournamentId, status: 'registered' })
  } catch (error) {
    logRouteError('Tournament registration error', req, error)
    res.status(500).json({ message: 'Could not register for tournament' })
  }
})

app.get('/api/users/tournaments', requireStorage, authMiddleware, async (req, res) => {
  try {
    const pool = getPool()
    const email = normalizeEmail(req.user.email)
    const [rows] = await pool.execute(
      `SELECT t.*, ora.organization_name AS organizer_name, hra.golf_course_name AS host_golf_course_name, ha.golf_course_name AS host_account_name,
              tr.id AS registration_id, tr.auth_user_id AS registration_auth_user_id, tr.email AS registration_email,
              tr.name AS registration_name, tr.status AS registration_status, tr.created_at AS registered_at,
              tr.updated_at AS registration_updated_at,
              COUNT(all_tr.id) AS registration_count
         FROM tournament_registrations tr
         JOIN tournaments t ON t.id = tr.tournament_id
         LEFT JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
         LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
         LEFT JOIN host_accounts ha ON ha.id = t.host_account_id
         LEFT JOIN tournament_registrations all_tr ON all_tr.tournament_id = t.id AND all_tr.status = 'registered'
        WHERE tr.status = 'registered'
          AND (tr.auth_user_id = ? OR LOWER(tr.email) = LOWER(?))
        GROUP BY t.id, tr.id
        ORDER BY COALESCE(t.start_date, t.created_at) DESC, tr.created_at DESC`,
      [req.user.id, email],
    )
    const tournaments = rows.map((row) => ({
      ...mapTournamentPortalRow(row, req),
      tournamentIdentifier: row.tournament_identifier || null,
      registration: mapTournamentRegistrationRow({
        id: row.registration_id,
        tournament_id: row.id,
        auth_user_id: row.registration_auth_user_id,
        email: row.registration_email,
        name: row.registration_name,
        status: row.registration_status,
        created_at: row.registered_at,
        updated_at: row.registration_updated_at,
      }),
    }))
    logApi('user_registered_tournaments_loaded', { ...requestContext(req), authUserId: req.user.id, email, tournamentCount: tournaments.length })
    res.json({ tournaments })
  } catch (error) {
    logRouteError('User registered tournaments load error', req, error)
    res.status(500).json({ message: 'Could not load registered tournaments' })
  }
})

app.get('/api/profile', requireStorage, authMiddleware, async (req, res) => {
  try {
    const row = await ensureAppUserProfileRow(req.user)
    logApi('profile_fetch_completed', { ...requestContext(req), needsEnrichment: !row?.profile_enriched_at })
    res.json(mapProfileRow(row))
  } catch (error) {
    logRouteError('Profile fetch error', req, error)
    res.status(500).json({ message: 'Could not load profile' })
  }
})

app.put('/api/profile', requireStorage, authMiddleware, async (req, res) => {
  try {
    const profile = sanitizeProfilePayload(req.body || {})
    logApi('profile_save_started', { ...requestContext(req), profile })
    await ensureAppUserProfileRow(req.user)
    const pool = getPool()
    await pool.execute(
      `UPDATE app_users
          SET email = ?,
              name = ?,
              primary_city = ?,
              primary_state = ?,
              primary_zip_code = ?,
              alcohol_preference = ?,
              cannabis_preference = ?,
              sobriety_preference = ?,
              profile_enriched_at = COALESCE(profile_enriched_at, NOW())
        WHERE auth_user_id = ?`,
      [
        normalizeEmail(req.user.email),
        req.user.name || null,
        profile.primaryCity,
        profile.primaryState,
        profile.primaryZipCode,
        profile.alcoholPreference,
        profile.cannabisPreference,
        profile.sobrietyPreference,
        req.user.id,
      ],
    )
    const row = await ensureAppUserProfileRow(req.user)
    logApi('profile_save_completed', { ...requestContext(req), needsEnrichment: !row?.profile_enriched_at, profile: mapProfileRow(row) })
    res.json(mapProfileRow(row))
  } catch (error) {
    if (error instanceof Error && /required|Select|Sober golf/.test(error.message)) {
      logApi('profile_save_validation_failed', { ...requestContext(req), validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Profile save error', req, error)
    res.status(500).json({ message: 'Could not save profile' })
  }
})

app.get('/api/users/lookup', requireStorage, authMiddleware, async (req, res) => {
  try {
    const email = String(req.query.email || '').trim()
    if (!email) return res.status(400).json({ message: 'email query parameter required' })
    const found = await storage.findUserByEmail(email)
    if (!found) return res.json({ found: false, email: normalizeEmail(email) })
    const parts = splitName(found.name, found.email)
    res.json({ found: true, email: found.email, firstName: parts.firstName, name: found.name, verified: Boolean(found.emailVerified) })
  } catch (error) {
    logRouteError('User lookup error', req, error)
    res.status(500).json({ message: 'Could not look up user' })
  }
})

app.post('/api/invitations', requireStorage, authMiddleware, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim()
    const message = String(req.body?.message || '').trim()
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid email is required' })
    const result = await sendRegistrationInviteEmail(req, { toEmail: email, customMessage: message, invitedBy: req.user })
    res.status(201).json(result)
  } catch (error) {
    logRouteError('Invitation send error', req, error)
    res.status(500).json({ message: 'Could not send invitation' })
  }
})

app.post('/api/invitations/resend-registration', requireStorage, authMiddleware, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim()
    const message = String(req.body?.message || '').trim()
    const teamId = req.body?.teamId ? String(req.body.teamId) : null
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid email is required' })
    const result = await sendRegistrationInviteEmail(req, { toEmail: email, customMessage: message, invitedBy: req.user, teamId, purpose: 'team_registration_invite' })
    res.status(201).json(result)
  } catch (error) {
    logRouteError('Resend registration invite error', req, error)
    res.status(500).json({ message: 'Could not send registration invite' })
  }
})

app.get('/api/teams', requireStorage, authMiddleware, async (req, res) => {
  try {
    const teams = await storage.listTeams()
    res.json(teams)
  } catch (error) {
    logRouteError('List teams error', req, error)
    res.status(500).json({ message: 'Could not load teams' })
  }
})

app.post('/api/teams', requireStorage, authMiddleware, async (req, res) => {
  try {
    const { name, members } = req.body || {}
    const trimmed = String(name || '').trim()
    if (!trimmed) return res.status(400).json({ message: 'Team name required' })

    const normalizedMembers = normalizeCreateTeamMembers(members, req.user)

    if (!normalizedMembers[0]?.email) return res.status(400).json({ message: 'The signed-in user must have an email to create a team' })
    if (normalizedMembers.length < 2) return res.status(400).json({ message: 'A team must have at least 2 members' })
    if (normalizedMembers.length > 4) return res.status(400).json({ message: 'A team can have at most 4 members' })

    for (const m of normalizedMembers) {
      if (!m.name) return res.status(400).json({ message: 'Each team member must have a name' })
      if (!m.email) return res.status(400).json({ message: 'Each team member must have an email' })
      if (!isEmail(m.email)) return res.status(400).json({ message: `Invalid team member email: ${m.email}` })
    }

    const seen = new Set()
    for (const m of normalizedMembers) {
      if (seen.has(m.email)) return res.status(400).json({ message: 'Duplicate team member email in the same team' })
      seen.add(m.email)
    }

    const exists = await storage.getTeamByName(trimmed)
    if (exists) return res.status(409).json({ message: 'Team already exists' })

    const team = await storage.createTeam({ name: trimmed, members: normalizedMembers })
    res.status(201).json(team)
  } catch (error) {
    logRouteError('Create team error', req, error)
    res.status(500).json({ message: 'Could not create team' })
  }
})

app.put('/api/teams/:id', requireStorage, authMiddleware, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ message: 'Team id required' })

    const { name, members } = req.body || {}
    const trimmed = String(name || '').trim()
    if (!trimmed) return res.status(400).json({ message: 'Team name required' })

    const normalizedMembers = normalizeCreateTeamMembers(members, req.user)

    if (!normalizedMembers[0]?.email) return res.status(400).json({ message: 'The signed-in user must have an email to create a team' })
    if (normalizedMembers.length < 2) return res.status(400).json({ message: 'A team must have at least 2 members' })
    if (normalizedMembers.length > 4) return res.status(400).json({ message: 'A team can have at most 4 members' })

    for (const m of normalizedMembers) {
      if (!m.name) return res.status(400).json({ message: 'Each team member must have a name' })
      if (!m.email) return res.status(400).json({ message: 'Each team member must have an email' })
      if (!isEmail(m.email)) return res.status(400).json({ message: `Invalid team member email: ${m.email}` })
    }

    const seen = new Set()
    for (const m of normalizedMembers) {
      if (seen.has(m.email)) return res.status(400).json({ message: 'Duplicate team member email in the same team' })
      seen.add(m.email)
    }

    const existing = await storage.getTeamById(id)
    if (!existing) return res.status(404).json({ message: 'Team not found' })

    const nameTaken = await storage.getTeamByName(trimmed)
    if (nameTaken && String(nameTaken.id) !== id) return res.status(409).json({ message: 'Team name already exists' })

    const requesterEmail = normalizeEmail(req.user.email)
    const canEdit = (existing.members || []).some((m) => normalizeEmail(m.email) === requesterEmail)
    if (!canEdit) return res.status(403).json({ message: 'Only team members can edit this team' })

    const updated = await storage.updateTeam(id, { name: trimmed, members: normalizedMembers })
    res.json(updated)
  } catch (error) {
    logRouteError('Update team error', req, error)
    res.status(500).json({ message: 'Could not update team' })
  }
})

app.get('/api/scores', requireStorage, authMiddleware, async (req, res) => {
  try {
    const scores = await storage.listScores()
    res.json(scores)
  } catch (error) {
    logRouteError('List scores error', req, error)
    res.status(500).json({ message: 'Could not load scores' })
  }
})

app.post('/api/scores', requireStorage, authMiddleware, async (req, res) => {
  try {
    const body = req.body || {}
    const mode = body.mode === 'solo' ? 'solo' : 'team'

    if (mode === 'solo') {
      const { date, state, course, roundScore, holes } = body
      if (!date || !course) return res.status(400).json({ message: 'date and course required' })
      if (!isValidPastOrTodayDate(date, req.headers['x-user-timezone'])) return res.status(400).json({ message: 'Date must be today or earlier in your local time zone' })
      if (!state || typeof state !== 'string' || !String(state).trim()) return res.status(400).json({ message: 'state required' })
      if (typeof roundScore !== 'number' || Number.isNaN(roundScore)) return res.status(400).json({ message: 'roundScore must be a number' })
      if (roundScore < 0) return res.status(400).json({ message: 'roundScore must be zero or greater' })

      const matchedCourse = await findGolfCourseForState(state, course)
      if (!matchedCourse) return res.status(400).json({ message: 'Select a golf course from the catalog for the selected state' })

      const entry = await storage.createScore({
        mode: 'solo',
        date,
        state: String(state).toUpperCase(),
        course: matchedCourse.name,
        roundScore,
        holes: Array.isArray(holes) ? holes : null,
        createdByUserId: req.user.id,
        createdByEmail: req.user.email,
      })
      return res.status(201).json(entry)
    }

    const { date, state, course, team, opponentTeam, teamTotal, opponentTotal, holes } = body
    if (!date || !course || !team) return res.status(400).json({ message: 'date, course, team required' })
    if (!isValidPastOrTodayDate(date, req.headers['x-user-timezone'])) return res.status(400).json({ message: 'Date must be today or earlier in your local time zone' })
    if (!state || typeof state !== 'string' || !String(state).trim()) return res.status(400).json({ message: 'state required' })
    if (!opponentTeam || !String(opponentTeam).trim()) return res.status(400).json({ message: 'opponentTeam required' })
    if (String(opponentTeam).trim().toLowerCase() === String(team).trim().toLowerCase()) {
      return res.status(400).json({ message: 'Opponent team must be different from your team' })
    }
    if (typeof teamTotal !== 'number' || Number.isNaN(teamTotal)) return res.status(400).json({ message: 'teamTotal must be a number' })
    if (typeof opponentTotal !== 'number' || Number.isNaN(opponentTotal)) return res.status(400).json({ message: 'opponentTotal must be a number' })
    if (teamTotal < 0 || opponentTotal < 0) return res.status(400).json({ message: 'Scores must be zero or greater' })

    const matchedCourse = await findGolfCourseForState(state, course)
    if (!matchedCourse) return res.status(400).json({ message: 'Select a golf course from the catalog for the selected state' })

    const myTeam = await findTeamByName(team)
    if (!myTeam) return res.status(400).json({ message: 'Your team must be a known team (create it first)' })
    if (!(await isUserOnTeam(team, req.user.email))) return res.status(403).json({ message: 'You are not a member of the selected team' })

    const oppTeamObj = await findTeamByName(opponentTeam)
    if (!oppTeamObj) return res.status(400).json({ message: 'Opponent team must be a known team (create it first)' })

    const won = teamTotal < opponentTotal ? true : (teamTotal > opponentTotal ? false : null)
    const diff = Math.abs(opponentTotal - teamTotal)
    const money = won === true ? diff : won === false ? -diff : 0

    const entry = await storage.createScore({
      mode: 'team',
      date,
      state: String(state).toUpperCase(),
      course: matchedCourse.name,
      team,
      opponentTeam: String(opponentTeam).trim(),
      teamTotal,
      opponentTotal,
      money,
      won,
      holes: Array.isArray(holes) ? holes : null,
      createdByUserId: req.user.id,
      createdByEmail: req.user.email,
    })
    res.status(201).json(entry)
  } catch (error) {
    logRouteError('Create score error', req, error)
    res.status(500).json({ message: 'Could not create score' })
  }
})

app.delete('/api/scores/:id', requireStorage, authMiddleware, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    const entry = await storage.getScoreById(id)
    if (!entry) return res.status(404).json({ message: 'Score not found' })

    const can = await isUserOnTeam(entry.team, req.user.email) || await isUserOnTeam(entry.opponentTeam, req.user.email)
    if (!can) return res.status(403).json({ message: 'Only members of the teams involved can delete this round' })

    await storage.deleteScoreById(id)
    res.json({ ok: true })
  } catch (error) {
    logRouteError('Delete score error', req, error)
    res.status(500).json({ message: 'Could not delete score' })
  }
})



app.post('/api/admin/auth/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    if (!username) return res.status(400).json({ message: 'Username is required' })
    if (!password) return res.status(400).json({ message: 'Password is required' })

    const adminUser = await getAdminUserByUsername(username)
    if (!adminUser || !adminUser.is_active) {
      return res.status(401).json({ message: 'Invalid username or password' })
    }

    const verified = verifyPassword(password, adminUser.password_salt, adminUser.password_hash)
    if (!verified) return res.status(401).json({ message: 'Invalid username or password' })

    res.setHeader('Set-Cookie', createAdminSessionCookie(adminUser))
    logApi('admin_login_completed', { ...requestContext(req), adminUserId: adminUser.id, username: adminUser.username })
    res.json({ adminUser: { id: adminUser.id, username: adminUser.username, email: adminUser.email, isActive: !!adminUser.is_active } })
  } catch (error) {
    logRouteError('Admin login error', req, error)
    res.status(500).json({ message: 'Could not sign in to admin portal' })
  }
})

app.post('/api/admin/auth/logout', async (req, res) => {
  try {
    res.setHeader('Set-Cookie', clearAdminSessionCookie())
    res.status(204).end()
  } catch (error) {
    logRouteError('Admin logout error', req, error)
    res.status(500).json({ message: 'Could not sign out of admin portal' })
  }
})

app.get('/api/admin/session', async (req, res) => {
  try {
    const adminUser = await authenticateAdminRequest(req)
    if (adminUser) {
      res.setHeader('Set-Cookie', refreshAdminSessionCookie(adminUser))
      logApi('admin_session_ttl_refreshed', { ...requestContext(req), adminUserId: adminUser.id })
    }
    res.json({ adminUser: adminUser ? { id: adminUser.id, username: adminUser.username, email: adminUser.email, isActive: !!adminUser.is_active } : null })
  } catch (error) {
    logRouteError('Admin session fetch error', req, error)
    res.status(500).json({ message: 'Could not load admin session' })
  }
})

app.post('/api/admin/request-password-reset', async (req, res) => {
  try {
    const identifier = String(req.body?.identifier || req.body?.username || '').trim()
    if (!identifier) return res.status(400).json({ message: 'Username is required' })

    const adminUser = await getAdminUserByUsername(identifier)
    if (!adminUser) return res.json({ ok: true })

    await createAdminResetToken(adminUser.id)
    logApi('admin_password_reset_requested', { ...requestContext(req), adminUserId: adminUser.id, username: adminUser.username })
    res.json({ ok: true })
  } catch (error) {
    logRouteError('Admin password reset request error', req, error)
    res.status(500).json({ message: 'Could not start admin password reset' })
  }
})

app.post('/api/admin/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim()
    const password = String(req.body?.password || '')
    if (!token) return res.status(400).json({ message: 'Reset token required' })
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' })

    await consumeAdminResetToken(token, password)
    logApi('admin_password_reset_completed', { ...requestContext(req) })
    res.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && /invalid or expired/i.test(error.message)) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Admin password reset error', req, error)
    res.status(500).json({ message: 'Could not reset admin password' })
  }
})

app.get('/api/admin/portal', adminMiddleware, async (req, res) => {
  try {
    const data = await listPortalData()
    res.json({ ...data, adminUser: { id: req.adminUser.id, username: req.adminUser.username, email: req.adminUser.email, isActive: !!req.adminUser.is_active } })
  } catch (error) {
    logRouteError('Admin portal load error', req, error)
    res.status(500).json({ message: 'Could not load admin portal' })
  }
})

app.post('/api/admin/admin-users', adminMiddleware, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim()
    const email = normalizeEmail(req.body?.email)
    const password = String(req.body?.password || '')
    if (!username) return res.status(400).json({ message: 'Username is required' })
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid email is required' })
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' })

    const adminUser = await createAdminUser({ username, email, password })
    const adminUsers = await listAdminUsers()
    logApi('admin_user_created', { ...requestContext(req), createdAdminUserId: adminUser.id, adminUserId: req.adminUser.id })
    res.status(201).json({ adminUser, adminUsers })
  } catch (error) {
    logRouteError('Create admin user error', req, error)
    res.status(500).json({ message: 'Could not create admin user' })
  }
})

app.post('/api/admin/host-invites', adminMiddleware, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)
    const inviteeName = String(req.body?.inviteeName || '').trim()
    const golfCourseName = String(req.body?.golfCourseName || '').trim()
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid email is required' })
    if (!inviteeName) return res.status(400).json({ message: 'Invitee name is required' })
    if (!golfCourseName) return res.status(400).json({ message: 'Golf-course name is required' })

    const invite = await createHostInvite({ email, inviteeName, golfCourseName, adminUserId: req.adminUser.id })
    logApi('host_invite_created', { ...requestContext(req), adminUserId: req.adminUser.id, email, golfCourseName, inviteId: invite.id })
    res.status(201).json({ invite })
  } catch (error) {
    logRouteError('Create host invite error', req, error)
    res.status(500).json({ message: 'Could not create host invite' })
  }
})


app.delete('/api/admin/host-account-requests/:id', adminMiddleware, async (req, res) => {
  try {
    const requestId = String(req.params.id || '').trim()
    if (!requestId) return res.status(400).json({ message: 'Request id is required' })

    const result = await deleteHostAccountRequest({
      requestId,
      adminUserId: req.adminUser.id,
      adminEmail: req.adminUser.email,
    })
    logApi('host_account_request_deleted', { ...requestContext(req), requestId, adminUserId: req.adminUser.id })
    res.json(result)
  } catch (error) {
    if (error instanceof Error && /not found|only pending/i.test(error.message)) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Delete host account request error', req, error)
    res.status(500).json({ message: 'Could not delete golf-course account request' })
  }
})

app.get('/api/host/session', async (req, res) => {
  try {
    const db = getPool()
    await ensureHostAuthSchema(db)
    const cookies = Object.fromEntries(
      String(req.headers.cookie || '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const idx = part.indexOf('=')
          return idx >= 0 ? [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))] : [part, '']
        }),
    )
    const hostSessionId = cookies.golfhomiez_host_session || ''
    const hostAccount = await getHostAccountBySession(req, hostSessionId)
    if (hostAccount) {
      res.setHeader('Set-Cookie', serializeHostSessionCookie(hostSessionId))
      logApi('host_session_ttl_refreshed', { ...requestContext(req), hostAccountId: hostAccount.id })
    }
    res.json({ hostAccount })
  } catch (error) {
    logRouteError('Host session fetch error', req, error)
    res.status(500).json({ message: 'Could not load host session' })
  }
})

app.post('/api/host/register', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)
    const golfCourseName = String(req.body?.golfCourseName || '').trim()
    const securityKey = String(req.body?.securityKey || '').trim()
    const password = String(req.body?.password || '')
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid invite email is required' })
    if (!golfCourseName) return res.status(400).json({ message: 'Golf-course name is required' })
    if (!securityKey) return res.status(400).json({ message: 'Security key is required' })
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' })

    const db = getPool()
    const hostAccount = await redeemHostInvite(db, { email, golfCourseName, securityKey, password })
    const session = await createHostSession(db, hostAccount.id)
    res.setHeader('Set-Cookie', serializeHostSessionCookie(session.id, session.expiresAt))
    logApi('host_register_completed', { ...requestContext(req), email, golfCourseName, hostAccountId: hostAccount.id })
    res.status(201).json({ hostAccount })
  } catch (error) {
    if (error instanceof Error && /invite email and security key/i.test(error.message)) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host register error', req, error)
    res.status(500).json({ message: 'Could not create golf-course account' })
  }
})

app.post('/api/host/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)
    const password = String(req.body?.password || '')
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid email is required' })
    if (!password) return res.status(400).json({ message: 'Password is required' })
    const db = getPool()
    const hostAccount = await authenticateHostLogin(db, { email, password })
    if (!hostAccount) return res.status(401).json({ message: 'Invalid email or password' })
    const session = await createHostSession(db, hostAccount.id)
    res.setHeader('Set-Cookie', serializeHostSessionCookie(session.id, session.expiresAt))
    logApi('host_login_completed', { ...requestContext(req), email, hostAccountId: hostAccount.id })
    res.json({ hostAccount })
  } catch (error) {
    if (error instanceof Error && /Invalid email or password/i.test(error.message)) {
      return res.status(401).json({ message: error.message })
    }
    logRouteError('Host login error', req, error)
    res.status(500).json({ message: 'Could not sign in to golf-course account' })
  }
})

app.post('/api/host/logout', async (req, res) => {
  try {
    const db = getPool()
    await destroyHostSession(db, req)
    res.setHeader('Set-Cookie', clearHostSessionCookie())
    res.status(204).end()
  } catch (error) {
    logRouteError('Host logout error', req, error)
    res.status(500).json({ message: 'Could not sign out of golf-course account' })
  }
})

app.post('/api/host/request-password-reset', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid email is required' })
    const db = getPool()
    await createHostPasswordReset(db, { email, resetUrlBase: getHostAppBaseUrl(req) })
    logApi('host_password_reset_requested', { ...requestContext(req), email })
    res.json({ ok: true })
  } catch (error) {
    logRouteError('Host password reset request error', req, error)
    res.status(500).json({ message: 'Could not start golf-course password reset' })
  }
})

app.post('/api/host/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim()
    const password = String(req.body?.password || '')
    if (!token) return res.status(400).json({ message: 'Reset token required' })
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' })
    const db = getPool()
    await resetHostPassword(db, { token, password })
    logApi('host_password_reset_completed', { ...requestContext(req) })
    res.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && /invalid or expired/i.test(error.message)) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host password reset error', req, error)
    res.status(500).json({ message: 'Could not reset golf-course password' })
  }
})

app.get('/api/host/portal', hostAuthMiddleware, async (req, res) => {
  try {
    const db = getPool()
    const data = await getHostPortalData(db, req.hostAccount.id)
    if (!data) return res.status(404).json({ message: 'Golf-course account not found' })
    res.json(data)
  } catch (error) {
    logRouteError('Host portal load error', req, error)
    res.status(500).json({ message: 'Could not load golf-course portal' })
  }
})

const distDir = path.join(__dirname, '..', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

async function bootstrap() {
  const logPaths = getLogPaths()

  try {
    await storage.initStorage()
    storageReady = true
    const backend = await storage.getBackendName()
    logInfo('Storage backend initialized', { backend, storageReady, ...logPaths })
  } catch (error) {
    storageReady = false
    logError('Storage initialization failed; starting in degraded mode', { error, storageReady, ...logPaths })
  }

  app.listen(PORT, '0.0.0.0', () => {
    logInfo('Server listening', { port: PORT, storageReady, ...logPaths })
  })
}

bootstrap().catch((error) => {
  logError('Startup failed', { error })
  process.exit(1)
})
