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
import { approveHostAccountRequest, authenticateAdminRequest, clearAdminSessionCookie, createAdminResetToken, createAdminSessionCookie, createAdminUser, createHostAccountRequest, createHostInvite, consumeAdminResetToken, deleteHostAccountRequest, getAdminUserByUsername, listAdminUsers, listPortalData, verifyPassword } from './lib/admin-portal.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.set('trust proxy', 1)
const PORT = Number(process.env.PORT || 5001)
let storageReady = false
const clientOrigin = String(process.env.CLIENT_ORIGIN || '').trim()
const publicServerOrigin = String(process.env.BETTER_AUTH_URL || '').trim()
const allowedOrigins = new Set([
  clientOrigin,
  publicServerOrigin,
  'http://127.0.0.1:5174',
  'http://localhost:5174',
  'http://127.0.0.1:5001',
  'http://localhost:5001',
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

  return 'http://127.0.0.1:5174'
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

async function authMiddleware(req, res, next) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    if (!session?.user) return res.status(401).json({ message: 'Unauthorized' })
    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    }
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
    const hostAccount = await getHostAccountBySession(req, cookies.golfhomiez_host_session || '')
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
    res.json(data)
  } catch (error) {
    logRouteError('Host portal load error', req, error)
    res.status(500).json({ message: 'Could not load golf-course portal' })
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
    const hostAccount = await getHostAccountBySession(req, cookies.golfhomiez_host_session || '')
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
