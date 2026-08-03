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
import { buildSuggestedTeamName, isValidTeamSize, normalizeCreateTeamMembers, normalizeEmail, isEmail, normalizeTeamMemberStatus } from './lib/team-utils.js'
import { accessLogMiddleware, getLogPaths, logApi, logError, logFrontend, logInfo, logScheduledJob, requestContext, requestCorrelationMiddleware } from './lib/logger.js'
import { getNearestLocation as getNearestServerLocation, searchLocations as searchServerLocations } from './lib/location-service.js'
import { findGolfCourseForState, findNearestGolfCourse, formatGolfCoursePhysicalAddress, getGolfCourseByName, listGolfCourseStates, listGolfCoursesForState } from './lib/golf-course-service.js'
import { calculateHoleScoreTotal, calculateProvidedHoleScoreTotal, getHoleScorecardForCourse, normalizeHoleScorePayload } from './lib/hole-scorecard.js'
import { clearScorecardDraftHoles, deleteScorecardDraftHole, listScorecardDraftHoles, normalizeDraftContext, normalizeDraftHole, upsertScorecardDraftHole } from './lib/scorecard-drafts.js'
import { sendMail } from './mailer.js'
import { generateQrSvg } from './lib/qr-code.js'
import { cancelScheduledJob, configureScheduledJob, listScheduledJobs, runScheduledJob, startScheduledJobRunner } from './lib/scheduled-jobs.js'
import { searchGolfCourseTournaments } from './lib/tournament-discovery.js'
import { v4 as uuidv4 } from 'uuid'
import { authenticateHostLogin, clearHostSessionCookie, createHostPasswordReset, createHostSession, destroyHostSession, ensureHostAuthSchema, getHostAccountBySession, getHostPortalData, hostAuthMiddleware, resetHostPassword, serializeHostSessionCookie } from './lib/host-auth.js'
import { authenticateOrganizerLogin, clearOrganizerSessionCookie, createOrganizerPasswordReset, createOrganizerSession, destroyOrganizerSession, ensureOrganizerAuthSchema, getOrganizerAccountBySession, organizerAuthMiddleware, registerOrganizerAccount, resetOrganizerPassword, serializeOrganizerSessionCookie } from './lib/organizer-auth.js'
import { approveHostAccountRequest, authenticateAdminRequest, clearAdminSessionCookie, createAdminResetToken, createAdminSessionCookie, refreshAdminSessionCookie, createAdminUser, createHostAccountRequest, consumeAdminResetToken, deleteAdminUser, deleteHostAccountRequest, getAdminUserByUsername, listAdminUsers, listPortalData, verifyPassword } from './lib/admin-portal.js'
import { buildOrganizerInviteDetails, createHostManagedTournament, createTournament, createTournamentOrganizerInvite, ensureTournamentInviteSchema, listHostAccounts, listHostManagedTournaments, listOrganizerTournaments, sanitizeOrganizerTournamentInvitePayload } from './lib/rbac.js'
import { normalizeChallengeStatus, normalizeInboxMessagePayload, normalizeTeamChallengeScore, normalizeIndividualChallengeScore, normalizeTeamChallengeHoles } from './lib/inbox-service.js'
import { DEFAULT_TEE_COLOR, normalizeTeeColor } from './lib/tee-colors.js'
import { getExternalApiCallSummary } from './lib/external-api-metrics.js'
import { getFeatureFlags, featureFlagDefinitionsForApi, isFeatureEnabled } from './lib/feature-flags.js'
import { loadProfileSummary } from './lib/profile-summary.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.set('trust proxy', 1)
const PORT = Number(process.env.PORT)
let cancelledTournamentCleanupScheduler = null
if (!Number.isFinite(PORT) || PORT <= 0) throw new Error('PORT must be set to a valid positive number in the environment')
let storageReady = false
const DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT = 24

function resolveScoreCourseMetadata(state, matchedCourse) {
  const courseRating = Number(matchedCourse?.course_rating ?? matchedCourse?.courseRating)
  const slopeRating = Number(matchedCourse?.slope_rating ?? matchedCourse?.slopeRating)
  const coursePar = Number(matchedCourse?.par ?? matchedCourse?.course_par ?? matchedCourse?.coursePar ?? matchedCourse?.parTotal)
  return {
    golfCourseId: matchedCourse?.id || null,
    courseRating: Number.isFinite(courseRating) && courseRating > 0 ? courseRating : null,
    slopeRating: Number.isFinite(slopeRating) && slopeRating > 0 ? slopeRating : null,
    coursePar: Number.isFinite(coursePar) && coursePar > 0 ? coursePar : null,
  }
}
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
      postalCodeResultCount: results.filter((item) => Boolean(item.postalCode)).length,
    })
    res.json(results)
  } catch (error) {
    logRouteError('Location search error', req, error)
    res.status(500).json({ message: 'Location suggestions are temporarily unavailable.' })
  }
})

app.get('/api/golf-course-states', async (req, res) => {
  try {
    const states = await listGolfCourseStates()
    logApi('golf_course_states_completed', {
      ...requestContext(req),
      source: 'database',
      resultCount: states.length,
    })
    return res.json(states)
  } catch (error) {
    logRouteError('Golf course database state list error', req, error)
    const status = /database|ER_|ECONN|ETIMEDOUT/i.test(error?.message || error?.code || '') ? 503 : 500
    return res.status(status).json({ message: 'Golf course states are temporarily unavailable.' })
  }
})

app.get('/api/golf-courses', async (req, res) => {
  try {
    const state = String(req.query.state || '').trim().toUpperCase()
    const query = String(req.query.q || req.query.query || '').trim()
    if (!state && !query) return res.status(400).json({ message: 'state or q query parameter required' })

    const limit = Math.min(Math.max(Number(req.query.limit) || 1000, 1), 1000)
    const courses = await listGolfCoursesForState(state, { query, limit })
    logApi('golf_courses_list_completed', {
      ...requestContext(req),
      state,
      query,
      source: 'database',
      limit,
      resultCount: courses.length,
    })
    return res.json(courses)
  } catch (error) {
    logRouteError('Golf course database list error', req, error)
    const status = /database|ER_|ECONN|ETIMEDOUT/i.test(error?.message || error?.code || '') ? 503 : 500
    return res.status(status).json({ message: 'Golf course catalog is temporarily unavailable.' })
  }
})


app.get('/api/golf-courses/nearest', async (req, res) => {
  try {
    const latitude = Number(req.query.lat ?? req.query.latitude)
    const longitude = Number(req.query.lng ?? req.query.longitude)
    const state = String(req.query.state || '').trim().toUpperCase()
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return res.status(400).json({ message: 'lat and lng query parameters are required' })

    const nearest = await findNearestGolfCourse({ latitude, longitude, state })
    logApi('golf_courses_nearest_completed', {
      ...requestContext(req),
      latitude,
      longitude,
      state: state || null,
      source: 'database',
      found: Boolean(nearest),
      courseId: nearest?.id || null,
      course: nearest?.name || null,
      distanceYards: nearest?.distanceYards ?? null,
    })
    return res.json(nearest || null)
  } catch (error) {
    logRouteError('Golf course nearest lookup error', req, error)
    const status = /database|ER_|ECONN|ETIMEDOUT/i.test(error?.message || error?.code || '') ? 503 : 500
    return res.status(status).json({ message: 'Nearest golf course is temporarily unavailable.' })
  }
})

app.get('/api/golf-courses/scorecard', async (req, res) => {
  try {
    const state = String(req.query.state || '').trim().toUpperCase()
    const course = String(req.query.course || '').trim()
    const courseId = String(req.query.courseId || req.query.course_id || '').trim()
    const golferLatitude = Number(req.query.lat ?? req.query.latitude)
    const golferLongitude = Number(req.query.lng ?? req.query.longitude)
    const teeColor = normalizeTeeColor(req.query.teeColor || req.query.tee_color || DEFAULT_TEE_COLOR)
    if (!state || (!course && !courseId)) return res.status(400).json({ message: 'state and course or courseId query parameters are required' })

    const matchedCourse = await findGolfCourseForState(state, course, courseId)
    if (!matchedCourse && !courseId) return res.status(404).json({ message: 'Select a golf course from the database catalog for the selected state' })

    const scorecard = await getHoleScorecardForCourse({
      state: matchedCourse?.state_code || matchedCourse?.state || state,
      course: matchedCourse?.name || course,
      courseId: matchedCourse?.id || courseId,
      golferLatitude: Number.isFinite(golferLatitude) ? golferLatitude : null,
      golferLongitude: Number.isFinite(golferLongitude) ? golferLongitude : null,
      teeColor,
    })

    logApi('golf_course_scorecard_completed', {
      ...requestContext(req),
      state,
      course: scorecard.course,
      courseId: scorecard.courseId,
      source: scorecard.source,
      teeColor: scorecard.teeColor || teeColor,
      availableTeeColors: scorecard.availableTeeColors || [],
      golferLocationProvided: Number.isFinite(golferLatitude) && Number.isFinite(golferLongitude),
      holeCount: Array.isArray(scorecard.holes) ? scorecard.holes.length : 0,
      distanceToFlagCount: Array.isArray(scorecard.holes) ? scorecard.holes.filter((hole) => Number.isFinite(Number(hole.distanceToFlagYards))).length : 0,
      parTotal: scorecard.parTotal,
      scoreTotal: scorecard.scoreTotal,
    })

    return res.json(scorecard)
  } catch (error) {
    logRouteError('Golf course database scorecard error', req, error)
    const status = /Select a golf course|did not return hole data/.test(error?.message || '') ? 404 : (/database|ER_|ECONN|ETIMEDOUT/i.test(error?.message || error?.code || '') ? 503 : 500)
    return res.status(status).json({ message: 'Golf course scorecard is temporarily unavailable.' })
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
const apiJsonBodyLimit = String(process.env.API_JSON_BODY_LIMIT || '4mb').trim() || '4mb'
app.use(express.json({ limit: apiJsonBodyLimit }))
app.use((error, req, res, next) => {
  if (error?.type === 'entity.too.large') {
    logRouteError('JSON payload too large', req, error, { bodyLimit: apiJsonBodyLimit })
    return res.status(413).json({ message: 'Uploaded image is too large. Please select a smaller image or try again after the image is compressed.' })
  }
  return next(error)
})

app.post(['/api/client-logs', '/api/client-log'], (req, res) => {
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



app.post('/api/support/messages', async (req, res) => {
  try {
    const requester = await getSupportRequester(req)
    if (!requester) {
      logApi('support_message_rejected_unauthenticated', { ...requestContext(req) })
      return res.status(401).json({ message: 'Sign in before sending a support message.' })
    }

    const subject = sanitizeSupportField(req.body?.subject, SUPPORT_SUBJECT_MAX_LENGTH)
    const message = sanitizeSupportField(req.body?.message, SUPPORT_MESSAGE_MAX_LENGTH)
    if (!subject) return res.status(400).json({ message: 'Subject is required.' })
    if (!message) return res.status(400).json({ message: 'Support message is required.' })

    if (requester.sessionCookie) res.setHeader('Set-Cookie', requester.sessionCookie)
    logApi('support_message_submit_started', {
      ...requestContext(req),
      supportDestination: SUPPORT_DESTINATION_EMAIL,
      accountType: requester.accountType,
      accountId: requester.accountId,
      accountEmail: requester.email,
      subjectLength: subject.length,
      messageLength: message.length,
    })

    const supportEmail = buildSupportEmail(req, requester, subject, message)
    await sendMail({
      to: SUPPORT_DESTINATION_EMAIL,
      subject: supportEmail.subject,
      text: supportEmail.text,
      html: supportEmail.html,
    })

    logApi('support_message_email_sent', {
      ...requestContext(req),
      supportDestination: SUPPORT_DESTINATION_EMAIL,
      accountType: requester.accountType,
      accountId: requester.accountId,
      accountEmail: requester.email,
      emailSubject: supportEmail.subject,
    })
    return res.json({ ok: true })
  } catch (error) {
    logRouteError('Support message send error', req, error)
    return res.status(500).json({ message: 'Could not send support message.' })
  }
})


function logRouteError(message, req, error, extra = {}) {
  logError(message, {
    ...requestContext(req),
    ...extra,
    error,
  })
}

function summarizeProvidedHoleScores(holes) {
  const providedHoles = Array.isArray(holes) ? holes.filter((hole) => hole?.scoreProvided) : []
  return {
    providedHoleCount: providedHoles.length,
    enteredStrokeTotal: calculateHoleScoreTotal(providedHoles),
  }
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

function buildAdminPasswordResetUrl(req, token) {
  const url = new URL('/golfadmin/reset-password', getClientAppBaseUrl(req))
  url.searchParams.set('token', String(token || ''))
  return url.toString()
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}


const SUPPORT_DESTINATION_EMAIL = 'golfhomiez@outlook.com'
const SUPPORT_SUBJECT_MAX_LENGTH = 160
const SUPPORT_MESSAGE_MAX_LENGTH = 5000

function parseSupportCookies(cookieHeader = '') {
  return String(cookieHeader || '').split(';').reduce((acc, part) => {
    const [rawKey, ...rest] = part.trim().split('=')
    if (!rawKey) return acc
    try {
      acc[rawKey] = decodeURIComponent(rest.join('=') || '')
    } catch (_) {
      acc[rawKey] = rest.join('=') || ''
    }
    return acc
  }, {})
}

function sanitizeSupportField(value, maxLength) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, maxLength)
}

function htmlWithBreaks(value) {
  return escapeHtml(value).replace(/\n/g, '<br>')
}

async function getSupportRequester(req) {
  const cookies = parseSupportCookies(req.headers.cookie || '')
  const db = getPool()

  const hostSessionId = cookies.golfhomiez_host_session
  if (hostSessionId) {
    const hostAccount = await getHostAccountBySession(db, hostSessionId)
    if (hostAccount) {
      return {
        accountType: 'host',
        accountTypeLabel: 'Host account',
        accountId: hostAccount.id,
        email: hostAccount.email || '',
        name: hostAccount.contact_name || hostAccount.golf_course_name || hostAccount.email || 'Host account',
        metadata: {
          golfCourseName: hostAccount.golf_course_name || null,
          contactName: hostAccount.contact_name || null,
        },
        sessionCookie: serializeHostSessionCookie(hostSessionId),
      }
    }
  }

  const organizerSessionId = cookies.golfhomiez_organizer_session
  if (organizerSessionId) {
    const organizerAccount = await getOrganizerAccountBySession(db, organizerSessionId)
    if (organizerAccount) {
      return {
        accountType: 'organizer',
        accountTypeLabel: 'Organizer account',
        accountId: organizerAccount.id,
        email: organizerAccount.email || '',
        name: organizerAccount.contactName || organizerAccount.organizationName || organizerAccount.email || 'Organizer account',
        metadata: {
          organizationName: organizerAccount.organizationName || null,
          contactName: organizerAccount.contactName || null,
        },
        sessionCookie: serializeOrganizerSessionCookie(organizerSessionId),
      }
    }
  }

  const user = await getAuthenticatedUserFromRequest(req)
  if (user) {
    return {
      accountType: 'golf_user',
      accountTypeLabel: 'Golf user account',
      accountId: user.id,
      email: user.email || '',
      name: user.name || user.email || 'Golf user',
      metadata: {},
      sessionCookie: null,
    }
  }

  return null
}

function buildSupportEmail(req, requester, subject, message) {
  const submittedAt = new Date().toISOString()
  const emailSubject = `[GolfHomiez Support] ${requester.accountTypeLabel}: ${subject}`
  const metadataLines = Object.entries(requester.metadata || {})
    .filter(([, value]) => value != null && String(value).trim())
    .map(([key, value]) => `- ${key}: ${value}`)

  const text = [
    `Account type: ${requester.accountTypeLabel}`,
    `Account id: ${requester.accountId || 'not available'}`,
    `Account email: ${requester.email || 'not available'}`,
    `Account name: ${requester.name || 'not available'}`,
    `Correlation id: ${req.correlationId || 'not available'}`,
    `Submitted at: ${submittedAt}`,
    ...(metadataLines.length ? ['', 'Account metadata:', ...metadataLines] : []),
    '',
    `Subject: ${subject}`,
    '',
    'Message:',
    message,
  ].join('\n')

  const html = `
    <h2>GolfHomiez support request</h2>
    <p><strong>Account type:</strong> ${escapeHtml(requester.accountTypeLabel)}</p>
    <p><strong>Account id:</strong> ${escapeHtml(requester.accountId || 'not available')}</p>
    <p><strong>Account email:</strong> ${escapeHtml(requester.email || 'not available')}</p>
    <p><strong>Account name:</strong> ${escapeHtml(requester.name || 'not available')}</p>
    <p><strong>Correlation id:</strong> ${escapeHtml(req.correlationId || 'not available')}</p>
    <p><strong>Submitted at:</strong> ${escapeHtml(submittedAt)}</p>
    ${metadataLines.length ? `<p><strong>Account metadata:</strong></p><ul>${Object.entries(requester.metadata || {}).filter(([, value]) => value != null && String(value).trim()).map(([key, value]) => `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</li>`).join('')}</ul>` : ''}
    <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
    <p><strong>Message:</strong><br>${htmlWithBreaks(message)}</p>
  `

  return { subject: emailSubject, text, html }
}

async function sendAdminPasswordResetEmail(req, adminUser, token) {
  const resetUrl = buildAdminPasswordResetUrl(req, token)
  const username = String(adminUser?.username || 'admin').trim() || 'admin'
  const subject = 'Reset your GolfHomiez admin password'
  const text = [
    `Hello ${username},`,
    '',
    'A password reset was requested for your GolfHomiez admin account.',
    'Use the link below to set a new password. This link expires in 60 minutes.',
    '',
    resetUrl,
    '',
    'If you did not request this reset, you can ignore this email.',
  ].join('\n')
  const html = `
    <p>Hello ${escapeHtml(username)},</p>
    <p>A password reset was requested for your GolfHomiez admin account.</p>
    <p><a href="${escapeHtml(resetUrl)}">Reset your admin password</a></p>
    <p>This link expires in 60 minutes. If you did not request this reset, you can ignore this email.</p>
  `

  await sendMail({
    to: adminUser.email,
    subject,
    text,
    html,
  })
  return resetUrl
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

function sanitizeProfilePayload(body = {}, options = {}) {
  const phone = sanitizeProfilePhone(body.phone, 64)
  const primaryCity = normalizeProfileValue(body.primaryCity)
  const primaryState = normalizeProfileValue(body.primaryState)
  const primaryZipCode = normalizeProfileValue(body.primaryZipCode)
  const socialPreferencesEnabled = Boolean(options.socialPreferencesEnabled)
  const alcoholPreference = socialPreferencesEnabled ? (normalizeProfileValue(body.alcoholPreference) || '') : ''
  const cannabisPreference = socialPreferencesEnabled ? (normalizeProfileValue(body.cannabisPreference) || '') : ''
  const sobrietyPreference = socialPreferencesEnabled ? (normalizeProfileValue(body.sobrietyPreference) || '') : ''

  if (!phone) throw new Error('Phone number is required.')
  if (!primaryCity || !primaryState || !primaryZipCode) {
    throw new Error('City, state, and zip code are required.')
  }
  if (socialPreferencesEnabled) {
    if (!ALCOHOL_PREFERENCES.has(alcoholPreference)) throw new Error('Select a valid alcohol preference.')
    if (!CANNABIS_PREFERENCES.has(cannabisPreference)) throw new Error('Select a valid weed preference.')
    if (!SOBRIETY_PREFERENCES.has(sobrietyPreference)) throw new Error('Select a valid sobriety preference.')
    if (sobrietyPreference === 'sober_only' && (alcoholPreference === 'alcohol_friendly' || cannabisPreference === 'weed_friendly')) {
      throw new Error('Sober golf cannot be combined with alcohol or 420 preferences.')
    }
  }

  return {
    phone,
    primaryCity,
    primaryState,
    primaryZipCode,
    alcoholPreference,
    cannabisPreference,
    sobrietyPreference,
    socialPreferencesEnabled,
  }
}

async function ensureAppUserProfileRow(user) {
  const pool = getPool()
  await pool.execute(
    `INSERT INTO app_users (id, auth_user_id, email, name)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY ` + `UPDATE
       email = VALUES(email),
       name = VALUES(name)`,
    [user.id, user.id, normalizeEmail(user.email), user.name || null],
  )

  const [rows] = await pool.execute(
    `SELECT id, auth_user_id, email, name, phone,
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

function mapProfileRow(row, options = {}) {
  if (!row) return null
  const socialPreferencesEnabled = isFeatureEnabled(options.featureFlags, 'profileSocialPreferences')
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone || '',
    primaryCity: row.primary_city || '',
    primaryState: row.primary_state || '',
    primaryZipCode: row.primary_zip_code || '',
    alcoholPreference: socialPreferencesEnabled ? (row.alcohol_preference || '') : '',
    cannabisPreference: socialPreferencesEnabled ? (row.cannabis_preference || '') : '',
    sobrietyPreference: socialPreferencesEnabled ? (row.sobriety_preference || '') : '',
    profileEnrichedAt: row.profile_enriched_at || null,
    needsEnrichment: !row.profile_enriched_at || !row.phone || !row.primary_city || !row.primary_state || !row.primary_zip_code,
    summary: options.summary || null,
    featureFlags: options.featureFlags || {},
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
    teamId: row.team_id || null,
    teamName: row.team_name || null,
    teamMembers: parseTeamMembers(row.team_members_json),
  }
}


function parseTournamentTemplateData(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch { return null }
}


function sanitizeCurrencyField(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const stripped = raw.replace(/[^\d.]/g, '')
  if (!stripped) return null
  const numeric = Number(stripped)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(numeric)
}

function sanitizeTournamentTemplateData(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const cleanString = (key) => source[key] == null ? null : String(source[key]).trim() || null
  const startType = String(source.startType || 'shotgun').trim()
  const logoFiles = Array.isArray(source.logoFiles) ? source.logoFiles.map((logo) => String(logo || '').trim()).filter(Boolean).slice(0, 18) : []
  return {
    hostOrganization: cleanString('hostOrganization'),
    beneficiaryCharity: cleanString('beneficiaryCharity'),
    charityMessage: cleanString('charityMessage'),
    locationAddress: cleanString('locationAddress'),
    checkInTime: cleanString('checkInTime'),
    teeTime: cleanString('teeTime'),
    startType: startType === 'tee-times' ? 'tee-times' : 'shotgun',
    tournamentFormat: cleanString('tournamentFormat'),
    registrationDeadline: cleanString('registrationDeadline'),
    entryFee: sanitizeCurrencyField(source.entryFee),
    feesInclude: cleanString('feesInclude'),
    prizeDetails: cleanString('prizeDetails'),
    holeContestsExtras: cleanString('holeContestsExtras'),
    contactPerson: cleanString('contactPerson'),
    contactPhone: sanitizeProfilePhone(source.contactPhone, 64),
    contactEmail: cleanString('contactEmail'),
    logoFiles,
    supportingPhotoUrl: cleanString('supportingPhotoUrl'),
    miscNotes: cleanString('miscNotes'),
    sponsorsAvailable: Boolean(source.sponsorsAvailable),
  }
}


async function resolveTournamentGolfCourseAddress(row, req = null) {
  if (!row) return row
  const mappedRow = { ...row }
  if (mappedRow.host_golf_course_address && mappedRow.host_golf_course_city) return mappedRow

  const courseName = mappedRow.host_golf_course_name || mappedRow.host_account_name || ''
  const courseState = mappedRow.host_golf_course_state || mappedRow.host_account_state || mappedRow.host_state || mappedRow.state || ''
  if (!courseName) return mappedRow

  try {
    const course = await getGolfCourseByName(courseName, courseState)
    const physicalAddress = formatGolfCoursePhysicalAddress(course)
    const resolvedCity = String(course?.city || '').trim()
    const resolvedState = String(course?.state_code || course?.state || '').trim()
    if (resolvedCity && !mappedRow.host_golf_course_city) mappedRow.host_golf_course_city = resolvedCity
    if (resolvedState && !mappedRow.host_golf_course_state) mappedRow.host_golf_course_state = resolvedState
    if (physicalAddress) {
      mappedRow.host_golf_course_address = physicalAddress
      logApi('tournament_golf_course_address_resolved', {
        ...(req ? requestContext(req) : {}),
        tournamentId: mappedRow.id || null,
        courseName,
        courseState: courseState || null,
        courseId: course?.id || null,
        addressResolved: true,
        city: mappedRow.host_golf_course_city || null,
        state: mappedRow.host_golf_course_state || courseState || null,
      })
    } else {
      logApi('tournament_golf_course_address_missing', {
        ...(req ? requestContext(req) : {}),
        tournamentId: mappedRow.id || null,
        courseName,
        courseState: courseState || null,
        addressResolved: false,
      })
    }
  } catch (error) {
    logError('Tournament golf course address lookup failed', { correlationId: req?.correlationId || null, tournamentId: mappedRow.id || null, courseName, courseState, error })
  }
  return mappedRow
}

async function resolveTournamentGolfCourseAddresses(rows = [], req = null) {
  return Promise.all((Array.isArray(rows) ? rows : []).map((row) => resolveTournamentGolfCourseAddress(row, req)))
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
    templateKey: row.template_key || 'classic-flyer',
    templateBackgroundImageUrl: row.template_background_image_url || null,
    templateData: parseTournamentTemplateData(row.template_data),
    organizerName: row.organizer_name || null,
    hostGolfCourseName: row.host_golf_course_name || row.host_account_name || null,
    hostGolfCourseCity: row.host_golf_course_city || row.host_account_city || null,
    hostGolfCourseState: row.host_golf_course_state || row.host_account_state || row.host_state || row.state || null,
    hostGolfCourseAddress: row.host_golf_course_address || null,
    registrationCount: Number(row.registration_count || 0),
    registeredTeamCount: Number(row.registered_team_count || row.registration_count || 0),
    verifiedUserCount: Number(row.verified_user_count || 0),
    teamSlotLimit: normalizeTournamentTeamSlotLimit(row.team_slot_limit),
    openTeamSlotCount: Math.max(normalizeTournamentTeamSlotLimit(row.team_slot_limit) - Number(row.registered_team_count || row.registration_count || 0), 0),
    registrations: Array.isArray(row.registrations) ? row.registrations : [],
    portalPath: tournamentPortalPath(row.tournament_identifier || row.id),
    portalUrl: req ? tournamentPortalUrl(req, row.tournament_identifier || row.id) : tournamentPortalPath(row.tournament_identifier || row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activityAt: row.activity_at || row.updated_at || row.created_at || null,
  }
}


function serializeTeamMembers(members = []) {
  return JSON.stringify((Array.isArray(members) ? members : []).map((member) => ({
    id: member.id || null,
    name: String(member.name || '').trim(),
    email: normalizeEmail(member.email),
  })).filter((member) => member.name || member.email))
}

function parseTeamMembers(value) {
  if (!value) return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(parsed) ? parsed.map((member) => ({
      id: member?.id || null,
      name: String(member?.name || '').trim(),
      email: normalizeEmail(member?.email),
    })).filter((member) => member.name || member.email) : []
  } catch (_) {
    return []
  }
}

function normalizeTournamentTeamSlotLimit(value, fallback = DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, 9999)
}

function collectTournamentRegistrationEmails(registrations = []) {
  const emails = new Set()
  for (const registration of Array.isArray(registrations) ? registrations : []) {
    const registeredMembers = (Array.isArray(registration?.teamMembers) ? registration.teamMembers : [])
      .filter((member) => member?.registered === true)
    if (registeredMembers.length) {
      registeredMembers.forEach((member) => {
        const memberEmail = normalizeEmail(member?.email)
        if (memberEmail) emails.add(memberEmail)
      })
      continue
    }

    const registrationEmail = normalizeEmail(registration?.email)
    if (registrationEmail) emails.add(registrationEmail)
  }
  return [...emails]
}

async function countVerifiedTournamentUsers(pool, registrations = []) {
  const annotatedVerifiedEmails = new Set()
  for (const registration of Array.isArray(registrations) ? registrations : []) {
    for (const member of Array.isArray(registration?.teamMembers) ? registration.teamMembers : []) {
      if (member?.registered === true && member?.verified === true) {
        const email = normalizeEmail(member.email)
        if (email) annotatedVerifiedEmails.add(email)
      }
    }
  }
  if (annotatedVerifiedEmails.size) return annotatedVerifiedEmails.size

  const emails = collectTournamentRegistrationEmails(registrations)
  if (!emails.length) return 0
  const placeholders = emails.map(() => '?').join(',')
  try {
    const [rows] = await pool.execute(
      `SELECT LOWER(email) AS email
         FROM \`user\`
        WHERE LOWER(email) IN (${placeholders})
          AND COALESCE(emailVerified, 0) <> 0`,
      emails,
    )
    return new Set(rows.map((row) => normalizeEmail(row.email))).size
  } catch (error) {
    logError('Tournament verified-user count failed', { error, emailCount: emails.length })
    return 0
  }
}

async function buildTournamentCapacityStats(pool, tournament, registrations = []) {
  const teamSlotLimit = normalizeTournamentTeamSlotLimit(tournament?.teamSlotLimit ?? tournament?.team_slot_limit)
  const registeredTeamCount = Array.isArray(registrations) ? registrations.length : 0
  const verifiedUserCount = await countVerifiedTournamentUsers(pool, registrations)
  return {
    teamSlotLimit,
    registeredTeamCount,
    verifiedUserCount,
    openTeamSlotCount: Math.max(teamSlotLimit - registeredTeamCount, 0),
  }
}

async function attachTournamentCapacityStats(pool, tournament, registrations = []) {
  const stats = await buildTournamentCapacityStats(pool, tournament, registrations)
  return { ...tournament, ...stats, registrationCount: stats.registeredTeamCount }
}

function enforceTournamentTeamSize(members = []) {
  if (![2, 4].includes(members.length)) throw new Error('Tournament teams must have exactly 2 or 4 players.')
}

async function resolveRegistrationTeam(pool, body = {}, user) {
  const requestedTeamId = String(body.teamId || '').trim()
  const requesterEmail = normalizeEmail(user?.email)

  if (requestedTeamId) {
    const team = await storage.getTeamById(requestedTeamId)
    if (!team) throw new Error('Selected team was not found.')
    const isMember = (team.members || []).some((member) => normalizeEmail(member.email) === requesterEmail)
    if (!isMember) throw new Error('You must be a member of an existing team to register it for a tournament.')
    enforceTournamentTeamSize(team.members || [])
    return { teamId: team.id, teamName: team.name, teamMembers: team.members || [] }
  }

  const teamName = String(body.teamName || '').trim()
  const rawMembers = Array.isArray(body.teamMembers) ? body.teamMembers : []
  if (!teamName) throw new Error('Team name is required for tournament registration.')
  const normalizedMembers = normalizeCreateTeamMembers(rawMembers, user)
  enforceTournamentTeamSize(normalizedMembers)
  for (const member of normalizedMembers) {
    if (!member.name) throw new Error('Each team member must have a name.')
    if (!isEmail(member.email)) throw new Error(`Invalid team member email: ${member.email}`)
  }
  const existing = await storage.getTeamByName(teamName)
  if (existing) throw new Error('A team with that name already exists. Choose it from existing teams or use a different name.')
  const team = await storage.createTeam({ name: teamName, members: normalizedMembers })
  return { teamId: team.id, teamName: team.name, teamMembers: team.members || normalizedMembers }
}

function ensureRegistrationLeadMember(registration) {
  const members = Array.isArray(registration?.teamMembers) ? [...registration.teamMembers] : []
  const registrationEmail = normalizeEmail(registration?.email)
  if (registrationEmail && !members.some((member) => normalizeEmail(member.email) === registrationEmail)) {
    members.unshift({ id: registration.authUserId || null, name: registration.name || registrationEmail, email: registrationEmail })
  }
  return members
}

function tournamentRegistrationTeamKey(registration) {
  const teamId = String(registration?.teamId || '').trim()
  if (teamId) return `team:${teamId}`
  const teamName = String(registration?.teamName || '').trim().toLowerCase()
  if (teamName) return `name:${teamName}`
  return `registration:${registration?.id}`
}

async function loadVerifiedRegistrationEmails(pool, registeredEmails = []) {
  const emails = [...new Set((registeredEmails || []).map((email) => normalizeEmail(email)).filter(Boolean))]
  if (!emails.length) return new Set()
  const placeholders = emails.map(() => '?').join(',')
  try {
    const [rows] = await pool.execute(
      `SELECT LOWER(email) AS email
         FROM \`user\`
        WHERE LOWER(email) IN (${placeholders})
          AND COALESCE(emailVerified, 0) <> 0`,
      emails,
    )
    return new Set(rows.map((row) => normalizeEmail(row.email)).filter(Boolean))
  } catch (error) {
    logError('Tournament registration member verification lookup failed', { error, emailCount: emails.length })
    return new Set()
  }
}

async function groupTournamentRegistrationsByTeam(pool, registrations = []) {
  const registrationRows = Array.isArray(registrations) ? registrations : []
  const registeredByEmail = new Map()
  const registeredByAuthUserId = new Map()

  for (const registration of registrationRows) {
    const email = normalizeEmail(registration.email)
    if (email && !registeredByEmail.has(email)) registeredByEmail.set(email, registration)
    const authUserId = String(registration.authUserId || '').trim()
    if (authUserId && !registeredByAuthUserId.has(authUserId)) registeredByAuthUserId.set(authUserId, registration)
  }

  const verifiedEmails = await loadVerifiedRegistrationEmails(pool, [...registeredByEmail.keys()])
  const groups = new Map()

  for (const registration of registrationRows) {
    const key = tournamentRegistrationTeamKey(registration)
    if (!groups.has(key)) {
      groups.set(key, {
        ...registration,
        id: registration.id,
        registeredAt: registration.registeredAt,
        teamMembers: [],
      })
    }
    const group = groups.get(key)
    const existingMembers = new Map((group.teamMembers || []).map((member) => [normalizeEmail(member.email) || String(member.id || ''), member]))
    for (const member of ensureRegistrationLeadMember(registration)) {
      const email = normalizeEmail(member.email)
      const authUserId = String(member.id || '').trim()
      const matchingRegistration = (email && registeredByEmail.get(email)) || (authUserId && registeredByAuthUserId.get(authUserId)) || null
      const memberKey = email || authUserId || `${registration.id}:${group.teamMembers.length}`
      const annotatedMember = {
        id: member.id || matchingRegistration?.authUserId || null,
        name: String(member.name || matchingRegistration?.name || email || 'Team member').trim(),
        email,
        registered: Boolean(matchingRegistration),
        verified: Boolean(matchingRegistration && verifiedEmails.has(normalizeEmail(matchingRegistration.email))),
        registrationId: matchingRegistration?.id || null,
        registrationAuthUserId: matchingRegistration?.authUserId || null,
        registeredAt: matchingRegistration?.registeredAt || null,
      }
      const existing = existingMembers.get(memberKey)
      if (existing) {
        Object.assign(existing, {
          ...annotatedMember,
          name: existing.name || annotatedMember.name,
          email: existing.email || annotatedMember.email,
          registered: Boolean(existing.registered || annotatedMember.registered),
          verified: Boolean(existing.verified || annotatedMember.verified),
          registrationId: existing.registrationId || annotatedMember.registrationId,
          registrationAuthUserId: existing.registrationAuthUserId || annotatedMember.registrationAuthUserId,
          registeredAt: existing.registeredAt || annotatedMember.registeredAt,
        })
      } else {
        group.teamMembers.push(annotatedMember)
        existingMembers.set(memberKey, annotatedMember)
      }
    }
  }

  return [...groups.values()]
}

async function tournamentTeamAlreadyRegistered(pool, tournamentId, registrationTeam) {
  const teamId = String(registrationTeam?.teamId || '').trim()
  if (teamId) {
    const [rows] = await pool.execute(
      `SELECT id
         FROM tournament_registrations
        WHERE tournament_id = ?
          AND team_id = ?
          AND status = 'registered'
        LIMIT 1`,
      [tournamentId, teamId],
    )
    return Boolean(rows[0])
  }

  const teamName = String(registrationTeam?.teamName || '').trim()
  if (!teamName) return false
  const [rows] = await pool.execute(
    `SELECT id
       FROM tournament_registrations
      WHERE tournament_id = ?
        AND LOWER(team_name) = LOWER(?)
        AND status = 'registered'
      LIMIT 1`,
    [tournamentId, teamName],
  )
  return Boolean(rows[0])
}

async function listTournamentRegistrations(pool, tournamentIds = []) {
  const ids = [...new Set((tournamentIds || []).filter(Boolean).map((id) => String(id)))]
  if (!ids.length) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const [rows] = await pool.execute(
    `SELECT tr.id, tr.tournament_id, tr.auth_user_id, tr.email, tr.name, tr.status, tr.team_id, tr.team_name, tr.team_members_json, tr.created_at, tr.updated_at
       FROM tournament_registrations tr
      WHERE tr.tournament_id IN (${placeholders})
        AND tr.status = 'registered'
      ORDER BY tr.created_at ASC`,
    ids,
  )
  const rawByTournament = new Map(ids.map((id) => [id, []]))
  for (const row of rows) {
    const tournamentId = String(row.tournament_id)
    if (!rawByTournament.has(tournamentId)) rawByTournament.set(tournamentId, [])
    rawByTournament.get(tournamentId).push(mapTournamentRegistrationRow(row))
  }

  const byTournament = new Map(ids.map((id) => [id, []]))
  for (const [tournamentId, tournamentRegistrations] of rawByTournament.entries()) {
    byTournament.set(tournamentId, await groupTournamentRegistrationsByTeam(pool, tournamentRegistrations))
  }
  return byTournament
}

async function attachTournamentRegistrations(pool, tournaments = []) {
  const registrationsByTournament = await listTournamentRegistrations(pool, tournaments.map((item) => item.id))
  return Promise.all(tournaments.map(async (item) => {
    const registrations = registrationsByTournament.get(String(item.id)) || []
    const withStats = await attachTournamentCapacityStats(pool, item, registrations)
    return { ...withStats, registrations }
  }))
}


function tournamentRegistrationIncludesUser(registration, user) {
  const authUserId = String(user?.id || '').trim()
  const email = normalizeEmail(user?.email)
  if (authUserId && String(registration?.authUserId || '').trim() === authUserId) return true
  if (email && normalizeEmail(registration?.email) === email) return true
  return (Array.isArray(registration?.teamMembers) ? registration.teamMembers : []).some((member) => {
    const memberAuthUserId = String(member?.registrationAuthUserId || member?.id || '').trim()
    return (authUserId && memberAuthUserId === authUserId) || (email && normalizeEmail(member?.email) === email)
  })
}

function parseTournamentTeamScoreHoles(value) {
  if (!value) return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return normalizeHoleScorePayload(parsed) || []
  } catch (_) {
    return []
  }
}

function mapTournamentTeamScoreRow(row) {
  if (!row) return null
  const totalScore = row.total_score == null ? null : Number(row.total_score)
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    teamKey: row.team_key,
    teamId: row.team_id || null,
    teamName: row.team_name || 'Tournament team',
    totalScore: Number.isFinite(totalScore) ? totalScore : null,
    holes: parseTournamentTeamScoreHoles(row.holes_json),
    teeColor: normalizeTeeColor(row.tee_color || DEFAULT_TEE_COLOR),
    updatedAt: row.updated_at || null,
  }
}

async function buildTournamentTeamScoreContext(pool, tournamentId, user, req = null) {
  const portal = await getTournamentPortalById(pool, tournamentId, req)
  if (!portal) return { status: 404, body: { message: 'Tournament not found' } }

  const registrations = Array.isArray(portal.registrations) ? portal.registrations : []
  const currentRegistration = registrations.find((registration) => tournamentRegistrationIncludesUser(registration, user)) || null
  if (!currentRegistration) {
    return { status: 403, body: { message: 'Register for this tournament before entering or viewing tournament team scores.' } }
  }

  const [scoreRows] = await pool.execute(
    `SELECT id, tournament_id, team_key, team_id, team_name, total_score, holes_json, tee_color, updated_at
       FROM tournament_team_scores
      WHERE tournament_id = ?`,
    [portal.tournament.id],
  )
  const scoresByTeamKey = new Map(scoreRows.map((row) => [String(row.team_key || ''), mapTournamentTeamScoreRow(row)]))
  const currentTeamKey = tournamentRegistrationTeamKey(currentRegistration)
  const teams = registrations.map((registration) => {
    const teamKey = tournamentRegistrationTeamKey(registration)
    const storedScore = scoresByTeamKey.get(teamKey) || null
    return {
      teamKey,
      teamId: registration.teamId || storedScore?.teamId || null,
      teamName: registration.teamName || storedScore?.teamName || registration.name || 'Tournament team',
      totalScore: storedScore?.totalScore ?? null,
      holes: storedScore?.holes || [],
      teeColor: storedScore?.teeColor || DEFAULT_TEE_COLOR,
      updatedAt: storedScore?.updatedAt || null,
      canEdit: teamKey === currentTeamKey,
    }
  })

  return {
    status: 200,
    body: {
      tournament: {
        id: portal.tournament.id,
        tournamentIdentifier: portal.tournament.tournamentIdentifier || null,
        name: portal.tournament.name,
        startDate: portal.tournament.startDate || null,
        status: portal.tournament.status,
        hostGolfCourseName: portal.tournament.hostGolfCourseName || null,
        hostGolfCourseState: portal.tournament.hostGolfCourseState || null,
      },
      currentTeamKey,
      teams,
    },
  }
}

async function getTournamentPortalById(pool, tournamentId, req = null) {
  const organizerColumns = await listTableColumns(pool, 'organizer_role_accounts')
  const hostRoleColumns = await listTableColumns(pool, 'host_role_accounts')
  const hostAccountColumns = await listTableColumns(pool, 'host_accounts')
  const organizerNameExpr = columnExpr(organizerColumns, 'ora', ['organization_name', 'organizer_name', 'contact_name', 'email'], 'NULL')
  const hostRoleGolfCourseExpr = columnExpr(hostRoleColumns, 'hra', ['golf_course_name', 'account_name', 'course_name'], 'NULL')
  const hostAccountGolfCourseExpr = columnExpr(hostAccountColumns, 'ha', ['golf_course_name', 'account_name', 'course_name'], 'NULL')
  const hostRoleCityExpr = columnExpr(hostRoleColumns, 'hra', ['city', 'course_city'], 'NULL')
  const hostAccountCityExpr = columnExpr(hostAccountColumns, 'ha', ['city', 'course_city'], 'NULL')
  const hostRoleStateExpr = columnExpr(hostRoleColumns, 'hra', ['state_code', 'state', 'course_state'], 'NULL')
  const hostAccountStateExpr = columnExpr(hostAccountColumns, 'ha', ['state_code', 'state', 'course_state'], 'NULL')
  const [rows] = await pool.execute(
    `SELECT t.*, ${organizerNameExpr} AS organizer_name, ${hostRoleGolfCourseExpr} AS host_golf_course_name, ${hostAccountGolfCourseExpr} AS host_account_name,
            ${hostRoleCityExpr} AS host_golf_course_city, ${hostAccountCityExpr} AS host_account_city,
            ${hostRoleStateExpr} AS host_golf_course_state, ${hostAccountStateExpr} AS host_account_state,
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
  const capacityStats = await buildTournamentCapacityStats(pool, row, registrations)
  const mappedRow = await resolveTournamentGolfCourseAddress({ ...row, registrations, registration_count: registrations.length, registered_team_count: capacityStats.registeredTeamCount, verified_user_count: capacityStats.verifiedUserCount }, req)
  const tournament = { ...mapTournamentPortalRow(mappedRow, req), tournamentIdentifier: row.tournament_identifier || null, ...capacityStats }
  return { tournament, registrationCount: capacityStats.registeredTeamCount, registrations, ...capacityStats }
}

function publicTournamentPortalResponse(portal, viewerRegistration = null) {
  const { registrations: _registrations, registrationCount: _registrationCount, registeredTeamCount: _registeredTeamCount, verifiedUserCount: _verifiedUserCount, ...publicPortal } = portal || {}
  const {
    registrations: _tournamentRegistrations,
    registrationCount: _tournamentRegistrationCount,
    registeredTeamCount: _tournamentRegisteredTeamCount,
    verifiedUserCount: _tournamentVerifiedUserCount,
    ...publicTournament
  } = publicPortal.tournament || {}

  return {
    ...publicPortal,
    tournament: publicTournament,
    viewerRegistration,
    isViewerRegistered: Boolean(viewerRegistration),
  }
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
  const allowedTemplateKeys = new Set(['classic-flyer'])
  const templateKey = String(body.templateKey || 'classic-flyer').trim()
  const templateBackgroundImageUrl = String(body.templateBackgroundImageUrl || '').trim()
  if (!allowedStatuses.has(status)) throw new Error('Tournament status is invalid.')
  if (!allowedTemplateKeys.has(templateKey)) throw new Error('Tournament template is invalid.')
  return {
    name,
    description: body.description == null ? null : String(body.description).trim() || null,
    startDate: body.startDate ? String(body.startDate).slice(0, 10) : null,
    endDate: null,
    status,
    isPublic: status === 'published',
    templateKey,
    templateBackgroundImageUrl: templateBackgroundImageUrl || null,
    templateData: sanitizeTournamentTemplateData(body.templateData),
    teamSlotLimit: normalizeTournamentTeamSlotLimit(body.teamSlotLimit ?? body.team_slot_limit),
  }
}

function sanitizeProfileText(value, maxLength = 512) {
  const trimmed = String(value ?? '').trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function formatProfilePhoneNumber(value) {
  const rawDigits = String(value ?? '').replace(/\D/g, '')
  const digits = rawDigits.length === 11 && rawDigits.startsWith('1') ? rawDigits.slice(1) : rawDigits
  if (!digits) return null
  if (digits.length !== 10) throw new Error('Phone number is invalid. Use 10 digits formatted like 801 743 7000.')
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
}

function isValidProfilePhoneNumber(value) {
  try {
    return !String(value ?? '').trim() || Boolean(formatProfilePhoneNumber(value))
  } catch {
    return false
  }
}

function sanitizeProfilePhone(value, maxLength = 64) {
  const phone = sanitizeProfileText(value, maxLength)
  if (!phone) return null
  return formatProfilePhoneNumber(phone)
}


function mapHostProfileRow(row) {
  if (!row) return null
  return {
    id: row.id,
    roleAssignmentId: row.role_assignment_id || '',
    authUserId: row.auth_user_id || `host:${row.email}`,
    email: row.email,
    role: 'host',
    golfCourseName: row.golf_course_name || row.account_name || row.course_name || row.name || '',
    contactName: row.contact_name || null,
    phone: row.phone || null,
    websiteUrl: row.website_url || null,
    notes: row.notes || null,
    isValidated: Boolean(row.is_validated),
    validatedAt: row.validated_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

async function getHostProfile(pool, hostAccountId) {
  await ensureHostAuthSchema(pool)
  const [rows] = await pool.execute('SELECT * FROM host_accounts WHERE id = ? LIMIT 1', [hostAccountId])
  return mapHostProfileRow(rows[0] || null)
}

function sanitizeHostProfilePayload(body = {}) {
  const golfCourseName = sanitizeProfileText(body.golfCourseName ?? body.golf_course_name, 191)
  if (!golfCourseName) throw new Error('Golf-course name is required.')
  return {
    golfCourseName,
    contactName: sanitizeProfileText(body.contactName ?? body.contact_name, 191),
    phone: sanitizeProfilePhone(body.phone, 64),
    notes: sanitizeProfileText(body.notes, 5000),
  }
}

async function updateHostProfile(pool, hostAccountId, input) {
  await ensureHostAuthSchema(pool)
  const columns = await listTableColumns(pool, 'host_accounts')
  const updates = []
  const params = []
  const add = (column, value) => {
    if (!columns.has(column)) return
    updates.push(`${column} = ?`)
    params.push(value)
  }
  for (const column of ['golf_course_name', 'account_name', 'course_name', 'name']) add(column, input.golfCourseName)
  add('contact_name', input.contactName)
  add('phone', input.phone)
  add('notes', input.notes)
  if (columns.has('updated_at')) updates.push('updated_at = CURRENT_TIMESTAMP')
  if (!updates.length) return getHostProfile(pool, hostAccountId)
  params.push(hostAccountId)
  await pool.execute(`UPDATE host_accounts SET ${updates.join(', ')} WHERE id = ?`, params)
  return getHostProfile(pool, hostAccountId)
}

function mapOrganizerProfileRow(row) {
  if (!row) return null
  return {
    id: row.id,
    roleAssignmentId: row.role_assignment_id || '',
    authUserId: row.auth_user_id || `organizer:${row.email}`,
    email: row.email,
    role: 'organizer',
    organizationName: row.organization_name || row.organizer_name || row.contact_name || row.email,
    contactName: row.contact_name || row.organization_name || row.organizer_name || row.email,
    phone: row.phone || null,
    websiteUrl: row.website_url || null,
    notes: row.notes || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

async function getOrganizerProfile(pool, organizerAccountId) {
  await ensureOrganizerAuthSchema(pool)
  const [rows] = await pool.execute('SELECT * FROM organizer_role_accounts WHERE id = ? LIMIT 1', [organizerAccountId])
  return mapOrganizerProfileRow(rows[0] || null)
}

function sanitizeOrganizerProfilePayload(body = {}) {
  const organizationName = sanitizeProfileText(body.organizationName ?? body.organization_name, 191)
  if (!organizationName) throw new Error('Organization name is required.')
  return {
    organizationName,
    contactName: sanitizeProfileText(body.contactName ?? body.contact_name, 191),
    phone: sanitizeProfilePhone(body.phone, 64),
    notes: sanitizeProfileText(body.notes, 5000),
  }
}

async function updateOrganizerProfile(pool, organizerAccountId, input) {
  await ensureOrganizerAuthSchema(pool)
  const columns = await listTableColumns(pool, 'organizer_role_accounts')
  const updates = []
  const params = []
  const add = (column, value) => {
    if (!columns.has(column)) return
    updates.push(`${column} = ?`)
    params.push(value)
  }
  add('organization_name', input.organizationName)
  add('organizer_name', input.organizationName)
  add('contact_name', input.contactName)
  add('phone', input.phone)
  add('notes', input.notes)
  if (columns.has('updated_at')) updates.push('updated_at = CURRENT_TIMESTAMP')
  if (!updates.length) return getOrganizerProfile(pool, organizerAccountId)
  params.push(organizerAccountId)
  await pool.execute(`UPDATE organizer_role_accounts SET ${updates.join(', ')} WHERE id = ?`, params)
  return getOrganizerProfile(pool, organizerAccountId)
}

async function updateOrganizerInvitedTournament(pool, user, tournamentId, input, req = null) {
  const existing = await getOrganizerEditableTournament(pool, user, tournamentId)
  if (!existing) return null
  await pool.execute(
    `UPDATE tournaments
        SET name = ?, description = ?, start_date = ?, end_date = ?, status = ?, is_public = ?, template_key = ?, template_background_image_url = ?, template_data = ?, team_slot_limit = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [input.name, input.description, input.startDate, input.endDate, input.status, input.isPublic ? 1 : 0, input.templateKey, input.templateBackgroundImageUrl, JSON.stringify(input.templateData || {}), input.teamSlotLimit, existing.id],
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
  const hostRoleColumns = await listTableColumns(pool, 'host_role_accounts')
  const hostAccountColumns = await listTableColumns(pool, 'host_accounts')
  const organizerJoinNameExpr = columnExpr(organizerColumns, 'ora', ['organization_name', 'organizer_name', 'contact_name', 'email'], 'NULL')
  const hostRoleGolfCourseExpr = columnExpr(hostRoleColumns, 'hra', ['golf_course_name', 'account_name', 'course_name'], 'NULL')
  const hostAccountGolfCourseExpr = columnExpr(hostAccountColumns, 'ha', ['golf_course_name', 'account_name', 'course_name'], 'NULL')
  const hostRoleStateExpr = columnExpr(hostRoleColumns, 'hra', ['state_code', 'state', 'course_state'], 'NULL')
  const hostAccountStateExpr = columnExpr(hostAccountColumns, 'ha', ['state_code', 'state', 'course_state'], 'NULL')
  const organizerAccountFilter = organizerAccount ? 't.organizer_account_id = ? OR' : ''
  const inviteJoin = inviteColumns.size
    ? 'LEFT JOIN organizer_tournament_invites oti ON oti.tournament_id = t.id'
    : 'LEFT JOIN (SELECT NULL AS tournament_id, NULL AS organizer_email, NULL AS id, NULL AS status, NULL AS invite_url, NULL AS updated_at, NULL AS created_at) oti ON oti.tournament_id = t.id'
  const inviteUpdatedAtExpr = inviteColumns.has('updated_at') ? 'oti.updated_at' : 'NULL'
  const inviteCreatedAtExpr = inviteColumns.has('created_at') ? 'oti.created_at' : 'NULL'
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
            COALESCE(${hostRoleGolfCourseExpr}, ${hostAccountGolfCourseExpr}) AS host_golf_course_name,
            COALESCE(${hostRoleStateExpr}, ${hostAccountStateExpr}) AS host_golf_course_state,
            oti.id AS invite_id,
            oti.status AS invite_status,
            oti.invite_url AS invite_url,
            GREATEST(COALESCE(t.updated_at, t.created_at), COALESCE(${inviteUpdatedAtExpr}, ${inviteCreatedAtExpr}), COALESCE(t.created_at, t.updated_at)) AS activity_at
       FROM tournaments t
       LEFT JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
       LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
       LEFT JOIN host_accounts ha ON ha.id = t.host_account_id
       ${inviteJoin}
      WHERE ${organizerAccountFilter} LOWER(COALESCE(t.organizer_email, '')) = LOWER(?)
         OR LOWER(COALESCE(oti.organizer_email, '')) = LOWER(?)
      ORDER BY activity_at DESC, t.created_at DESC`,
    params,
  )

  const tournamentRowsWithAddresses = await resolveTournamentGolfCourseAddresses(tournamentRows, req)
  const tournaments = tournamentRowsWithAddresses.map((row) => ({
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
  const organizerColumns = await listTableColumns(pool, 'organizer_role_accounts')
  const hostRoleColumns = await listTableColumns(pool, 'host_role_accounts')
  const hostAccountColumns = await listTableColumns(pool, 'host_accounts')
  const organizerNameExpr = columnExpr(organizerColumns, 'ora', ['organization_name', 'organizer_name', 'contact_name', 'email'], 'NULL')
  const hostRoleGolfCourseExpr = columnExpr(hostRoleColumns, 'hra', ['golf_course_name', 'account_name', 'course_name'], 'NULL')
  const hostAccountGolfCourseExpr = columnExpr(hostAccountColumns, 'ha', ['golf_course_name', 'account_name', 'course_name'], 'NULL')
  const hostRoleStateExpr = columnExpr(hostRoleColumns, 'hra', ['state_code', 'state', 'course_state'], 'NULL')
  const hostAccountStateExpr = columnExpr(hostAccountColumns, 'ha', ['state_code', 'state', 'course_state'], 'NULL')
  const hostRoleAssignmentJoinConditions = [
    hostRoleColumns.has('auth_user_id') ? 'host_ura.auth_user_id = hra.auth_user_id' : null,
    hostRoleColumns.has('email') ? 'LOWER(host_ura.email) = LOWER(hra.email)' : null,
  ].filter(Boolean).join(' OR ') || '1 = 0'
  const hostRoleAssignmentJoin = hostRoleColumns.has('role_assignment_id')
    ? 'LEFT JOIN user_role_assignments host_ura ON host_ura.id = hra.role_assignment_id'
    : `LEFT JOIN user_role_assignments host_ura ON ${hostRoleAssignmentJoinConditions}`
  const [rows] = await pool.execute(
    `SELECT DISTINCT t.*, ${organizerNameExpr} AS organizer_name,
            COALESCE(${hostRoleGolfCourseExpr}, ${hostAccountGolfCourseExpr}) AS host_golf_course_name,
            COALESCE(${hostRoleStateExpr}, ${hostAccountStateExpr}) AS host_golf_course_state
       FROM tournaments t
       LEFT JOIN organizer_role_accounts ora ON ora.id = t.organizer_account_id
       LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
       ${hostRoleAssignmentJoin}
       LEFT JOIN host_accounts ha ON ha.id = t.host_account_id
      WHERE t.host_account_id = ?
         OR LOWER(COALESCE(${hostRoleGolfCourseExpr}, ${hostAccountGolfCourseExpr}, '')) = LOWER(?)
         OR LOWER(COALESCE(host_ura.email, ha.email, '')) = LOWER(?)
      ORDER BY t.created_at DESC, t.start_date DESC`,
    [hostAccount?.id || '', hostAccount?.golfCourseName || hostAccount?.golf_course_name || '', hostAccount?.email || ''],
  )
  const rowsWithAddresses = await resolveTournamentGolfCourseAddresses(rows, req)
  const tournaments = rowsWithAddresses.map((row) => ({
    ...mapTournamentPortalRow(row, req),
    tournamentIdentifier: row.tournament_identifier || null,
    organizerEmail: row.organizer_email || null,
    registrationUrl: String(row.status || '') === 'published' ? (req ? tournamentPortalUrl(req, row.tournament_identifier || row.id) : tournamentPortalPath(row.tournament_identifier || row.id)) : null,
  }))
  return attachTournamentRegistrations(pool, tournaments)
}

async function getHostEditableTournament(pool, hostAccount, tournamentId) {
  const hostRoleColumns = await listTableColumns(pool, 'host_role_accounts')
  const hostAccountColumns = await listTableColumns(pool, 'host_accounts')
  const hostRoleGolfCourseExpr = columnExpr(hostRoleColumns, 'hra', ['golf_course_name', 'account_name', 'course_name'], 'NULL')
  const hostAccountGolfCourseExpr = columnExpr(hostAccountColumns, 'ha', ['golf_course_name', 'account_name', 'course_name'], 'NULL')
  const hostRoleStateExpr = columnExpr(hostRoleColumns, 'hra', ['state_code', 'state', 'course_state'], 'NULL')
  const hostAccountStateExpr = columnExpr(hostAccountColumns, 'ha', ['state_code', 'state', 'course_state'], 'NULL')
  const hostRoleAssignmentJoinConditions = [
    hostRoleColumns.has('auth_user_id') ? 'host_ura.auth_user_id = hra.auth_user_id' : null,
    hostRoleColumns.has('email') ? 'LOWER(host_ura.email) = LOWER(hra.email)' : null,
  ].filter(Boolean).join(' OR ') || '1 = 0'
  const hostRoleAssignmentJoin = hostRoleColumns.has('role_assignment_id')
    ? 'LEFT JOIN user_role_assignments host_ura ON host_ura.id = hra.role_assignment_id'
    : `LEFT JOIN user_role_assignments host_ura ON ${hostRoleAssignmentJoinConditions}`
  const [rows] = await pool.execute(
    `SELECT DISTINCT t.*
       FROM tournaments t
       LEFT JOIN host_role_accounts hra ON hra.id = t.host_account_id
       ${hostRoleAssignmentJoin}
       LEFT JOIN host_accounts ha ON ha.id = t.host_account_id
      WHERE (t.id = ? OR t.tournament_identifier = ?)
        AND (t.host_account_id = ?
             OR LOWER(COALESCE(${hostRoleGolfCourseExpr}, ${hostAccountGolfCourseExpr}, '')) = LOWER(?)
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
        SET name = ?, description = ?, start_date = ?, end_date = ?, status = ?, is_public = ?, template_key = ?, template_background_image_url = ?, template_data = ?, team_slot_limit = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [input.name, input.description, input.startDate, input.endDate, input.status, input.isPublic ? 1 : 0, input.templateKey, input.templateBackgroundImageUrl, JSON.stringify(input.templateData || {}), input.teamSlotLimit, existing.id],
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

app.get(['/register', '/login', '/verify-contact', '/support', '/find-tournament', '/golfadmin', '/golfadmin/scheduled-jobs', '/golfadmin/forgot-password', '/golfadmin/reset-password', '/host/register', '/host/login', '/host/request-password-reset', '/host/reset-password', '/host/portal', '/host/portal/profile', '/organizer/login', '/organizer/forgot-password', '/organizer/reset-password', '/organizer/portal/profile'], async (req, res, next) => {
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
    if (!adminUser) {
      logApi('admin_password_reset_requested_unknown_identifier', { ...requestContext(req), identifier })
      return res.json({ ok: true })
    }

    const resetToken = await createAdminResetToken(adminUser.id)
    await sendAdminPasswordResetEmail(req, adminUser, resetToken)
    logApi('admin_password_reset_email_sent', { ...requestContext(req), adminUserId: adminUser.id, username: adminUser.username, email: adminUser.email })
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
    logApi('admin_portal_metadata_loaded', { ...requestContext(req), adminUserId: req.adminUser.id, summary: data.summary, teamRows: data.teams?.length || 0, teamsWithMemberEmails: (data.teams || []).filter((team) => team.team_member_emails).length })
    res.json({ ...data, adminUser: { id: req.adminUser.id, username: req.adminUser.username, email: req.adminUser.email, isActive: !!req.adminUser.is_active } })
  } catch (error) {
    logRouteError('Admin portal load error', req, error)
    res.status(500).json({ message: 'Could not load admin portal' })
  }
})

app.get('/api/admin/external-api-calls', adminMiddleware, async (req, res) => {
  try {
    const report = await getExternalApiCallSummary({
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      apiType: req.query.apiType,
      endpoint: req.query.endpoint,
    })
    logApi('admin_external_api_call_metrics_loaded', {
      ...requestContext(req),
      adminUserId: req.adminUser.id,
      filters: report.filters,
      generatedAt: report.generatedAt,
      totalCalls: report.totalCalls,
      rowCount: report.rows.length,
    })
    res.json(report)
  } catch (error) {
    if (/start date/i.test(String(error?.message || ''))) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Admin external API call metrics load error', req, error)
    res.status(500).json({ message: 'Could not load external API call metrics' })
  }
})

app.get('/api/admin/scheduled-jobs', adminMiddleware, async (req, res) => {
  try {
    const jobs = await listScheduledJobs(getPool())
    logApi('admin_scheduled_jobs_loaded', { ...requestContext(req), adminUserId: req.adminUser.id, jobCount: jobs.length })
    logScheduledJob('admin_scheduled_jobs_loaded', { ...requestContext(req), adminUserId: req.adminUser.id, jobCount: jobs.length })
    res.json({ jobs })
  } catch (error) {
    logRouteError('Admin scheduled jobs load error', req, error)
    logScheduledJob('admin_scheduled_jobs_load_failed', { ...requestContext(req), adminUserId: req.adminUser?.id || null, error })
    res.status(500).json({ message: 'Could not load scheduled jobs' })
  }
})

app.post('/api/admin/scheduled-jobs/:id/run', adminMiddleware, async (req, res) => {
  try {
    const jobId = String(req.params.id || '').trim()
    if (!jobId) return res.status(400).json({ message: 'Scheduled job id is required' })
    logApi('admin_scheduled_job_manual_run_requested', { ...requestContext(req), adminUserId: req.adminUser.id, jobId })
    logScheduledJob('admin_scheduled_job_manual_run_requested', { ...requestContext(req), adminUserId: req.adminUser.id, jobId })
    const result = await runScheduledJob(getPool(), jobId, {
      triggeredBy: 'manual',
      correlationId: req.correlationId,
      adminUser: req.adminUser,
      logApi,
      logError,
      logScheduledJob,
    })
    const jobs = await listScheduledJobs(getPool())
    res.json({ result: { jobId: result.job.id, runId: result.runId, status: result.status, output: result.output, nextRunAt: result.nextRunAt }, jobs })
  } catch (error) {
    if (error instanceof Error && /Scheduled job not found/i.test(error.message)) {
      return res.status(404).json({ message: error.message })
    }
    if (error?.code === 'SCHEDULED_JOB_ALREADY_RUNNING') {
      return res.status(409).json({ message: error.message })
    }
    logRouteError('Admin scheduled job manual run error', req, error)
    logScheduledJob('admin_scheduled_job_manual_run_failed', { ...requestContext(req), adminUserId: req.adminUser?.id || null, jobId: req.params.id || null, error })
    res.status(500).json({ message: 'Could not run scheduled job' })
  }
})

app.put('/api/admin/scheduled-jobs/:id/schedule', adminMiddleware, async (req, res) => {
  try {
    const jobId = String(req.params.id || '').trim()
    if (!jobId) return res.status(400).json({ message: 'Scheduled job id is required' })
    logApi('admin_scheduled_job_schedule_update_requested', { ...requestContext(req), adminUserId: req.adminUser.id, jobId, schedule: req.body?.schedule || null })
    logScheduledJob('admin_scheduled_job_schedule_update_requested', { ...requestContext(req), adminUserId: req.adminUser.id, jobId, schedule: req.body?.schedule || null })
    const job = await configureScheduledJob(getPool(), jobId, {
      schedule: req.body?.schedule,
      jobConfig: req.body?.jobConfig,
      correlationId: req.correlationId,
      adminUser: req.adminUser,
      logApi,
      logScheduledJob,
    })
    if (cancelledTournamentCleanupScheduler?.reschedule) {
      await cancelledTournamentCleanupScheduler.reschedule(jobId)
    }
    const jobs = await listScheduledJobs(getPool())
    res.json({ job, jobs })
  } catch (error) {
    if (error instanceof Error && /Scheduled job not found/i.test(error.message)) {
      return res.status(404).json({ message: error.message })
    }
    if (error instanceof Error && /Schedule|Weekly|Monthly|HH:MM/i.test(error.message)) {
      logApi('admin_scheduled_job_schedule_validation_failed', { ...requestContext(req), adminUserId: req.adminUser?.id || null, jobId: req.params.id || null, error: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Admin scheduled job schedule update error', req, error)
    logScheduledJob('admin_scheduled_job_schedule_update_failed', { ...requestContext(req), adminUserId: req.adminUser?.id || null, jobId: req.params.id || null, error })
    res.status(500).json({ message: 'Could not update scheduled job schedule' })
  }
})

app.post('/api/admin/scheduled-jobs/:id/cancel', adminMiddleware, async (req, res) => {
  try {
    const jobId = String(req.params.id || '').trim()
    if (!jobId) return res.status(400).json({ message: 'Scheduled job id is required' })
    logApi('admin_scheduled_job_cancel_requested', { ...requestContext(req), adminUserId: req.adminUser.id, jobId })
    logScheduledJob('admin_scheduled_job_cancel_requested', { ...requestContext(req), adminUserId: req.adminUser.id, jobId })
    const result = await cancelScheduledJob(getPool(), jobId, {
      correlationId: req.correlationId,
      adminUser: req.adminUser,
      logApi,
      logScheduledJob,
    })
    const jobs = await listScheduledJobs(getPool())
    res.status(202).json({ result, jobs })
  } catch (error) {
    if (error instanceof Error && /Scheduled job not found/i.test(error.message)) {
      return res.status(404).json({ message: error.message })
    }
    if (error?.code === 'SCHEDULED_JOB_NOT_RUNNING') {
      return res.status(409).json({ message: error.message })
    }
    logRouteError('Admin scheduled job cancel error', req, error)
    logScheduledJob('admin_scheduled_job_cancel_failed', { ...requestContext(req), adminUserId: req.adminUser?.id || null, jobId: req.params.id || null, error })
    res.status(500).json({ message: 'Could not cancel scheduled job' })
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

app.delete('/api/admin/admin-users/:id', adminMiddleware, async (req, res) => {
  try {
    const targetAdminUserId = String(req.params.id || '').trim()
    if (!targetAdminUserId) return res.status(400).json({ message: 'Admin user id is required' })

    const result = await deleteAdminUser({ adminUserId: targetAdminUserId, requestedByAdminUserId: req.adminUser.id })
    const adminUsers = await listAdminUsers()
    logApi('admin_user_deleted', { ...requestContext(req), deletedAdminUserId: targetAdminUserId, adminUserId: req.adminUser.id })
    res.json({ ...result, adminUsers })
  } catch (error) {
    if (error instanceof Error && /not found|own admin|last active/i.test(error.message)) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Delete admin user error', req, error)
    res.status(500).json({ message: 'Could not delete admin user' })
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

app.get('/api/host/profile', hostAuthMiddleware, async (req, res) => {
  try {
    const profile = await getHostProfile(getPool(), req.hostAccount.id)
    if (!profile) return res.status(404).json({ message: 'Host profile not found' })
    logApi('host_profile_loaded', { ...requestContext(req), hostAccountId: profile.id })
    res.json(profile)
  } catch (error) {
    logRouteError('Host profile load error', req, error)
    res.status(500).json({ message: 'Could not load host profile' })
  }
})

app.put('/api/host/profile', hostAuthMiddleware, async (req, res) => {
  try {
    logApi('host_profile_update_started', { ...requestContext(req), hostAccountId: req.hostAccount.id, hasNotes: Boolean(String(req.body?.notes ?? '').trim()) })
    const input = sanitizeHostProfilePayload(req.body || {})
    const profile = await updateHostProfile(getPool(), req.hostAccount.id, input)
    logApi('host_profile_updated', { ...requestContext(req), hostAccountId: profile?.id || req.hostAccount.id })
    res.json(profile)
  } catch (error) {
    if (error instanceof Error && /required|invalid/i.test(error.message)) {
      logApi('host_profile_update_rejected', { ...requestContext(req), hostAccountId: req.hostAccount.id, reason: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host profile update error', req, error)
    res.status(500).json({ message: 'Could not update host profile' })
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
    logApi('host_tournament_updated', { ...requestContext(req), hostAccountId: req.hostAccount.id, tournamentId: tournament.id, status: tournament.status, teamSlotLimit: tournament.teamSlotLimit, registeredTeamCount: tournament.registeredTeamCount, openTeamSlotCount: tournament.openTeamSlotCount })
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
    logApi('organizer_tournament_updated', { ...requestContext(req), tournamentId: tournament.id, status: tournament.status, teamSlotLimit: tournament.teamSlotLimit, registeredTeamCount: tournament.registeredTeamCount, openTeamSlotCount: tournament.openTeamSlotCount, email: normalizeEmail(req.organizerUser?.email) })
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

app.post('/api/organizer/request-password-reset', requireStorage, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)
    if (!isEmail(email)) return res.status(400).json({ message: 'A valid email is required' })
    const db = getPool()
    await createOrganizerPasswordReset(db, { email, resetUrlBase: getHostAppBaseUrl(req) })
    logApi('organizer_password_reset_requested', { ...requestContext(req), email })
    res.json({ ok: true })
  } catch (error) {
    logRouteError('Organizer password reset request error', req, error)
    res.status(500).json({ message: 'Could not start organizer password reset' })
  }
})

app.post('/api/organizer/reset-password', requireStorage, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim()
    const password = String(req.body?.password || '')
    if (!token) return res.status(400).json({ message: 'Reset token required' })
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' })
    const db = getPool()
    await resetOrganizerPassword(db, { token, password })
    logApi('organizer_password_reset_completed', { ...requestContext(req) })
    res.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && /invalid or expired/i.test(error.message)) {
      logApi('organizer_password_reset_rejected', { ...requestContext(req), reason: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Organizer password reset error', req, error)
    res.status(500).json({ message: 'Could not reset organizer password' })
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
      logApi('organizer_portal_forbidden', { ...requestContext(req), email: normalizeEmail(req.organizerUser?.email || '') })
      return res.status(403).json({ message: 'No organizer account or tournament invitations were found for this Golf Homiez user.' })
    }
    logApi('organizer_portal_loaded', { ...requestContext(req), organizerAccountId: summary.organizerAccount?.id || null, tournamentCount: summary.tournaments.length })
    res.json(summary)
  } catch (error) {
    logRouteError('Organizer portal load error', req, error)
    res.status(500).json({ message: 'Could not load organizer portal' })
  }
})

app.get('/api/organizer/profile', requireStorage, organizerAuthMiddleware, async (req, res) => {
  try {
    const profile = await getOrganizerProfile(getPool(), req.organizerAccount.id)
    if (!profile) return res.status(404).json({ message: 'Organizer profile not found' })
    logApi('organizer_profile_loaded', { ...requestContext(req), organizerAccountId: profile.id })
    res.json(profile)
  } catch (error) {
    logRouteError('Organizer profile load error', req, error)
    res.status(500).json({ message: 'Could not load organizer profile' })
  }
})

app.put('/api/organizer/profile', requireStorage, organizerAuthMiddleware, async (req, res) => {
  try {
    logApi('organizer_profile_update_started', { ...requestContext(req), organizerAccountId: req.organizerAccount.id, hasNotes: Boolean(String(req.body?.notes ?? '').trim()) })
    const input = sanitizeOrganizerProfilePayload(req.body || {})
    const profile = await updateOrganizerProfile(getPool(), req.organizerAccount.id, input)
    logApi('organizer_profile_updated', { ...requestContext(req), organizerAccountId: profile?.id || req.organizerAccount.id })
    res.json(profile)
  } catch (error) {
    if (error instanceof Error && /required|invalid/i.test(error.message)) {
      logApi('organizer_profile_update_rejected', { ...requestContext(req), organizerAccountId: req.organizerAccount.id, reason: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Organizer profile update error', req, error)
    res.status(500).json({ message: 'Could not update organizer profile' })
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

app.get('/api/tournament-portals/:id/qr-code.svg', requireStorage, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    const pool = getPool()
    const portal = await getTournamentPortalById(pool, id, req)
    if (!portal || portal.tournament.status !== 'published') {
      logApi('tournament_portal_qr_code_not_found', { ...requestContext(req), tournamentId: id })
      return res.status(404).type('text/plain').send('Tournament not found')
    }

    const portalUrl = tournamentPortalUrl(req, portal.tournament.tournamentIdentifier || portal.tournament.id)
    const svg = generateQrSvg(portalUrl)
    logApi('tournament_portal_qr_code_generated', {
      ...requestContext(req),
      tournamentId: portal.tournament.id,
      tournamentIdentifier: portal.tournament.tournamentIdentifier || null,
      portalUrl,
    })
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=300')
    return res.send(svg)
  } catch (error) {
    logRouteError('Tournament portal QR code error', req, error)
    return res.status(500).type('text/plain').send('Could not generate tournament QR code')
  }
})

app.get('/api/tournament-portals/:id', requireStorage, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    const pool = getPool()
    const portal = await getTournamentPortalById(pool, id, req)
    if (!portal) return res.status(404).json({ message: 'Tournament not found' })
    if (portal.tournament.status !== 'published') return res.status(404).json({ message: 'Tournament not found' })

    let viewer = null
    try {
      viewer = await getAuthenticatedUserFromRequest(req)
    } catch (authError) {
      logRouteError('Tournament portal viewer auth check error', req, authError, { tournamentId: portal.tournament.id })
    }

    let viewerRegistration = null
    if (viewer?.id) {
      const [registrationRows] = await pool.execute(
        `SELECT id, tournament_id, auth_user_id, email, name, status, team_id, team_name, team_members_json, created_at, updated_at
           FROM tournament_registrations
          WHERE tournament_id = ?
            AND auth_user_id = ?
            AND status = 'registered'
          LIMIT 1`,
        [portal.tournament.id, viewer.id],
      )
      viewerRegistration = registrationRows[0] ? mapTournamentRegistrationRow(registrationRows[0]) : null
    }

    logApi('tournament_portal_loaded', { ...requestContext(req), tournamentId: id, registrationCount: portal.registrationCount, registeredTeamCount: portal.registeredTeamCount, verifiedUserCount: portal.verifiedUserCount, teamSlotLimit: portal.teamSlotLimit, openTeamSlotCount: portal.openTeamSlotCount, viewerRegistered: Boolean(viewerRegistration), publicResponseIncludesTeamRoster: false })
    res.json(publicTournamentPortalResponse(portal, viewerRegistration))
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
      `SELECT id, tournament_id, auth_user_id, email, name, status, team_id, team_name, team_members_json, created_at, updated_at
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

    const registrationTeam = await resolveRegistrationTeam(pool, req.body || {}, req.user)
    const teamAlreadyRegistered = await tournamentTeamAlreadyRegistered(pool, resolvedTournamentId, registrationTeam)
    if (!teamAlreadyRegistered && Number(portal.tournament.openTeamSlotCount ?? 0) <= 0) {
      logApi('tournament_registration_slots_full', { ...requestContext(req), tournamentId: resolvedTournamentId, requestedTournamentId: tournamentId, registeredTeamCount: portal.tournament.registeredTeamCount, teamSlotLimit: portal.tournament.teamSlotLimit, teamId: registrationTeam.teamId || null })
      return res.status(400).json({ message: 'Tournament team slots are full.' })
    }

    const registrationId = uuidv4()
    await pool.execute(
      `INSERT INTO tournament_registrations (id, tournament_id, auth_user_id, email, name, status, team_id, team_name, team_members_json, correlation_id)
       VALUES (?, ?, ?, ?, ?, 'registered', ?, ?, ?, ?)`,
      [registrationId, resolvedTournamentId, req.user.id, normalizeEmail(req.user.email), req.user.name || null, registrationTeam.teamId, registrationTeam.teamName, serializeTeamMembers(registrationTeam.teamMembers), req.correlationId || null],
    )
    const registrationUrl = portal.tournament.portalUrl || tournamentPortalUrl(req, portal.tournament.tournamentIdentifier || resolvedTournamentId)
    try {
      await sendMail({
        to: normalizeEmail(req.user.email),
        subject: `Registration confirmed: ${portal.tournament.name}`,
        text: [
          `You are registered for ${portal.tournament.name}.`,
          portal.tournament.startDate ? `Tournament date: ${portal.tournament.startDate}` : '',

          portal.tournament.hostGolfCourseName ? `Host: ${portal.tournament.hostGolfCourseName}` : '',
          portal.tournament.organizerName ? `Organizer: ${portal.tournament.organizerName}` : '',
          `Tournament link: ${registrationUrl}`,
        ].filter(Boolean).join('\n'),
        html: `
          <p>You are registered for <strong>${portal.tournament.name}</strong>.</p>
          ${portal.tournament.startDate ? `<p><strong>Tournament date:</strong> ${portal.tournament.startDate}</p>` : ''}

          ${portal.tournament.hostGolfCourseName ? `<p><strong>Host:</strong> ${portal.tournament.hostGolfCourseName}</p>` : ''}
          ${portal.tournament.organizerName ? `<p><strong>Organizer:</strong> ${portal.tournament.organizerName}</p>` : ''}
          <p><a href="${registrationUrl}">View tournament details</a></p>
        `,
      })
      logApi('tournament_registration_confirmation_email_sent', { ...requestContext(req), tournamentId: resolvedTournamentId, authUserId: req.user.id, email: normalizeEmail(req.user.email) })
    } catch (mailError) {
      logRouteError('Tournament registration confirmation email error', req, mailError)
    }
    const registeredEmail = normalizeEmail(req.user.email)
    const responseTeamMembers = (registrationTeam.teamMembers || []).map((member) => {
      const memberEmail = normalizeEmail(member.email)
      return {
        ...member,
        email: memberEmail,
        registered: memberEmail === registeredEmail,
        verified: memberEmail === registeredEmail ? Boolean(req.user.emailVerified) : false,
        registrationId: memberEmail === registeredEmail ? registrationId : null,
        registrationAuthUserId: memberEmail === registeredEmail ? req.user.id : null,
        registeredAt: memberEmail === registeredEmail ? new Date().toISOString() : null,
      }
    })
    logApi('tournament_registration_completed', { ...requestContext(req), tournamentId: resolvedTournamentId, requestedTournamentId: tournamentId, authUserId: req.user.id, email: registeredEmail, teamSlotLimit: portal.tournament.teamSlotLimit, teamAlreadyRegistered, registeredTeamCount: Number(portal.tournament.registeredTeamCount || 0) + (teamAlreadyRegistered ? 0 : 1), openTeamSlotCount: Math.max(Number(portal.tournament.openTeamSlotCount || 0) - (teamAlreadyRegistered ? 0 : 1), 0) })
    res.status(201).json({ ok: true, tournamentId: resolvedTournamentId, requestedTournamentId: tournamentId, status: 'registered', teamAlreadyRegistered, registration: { id: registrationId, tournamentId: resolvedTournamentId, authUserId: req.user.id, email: registeredEmail, name: req.user.name || registeredEmail, status: 'registered', teamId: registrationTeam.teamId, teamName: registrationTeam.teamName, teamMembers: responseTeamMembers } })
  } catch (error) {
    if (error instanceof Error && /team|member|email|players|name|exists/i.test(error.message)) {
      logApi('tournament_registration_validation_failed', { ...requestContext(req), validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Tournament registration error', req, error)
    res.status(500).json({ message: 'Could not register for tournament' })
  }
})


app.get('/api/users/tournament-search', requireStorage, authMiddleware, async (req, res) => {
  try {
    logApi('user_tournament_search_started', { ...requestContext(req), authUserId: req.user.id })
    const result = await searchGolfCourseTournaments(getPool(), {
      state: req.query.state,
      city: req.query.city,
      zipCode: req.query.zipCode,
      golfCourseName: req.query.golfCourseName,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
    }, { page: req.query.page })
    logApi('user_tournament_search_completed', {
      ...requestContext(req),
      authUserId: req.user.id,
      filters: result.filters,
      page: result.pagination.page,
      pageSize: result.pagination.pageSize,
      resultCount: result.tournaments.length,
      totalResults: result.pagination.totalResults,
    })
    res.json(result)
  } catch (error) {
    if (error instanceof Error && /date|six months|YYYY-MM-DD/i.test(error.message)) {
      logApi('user_tournament_search_validation_failed', { ...requestContext(req), authUserId: req.user?.id || null, error: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('User tournament search error', req, error)
    res.status(500).json({ message: 'Could not search golf tournaments' })
  }
})

app.get('/api/users/tournaments', requireStorage, authMiddleware, async (req, res) => {
  try {
    const pool = getPool()
    const email = normalizeEmail(req.user.email)
    const organizerColumns = await listTableColumns(pool, 'organizer_role_accounts')
    const hostRoleColumns = await listTableColumns(pool, 'host_role_accounts')
    const hostAccountColumns = await listTableColumns(pool, 'host_accounts')
    const organizerNameExpr = columnExpr(organizerColumns, 'ora', ['organization_name', 'organizer_name', 'contact_name', 'email'], 'NULL')
    const hostRoleGolfCourseExpr = columnExpr(hostRoleColumns, 'hra', ['golf_course_name', 'account_name', 'course_name'], 'NULL')
    const hostAccountGolfCourseExpr = columnExpr(hostAccountColumns, 'ha', ['golf_course_name', 'account_name', 'course_name'], 'NULL')
    const hostRoleCityExpr = columnExpr(hostRoleColumns, 'hra', ['city', 'course_city'], 'NULL')
    const hostAccountCityExpr = columnExpr(hostAccountColumns, 'ha', ['city', 'course_city'], 'NULL')
    const hostRoleStateExpr = columnExpr(hostRoleColumns, 'hra', ['state_code', 'state', 'course_state'], 'NULL')
    const hostAccountStateExpr = columnExpr(hostAccountColumns, 'ha', ['state_code', 'state', 'course_state'], 'NULL')
    const [rows] = await pool.execute(
      `SELECT t.*, ${organizerNameExpr} AS organizer_name, ${hostRoleGolfCourseExpr} AS host_golf_course_name, ${hostAccountGolfCourseExpr} AS host_account_name,
              ${hostRoleCityExpr} AS host_golf_course_city, ${hostAccountCityExpr} AS host_account_city,
              ${hostRoleStateExpr} AS host_golf_course_state, ${hostAccountStateExpr} AS host_account_state,
              tr.id AS registration_id, tr.auth_user_id AS registration_auth_user_id, tr.email AS registration_email,
              tr.name AS registration_name, tr.status AS registration_status, tr.team_id AS registration_team_id,
              tr.team_name AS registration_team_name, tr.team_members_json AS registration_team_members_json,
              tr.created_at AS registered_at, tr.updated_at AS registration_updated_at,
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
    const rowsWithAddresses = await resolveTournamentGolfCourseAddresses(rows, req)
    const tournaments = rowsWithAddresses.map((row) => ({
      ...mapTournamentPortalRow(row, req),
      tournamentIdentifier: row.tournament_identifier || null,
      registration: mapTournamentRegistrationRow({
        id: row.registration_id,
        tournament_id: row.id,
        auth_user_id: row.registration_auth_user_id,
        email: row.registration_email,
        name: row.registration_name,
        status: row.registration_status,
        team_id: row.registration_team_id,
        team_name: row.registration_team_name,
        team_members_json: row.registration_team_members_json,
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

app.get('/api/users/tournaments/:id/team-score', requireStorage, authMiddleware, async (req, res) => {
  try {
    const pool = getPool()
    const tournamentId = String(req.params.id || '').trim()
    const context = await buildTournamentTeamScoreContext(pool, tournamentId, req.user, req)
    if (context.status !== 200) {
      logApi('tournament_team_score_context_denied', { ...requestContext(req), tournamentId, status: context.status, reason: context.body?.message || null })
      return res.status(context.status).json(context.body)
    }
    const completedTeamCount = context.body.teams.filter((team) => team.totalScore != null).length
    logApi('tournament_team_score_context_loaded', {
      ...requestContext(req),
      tournamentId: context.body.tournament.id,
      currentTeamKey: context.body.currentTeamKey,
      teamCount: context.body.teams.length,
      completedTeamCount,
      leaderboardMode: 'clickable_team_round_summary',
      consolidatedTeamView: false,
    })
    return res.json(context.body)
  } catch (error) {
    logRouteError('Tournament team score context load error', req, error, { tournamentId: req.params.id })
    return res.status(500).json({ message: 'Could not load tournament team scores' })
  }
})

app.patch('/api/users/tournaments/:id/team-score', requireStorage, authMiddleware, async (req, res) => {
  try {
    const pool = getPool()
    const tournamentId = String(req.params.id || '').trim()
    const context = await buildTournamentTeamScoreContext(pool, tournamentId, req.user, req)
    if (context.status !== 200) {
      logApi('tournament_team_score_update_denied', { ...requestContext(req), tournamentId, status: context.status, reason: context.body?.message || null })
      return res.status(context.status).json(context.body)
    }
    if (['cancelled', 'completed'].includes(String(context.body.tournament.status || '').toLowerCase())) {
      logApi('tournament_team_score_update_locked', { ...requestContext(req), tournamentId: context.body.tournament.id, tournamentStatus: context.body.tournament.status })
      return res.status(409).json({ message: 'Tournament scoring is locked because this tournament is closed.' })
    }

    const currentTeam = context.body.teams.find((team) => team.teamKey === context.body.currentTeamKey)
    if (!currentTeam) return res.status(403).json({ message: 'Your registered tournament team could not be resolved.' })

    const holes = normalizeHoleScorePayload(req.body?.holes)
    if (!holes) return res.status(400).json({ message: 'Tournament team score requires a hole-by-hole scorecard.' })
    const providedHoles = holes.filter((hole) => hole?.scoreProvided === true)
    const totalScore = providedHoles.length ? calculateProvidedHoleScoreTotal(holes) : null
    const teeColor = normalizeTeeColor(req.body?.teeColor || holes.find((hole) => hole?.teeColor)?.teeColor || DEFAULT_TEE_COLOR)
    const holesJson = JSON.stringify(holes.map((hole) => ({ ...hole, teeColor, teeBoxType: teeColor })))

    logApi('tournament_team_score_update_started', {
      ...requestContext(req),
      tournamentId: context.body.tournament.id,
      teamKey: currentTeam.teamKey,
      teamId: currentTeam.teamId || null,
      teamName: currentTeam.teamName,
      providedHoleCount: providedHoles.length,
      totalScore,
      teeColor,
    })

    await pool.execute(
      `INSERT INTO tournament_team_scores
        (id, tournament_id, team_key, team_id, team_name, total_score, holes_json, tee_color, updated_by_auth_user_id, correlation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         team_id = VALUES(team_id),
         team_name = VALUES(team_name),
         total_score = VALUES(total_score),
         holes_json = VALUES(holes_json),
         tee_color = VALUES(tee_color),
         updated_by_auth_user_id = VALUES(updated_by_auth_user_id),
         correlation_id = VALUES(correlation_id),
         updated_at = CURRENT_TIMESTAMP`,
      [
        uuidv4(),
        context.body.tournament.id,
        currentTeam.teamKey,
        currentTeam.teamId || null,
        currentTeam.teamName,
        totalScore,
        holesJson,
        teeColor,
        req.user.id,
        req.correlationId || null,
      ],
    )

    const refreshed = await buildTournamentTeamScoreContext(pool, context.body.tournament.id, req.user, req)
    if (refreshed.status !== 200) return res.status(refreshed.status).json(refreshed.body)
    logApi('tournament_team_score_update_succeeded', {
      ...requestContext(req),
      tournamentId: context.body.tournament.id,
      teamKey: currentTeam.teamKey,
      teamId: currentTeam.teamId || null,
      providedHoleCount: providedHoles.length,
      totalScore,
      teeColor,
      leaderboardTeamCount: refreshed.body.teams.length,
    })
    return res.json(refreshed.body)
  } catch (error) {
    logRouteError('Tournament team score update error', req, error, { tournamentId: req.params.id })
    return res.status(500).json({ message: 'Could not update tournament team score' })
  }
})


app.get('/api/feature-flags', requireStorage, async (req, res) => {
  try {
    const pool = getPool()
    const flags = await getFeatureFlags(pool)
    logApi('feature_flags_loaded', { ...requestContext(req), flags })
    res.json({ flags, definitions: featureFlagDefinitionsForApi() })
  } catch (error) {
    logRouteError('Feature flags load error', req, error)
    res.status(500).json({ message: 'Could not load feature flags' })
  }
})

app.get('/api/profile', requireStorage, authMiddleware, async (req, res) => {
  try {
    const pool = getPool()
    const [row, featureFlags, summary] = await Promise.all([
      ensureAppUserProfileRow(req.user),
      getFeatureFlags(pool),
      loadProfileSummary(pool, req.user),
    ])
    logApi('profile_fetch_completed', { ...requestContext(req), needsEnrichment: !row?.profile_enriched_at || !row?.phone || !row?.primary_city || !row?.primary_state || !row?.primary_zip_code, hasPhone: Boolean(row?.phone), hasLocation: Boolean(row?.primary_city && row?.primary_state && row?.primary_zip_code), socialPreferencesEnabled: isFeatureEnabled(featureFlags, 'profileSocialPreferences'), roundsGolfed: summary?.roundsGolfed || 0 })
    res.json(mapProfileRow(row, { featureFlags, summary }))
  } catch (error) {
    logRouteError('Profile fetch error', req, error)
    res.status(500).json({ message: 'Could not load profile' })
  }
})

app.put('/api/profile', requireStorage, authMiddleware, async (req, res) => {
  try {
    const pool = getPool()
    const featureFlags = await getFeatureFlags(pool)
    const socialPreferencesEnabled = isFeatureEnabled(featureFlags, 'profileSocialPreferences')
    const profile = sanitizeProfilePayload(req.body || {}, { socialPreferencesEnabled })
    logApi('profile_save_started', { ...requestContext(req), hasPhone: Boolean(profile.phone), hasLocation: Boolean(profile.primaryCity && profile.primaryState && profile.primaryZipCode), socialPreferencesEnabled, profile })
    const existingRow = await ensureAppUserProfileRow(req.user)
    await pool.execute(
      `UPDATE app_users
          SET email = ?,
              name = ?,
              phone = ?,
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
        profile.phone,
        profile.primaryCity,
        profile.primaryState,
        profile.primaryZipCode,
        socialPreferencesEnabled ? profile.alcoholPreference : (existingRow?.alcohol_preference || ''),
        socialPreferencesEnabled ? profile.cannabisPreference : (existingRow?.cannabis_preference || ''),
        socialPreferencesEnabled ? profile.sobrietyPreference : (existingRow?.sobriety_preference || ''),
        req.user.id,
      ],
    )
    const [row, summary] = await Promise.all([
      ensureAppUserProfileRow(req.user),
      loadProfileSummary(pool, req.user),
    ])
    logApi('profile_save_completed', { ...requestContext(req), needsEnrichment: !row?.profile_enriched_at || !row?.phone || !row?.primary_city || !row?.primary_state || !row?.primary_zip_code, hasPhone: Boolean(row?.phone), hasLocation: Boolean(row?.primary_city && row?.primary_state && row?.primary_zip_code), socialPreferencesEnabled, roundsGolfed: summary?.roundsGolfed || 0, profile: mapProfileRow(row, { featureFlags, summary }) })
    res.json(mapProfileRow(row, { featureFlags, summary }))
  } catch (error) {
    if (error instanceof Error && /required|invalid|Select|Sober golf/.test(error.message)) {
      logApi('profile_save_validation_failed', { ...requestContext(req), validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Profile save error', req, error)
    res.status(500).json({ message: 'Could not save profile' })
  }
})



function userIsMemberOfTeam(team, user) {
  const requesterEmail = normalizeEmail(user?.email)
  return Boolean(team && requesterEmail && (team.members || []).some((member) => normalizeEmail(member.email) === requesterEmail))
}

function firstTeamMemberEmail(team) {
  const member = (team?.members || []).find((item) => normalizeEmail(item.email))
  return normalizeEmail(member?.email)
}

function teamMemberEmailSet(team) {
  return new Set((team?.members || []).map((member) => normalizeEmail(member.email)).filter(Boolean))
}

function teamChallengeOverlappingMembers(proposerTeam, challengedTeam) {
  const proposerEmails = teamMemberEmailSet(proposerTeam)
  return (challengedTeam?.members || [])
    .map((member) => normalizeEmail(member.email))
    .filter((email) => email && proposerEmails.has(email))
}

function userTeamChallengeSide(message, userTeamIds) {
  if (userTeamIds.has(String(message?.proposerTeamId || ''))) return 'proposer'
  if (userTeamIds.has(String(message?.challengedTeamId || ''))) return 'challenged'
  return null
}

function parseTeamChallengeScoreValue(value) {
  if (value === null || value === undefined || value === '') return null
  const score = Number(value)
  return Number.isFinite(score) ? Math.trunc(score) : null
}

function hasTeamChallengeScoreRecord(message) {
  return parseTeamChallengeScoreValue(message?.proposerTeamScore) !== null ||
    parseTeamChallengeScoreValue(message?.challengedTeamScore) !== null ||
    (Array.isArray(message?.proposerTeamHoles) && message.proposerTeamHoles.length > 0) ||
    (Array.isArray(message?.challengedTeamHoles) && message.challengedTeamHoles.length > 0)
}

function teamChallengeRecordDate(message) {
  if (message?.challengeDate) return String(message.challengeDate).slice(0, 10)
  const createdAt = message?.createdAt ? new Date(message.createdAt) : null
  return createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
}

function selectLatestTeamChallengeMessage(existing, candidate) {
  if (!existing) return candidate
  const existingTime = existing.createdAt ? new Date(existing.createdAt).getTime() : 0
  const candidateTime = candidate.createdAt ? new Date(candidate.createdAt).getTime() : 0
  return candidateTime >= existingTime ? candidate : existing
}

function buildTeamChallengeScoreRecordsForUser(messages, userTeamIds) {
  const byThread = new Map()
  for (const message of messages || []) {
    if (message?.messageType !== 'challenge_request') continue
    const threadId = String(message.threadId || message.id || '').trim()
    if (!threadId) continue
    byThread.set(threadId, selectLatestTeamChallengeMessage(byThread.get(threadId), message))
  }

  return Array.from(byThread.entries()).flatMap(([threadId, message]) => {
    if (!hasTeamChallengeScoreRecord(message)) return []
    const side = userTeamChallengeSide(message, userTeamIds)
    if (!side) return []

    const teamIsProposer = side === 'proposer'
    const teamTotal = parseTeamChallengeScoreValue(teamIsProposer ? message.proposerTeamScore : message.challengedTeamScore)
    const opponentTotal = parseTeamChallengeScoreValue(teamIsProposer ? message.challengedTeamScore : message.proposerTeamScore)
    const won = teamTotal === null || opponentTotal === null ? null : (teamTotal < opponentTotal ? true : (teamTotal > opponentTotal ? false : null))

    return [{
      id: `team-challenge-${threadId}`,
      source: 'team_challenge',
      sourceMessageId: message.id,
      challengeScoringType: message.challengeScoringType || 'stroke_play',
      challengePointsPerHole: message.challengePointsPerHole ?? null,
      mode: 'team',
      date: teamChallengeRecordDate(message),
      state: message.challengeState || '',
      course: message.challengeCourse || 'Team Challenge',
      teeColor: normalizeTeeColor(message.challengeTeeColor || DEFAULT_TEE_COLOR),
      team: teamIsProposer ? message.proposerTeamName : message.challengedTeamName,
      opponentTeam: teamIsProposer ? message.challengedTeamName : message.proposerTeamName,
      teamTotal,
      opponentTotal,
      won,
      holes: teamIsProposer ? (message.proposerTeamHoles || null) : (message.challengedTeamHoles || null),
      opponentHoles: teamIsProposer ? (message.challengedTeamHoles || null) : (message.proposerTeamHoles || null),
      challengeStatus: message.challengeStatus || null,
      createdByUserId: message.senderUserId || null,
      createdByEmail: message.senderEmail || null,
      createdAt: message.createdAt || null,
    }]
  })
}

async function resolveUserTeamIds(user) {
  const requesterEmail = normalizeEmail(user?.email)
  if (!requesterEmail) return new Set()
  const teams = await storage.listTeams()
  return new Set(teams.filter((team) => (team.members || []).some((member) => normalizeEmail(member.email) === requesterEmail)).map((team) => String(team.id)))
}

async function resolveTeamMemberRecipient(team) {
  const email = firstTeamMemberEmail(team)
  if (!email) throw new Error('Team must have at least one member with an email.')
  return await storage.findUserByEmail(email) || { id: null, email, name: team?.name || email }
}

async function resolveTeamChallengeForNewMessage(req, payload) {
  const proposerTeam = await storage.getTeamById(payload.proposerTeamId)
  if (!proposerTeam) {
    logApi('team_challenge_proposer_team_not_found', { ...requestContext(req), proposerTeamId: payload.proposerTeamId })
    return { status: 404, body: { message: 'Selected team does not exist.', proposerTeamId: payload.proposerTeamId } }
  }
  if (!userIsMemberOfTeam(proposerTeam, req.user)) {
    logApi('team_challenge_proposer_not_member', { ...requestContext(req), proposerTeamId: proposerTeam.id, proposerTeamName: proposerTeam.name })
    return { status: 403, body: { message: 'You must be a member of the proposing team.' } }
  }

  const challengedTeam = await storage.getTeamByIdentifier(payload.challengedTeamIdentifier)
  if (!challengedTeam) {
    logApi('team_challenge_team_not_found', { ...requestContext(req), challengedTeamIdentifier: payload.challengedTeamIdentifier, proposerTeamId: proposerTeam.id })
    return { status: 404, body: { message: 'GolfHomiez Team ID does not exist.', teamNotFound: true, challengedTeamIdentifier: payload.challengedTeamIdentifier } }
  }
  if (String(challengedTeam.id) === String(proposerTeam.id)) {
    logApi('team_challenge_same_team_rejected', { ...requestContext(req), proposerTeamId: proposerTeam.id, challengedTeamId: challengedTeam.id })
    return { status: 400, body: { message: 'Choose a different team to challenge.' } }
  }

  const overlappingMemberEmails = teamChallengeOverlappingMembers(proposerTeam, challengedTeam)
  if (overlappingMemberEmails.length > 0) {
    logApi('team_challenge_overlapping_members_rejected', { ...requestContext(req), proposerTeamId: proposerTeam.id, challengedTeamId: challengedTeam.id, overlappingMemberCount: overlappingMemberEmails.length })
    return { status: 400, body: { message: 'A Team Challenge cannot be created when any member belongs to both teams involved.' } }
  }

  const recipient = await resolveTeamMemberRecipient(challengedTeam)
  return {
    status: 200,
    recipient,
    teamContext: {
      proposerTeamId: proposerTeam.id,
      proposerTeamName: proposerTeam.name,
      challengedTeamId: challengedTeam.id,
      challengedTeamName: challengedTeam.name,
      challengedTeamIdentifier: challengedTeam.teamIdentifier,
      challengeStatus: 'proposed',
      challengeDate: payload.challengeDate,
      challengeState: payload.challengeState,
      challengeCourse: payload.challengeCourse,
      challengeTeeColor: normalizeTeeColor(payload.challengeTeeColor || DEFAULT_TEE_COLOR),
      challengeScoringType: payload.challengeScoringType || 'stroke_play',
      challengePointsPerHole: payload.challengePointsPerHole ?? null,
    },
  }
}

async function resolveTeamChallengeForReply(req, parentMessage) {
  const proposerTeam = parentMessage?.proposerTeamId ? await storage.getTeamById(parentMessage.proposerTeamId) : null
  const challengedTeam = parentMessage?.challengedTeamId ? await storage.getTeamById(parentMessage.challengedTeamId) : null
  const userOnProposerTeam = userIsMemberOfTeam(proposerTeam, req.user)
  const userOnChallengedTeam = userIsMemberOfTeam(challengedTeam, req.user)
  if (!userOnProposerTeam && !userOnChallengedTeam) {
    logApi('team_challenge_reply_not_participant', { ...requestContext(req), parentMessageId: parentMessage?.id, proposerTeamId: parentMessage?.proposerTeamId || null, challengedTeamId: parentMessage?.challengedTeamId || null })
    return { status: 403, body: { message: 'Only members of the Team Challenge teams can reply.' } }
  }

  const recipientTeam = userOnProposerTeam ? challengedTeam : proposerTeam
  if (!recipientTeam) return { status: 404, body: { message: 'Team Challenge participant team was not found.' } }
  const recipient = await resolveTeamMemberRecipient(recipientTeam)
  return {
    status: 200,
    recipient,
    teamContext: {
      proposerTeamId: parentMessage.proposerTeamId || null,
      proposerTeamName: parentMessage.proposerTeamName || proposerTeam?.name || null,
      challengedTeamId: parentMessage.challengedTeamId || null,
      challengedTeamName: parentMessage.challengedTeamName || challengedTeam?.name || null,
      challengeStatus: parentMessage.challengeStatus || 'proposed',
      challengeDate: parentMessage.challengeDate || null,
      challengeState: parentMessage.challengeState || null,
      challengeCourse: parentMessage.challengeCourse || null,
      challengeTeeColor: normalizeTeeColor(parentMessage.challengeTeeColor || DEFAULT_TEE_COLOR),
      challengeScoringType: parentMessage.challengeScoringType || 'stroke_play',
      challengePointsPerHole: parentMessage.challengePointsPerHole ?? null,
      proposerTeamScore: parentMessage.proposerTeamScore ?? null,
      challengedTeamScore: parentMessage.challengedTeamScore ?? null,
      proposerTeamHoles: parentMessage.proposerTeamHoles || null,
      challengedTeamHoles: parentMessage.challengedTeamHoles || null,
    },
  }
}

function individualChallengeParticipantMatchesUser(participant, user) {
  const participantEmail = normalizeEmail(participant?.email)
  const userEmail = normalizeEmail(user?.email)
  return Boolean((participant?.userId && String(participant.userId) === String(user?.id || '')) || (participantEmail && participantEmail === userEmail))
}

function individualChallengeParticipantForUser(message, user) {
  return (message?.individualChallengeParticipants || []).find((participant) => individualChallengeParticipantMatchesUser(participant, user)) || null
}

function inboxChallengeMessageType(message) {
  return message?.messageType === 'challenge_request' || message?.messageType === 'individual_challenge'
}

function inboxMessageCreatedByUser(message, user) {
  const userEmail = normalizeEmail(user?.email)
  return String(message?.senderUserId || '') === String(user?.id || '') || (userEmail && normalizeEmail(message?.senderEmail) === userEmail)
}

function sortInboxMessagesByCreatedAt(messages = []) {
  return [...messages].sort((a, b) => String(a?.createdAt || '').localeCompare(String(b?.createdAt || '')) || String(a?.id || '').localeCompare(String(b?.id || '')))
}

async function resolveChallengeCompletionForUser(messageId, user) {
  const [receivedMessages, sentMessages] = await Promise.all([
    storage.listInboxMessagesForUser(user),
    storage.listSentInboxMessagesForUser(user),
  ])
  const byId = new Map()
  for (const message of [...(receivedMessages || []), ...(sentMessages || [])]) {
    if (message?.id) byId.set(String(message.id), message)
  }
  const selected = byId.get(String(messageId || '')) || null
  if (!selected || !inboxChallengeMessageType(selected)) return { status: 404, body: { message: 'Challenge not found' } }
  const threadId = String(selected.threadId || selected.id)
  const threadMessages = Array.from(byId.values()).filter((message) => inboxChallengeMessageType(message) && String(message.threadId || message.id) === threadId)
  const initialMessage = sortInboxMessagesByCreatedAt(threadMessages).find((message) => !message.parentMessageId) || sortInboxMessagesByCreatedAt(threadMessages)[0] || selected
  if (!inboxMessageCreatedByUser(initialMessage, user)) {
    return { status: 403, body: { message: 'Only the golfer who created the challenge can complete it.' } }
  }
  if (String(initialMessage.challengeStatus || '').toLowerCase() === 'completed') {
    return { status: 409, body: { message: 'Challenge is already completed.' } }
  }
  return { status: 200, message: initialMessage }
}

function buildIndividualChallengeParticipants(sender, users) {
  const byEmail = new Map()
  const addUser = (record) => {
    const email = normalizeEmail(record?.email)
    if (!email || byEmail.has(email)) return
    byEmail.set(email, {
      userId: record?.id || null,
      email,
      name: record?.name || null,
      score: null,
      holes: [],
    })
  }
  addUser(sender)
  users.forEach(addUser)
  return Array.from(byEmail.values())
}

async function resolveIndividualChallengeForNewMessage(req, payload) {
  const resolvedUsers = []
  for (const email of payload.individualParticipantEmails || []) {
    const user = await storage.findUserByEmail(email)
    if (!user) {
      logApi('individual_challenge_recipient_not_found', { ...requestContext(req), recipientEmail: email, inviteRequired: true })
      return { status: 404, body: { message: 'Recipient does not exist in Golf Homiez. Send them an invite to join.', recipientEmail: email, inviteRequired: true } }
    }
    resolvedUsers.push(user)
  }
  const participants = buildIndividualChallengeParticipants(req.user, resolvedUsers)
  if (participants.length > 25) {
    logApi('individual_challenge_too_many_golfers', { ...requestContext(req), participantCount: participants.length })
    return { status: 400, body: { message: 'Individual Challenge supports up to 25 golfers.' } }
  }
  const recipient = resolvedUsers.find((item) => normalizeEmail(item.email) !== normalizeEmail(req.user?.email)) || resolvedUsers[0] || req.user
  return {
    status: 200,
    recipient,
    teamContext: {
      challengeStatus: 'proposed',
      challengeDate: payload.challengeDate,
      challengeState: payload.challengeState,
      challengeCourse: payload.challengeCourse,
      challengeTeeColor: normalizeTeeColor(payload.challengeTeeColor || DEFAULT_TEE_COLOR),
      individualChallengeParticipants: participants,
    },
  }
}


async function createOrUpdateIndividualChallengeSoloScore(message, user, score, holes, participant = null) {
  const normalizedHoles = Array.isArray(holes) && holes.length ? holes : null
  const existingSoloScoreId = String(participant?.soloScoreId || '').trim()

  if (score == null) {
    if (existingSoloScoreId) {
      const existingScore = await storage.getScoreById(existingSoloScoreId)
      const ownsExistingScore = existingScore && (
        String(existingScore.createdByUserId || '') === String(user?.id || '') ||
        normalizeEmail(existingScore.createdByEmail) === normalizeEmail(user?.email)
      )
      if (ownsExistingScore && storage.deleteScoreById) {
        await storage.deleteScoreById(existingSoloScoreId)
      }
      logApi('individual_challenge_solo_score_cleared', {
        userId: user?.id || null,
        userEmail: normalizeEmail(user?.email),
        messageId: message?.id || null,
        threadId: message?.threadId || message?.id || null,
        scoreId: existingSoloScoreId,
        deletedScore: Boolean(ownsExistingScore && storage.deleteScoreById),
      })
    }
    return null
  }

  const scoreState = String(message?.challengeState || '').trim().toUpperCase()
  const scoreCourse = String(message?.challengeCourse || '').trim() || 'Individual Challenge'
  const courseMetadata = resolveScoreCourseMetadata(scoreState, { name: scoreCourse })
  const scoreEntry = {
    mode: 'solo',
    date: teamChallengeRecordDate(message),
    state: scoreState,
    course: scoreCourse,
    roundScore: score,
    holes: normalizedHoles,
    ...courseMetadata,
    createdByUserId: user?.id || participant?.userId || null,
    createdByEmail: normalizeEmail(user?.email || participant?.email),
    source: 'individual_challenge',
    sourceMessageId: message?.threadId || message?.id || null,
  }

  if (existingSoloScoreId) {
    const existingScore = await storage.getScoreById(existingSoloScoreId)
    const ownsExistingScore = existingScore && (
      String(existingScore.createdByUserId || '') === String(user?.id || '') ||
      normalizeEmail(existingScore.createdByEmail) === normalizeEmail(user?.email)
    )
    if (ownsExistingScore) {
      const updatedScore = await storage.updateScoreById(existingSoloScoreId, { ...existingScore, ...scoreEntry })
      logApi('individual_challenge_solo_score_updated', {
        userId: user?.id || null,
        userEmail: normalizeEmail(user?.email),
        messageId: message?.id || null,
        threadId: message?.threadId || message?.id || null,
        scoreId: updatedScore?.id || existingSoloScoreId,
        roundScore: score,
        holeCount: normalizedHoles?.length || 0,
      })
      return updatedScore || { id: existingSoloScoreId }
    }
  }

  const createdScore = await storage.createScore(scoreEntry)
  logApi('individual_challenge_solo_score_created', {
    userId: user?.id || null,
    userEmail: normalizeEmail(user?.email),
    messageId: message?.id || null,
    threadId: message?.threadId || message?.id || null,
    scoreId: createdScore?.id || null,
    roundScore: score,
    holeCount: normalizedHoles?.length || 0,
  })
  return createdScore
}

async function resolveIndividualChallengeForReply(req, parentMessage) {
  const participant = individualChallengeParticipantForUser(parentMessage, req.user)
  if (!participant) {
    logApi('individual_challenge_reply_not_participant', { ...requestContext(req), parentMessageId: parentMessage?.id })
    return { status: 403, body: { message: 'Only golfers in the Individual Challenge can reply.' } }
  }
  const otherParticipant = (parentMessage.individualChallengeParticipants || []).find((item) => !individualChallengeParticipantMatchesUser(item, req.user)) || participant
  const recipient = await storage.findUserByEmail(otherParticipant.email) || { id: otherParticipant.userId || null, email: otherParticipant.email, name: otherParticipant.name || otherParticipant.email }
  return {
    status: 200,
    recipient,
    teamContext: {
      challengeStatus: parentMessage.challengeStatus || 'proposed',
      challengeDate: parentMessage.challengeDate || null,
      challengeState: parentMessage.challengeState || null,
      challengeCourse: parentMessage.challengeCourse || null,
      challengeTeeColor: normalizeTeeColor(parentMessage.challengeTeeColor || DEFAULT_TEE_COLOR),
      individualChallengeParticipants: parentMessage.individualChallengeParticipants || [],
    },
  }
}

app.get('/api/inbox/summary', requireStorage, authMiddleware, async (req, res) => {
  try {
    const summary = await storage.getInboxSummaryForUser(req.user)
    logApi('inbox_summary_loaded', { ...requestContext(req), unreadCount: summary.unreadCount })
    res.json(summary)
  } catch (error) {
    logRouteError('Inbox summary error', req, error)
    res.status(500).json({ message: 'Could not load inbox summary' })
  }
})

app.get('/api/inbox/messages', requireStorage, authMiddleware, async (req, res) => {
  try {
    const messages = await storage.listInboxMessagesForUser(req.user)
    const unreadCount = messages.filter((message) => message.messageType === 'message' && !message.readAt).length
    logApi('inbox_messages_loaded', { ...requestContext(req), messageCount: messages.length, unreadCount })
    res.json({ messages, unreadCount })
  } catch (error) {
    logRouteError('Inbox messages load error', req, error)
    res.status(500).json({ message: 'Could not load inbox messages' })
  }
})

app.get('/api/inbox/sent', requireStorage, authMiddleware, async (req, res) => {
  try {
    const messages = await storage.listSentInboxMessagesForUser(req.user)
    const sentMessages = messages.filter((message) => message.messageType === 'message')
    const sentChallenges = messages.filter((message) => message.messageType === 'challenge_request' || message.messageType === 'individual_challenge')
    logApi('inbox_sent_messages_loaded', {
      ...requestContext(req),
      sentCount: messages.length,
      sentMessageCount: sentMessages.length,
      sentChallengeCount: sentChallenges.length,
    })
    res.json({ messages, sentMessages, sentChallenges })
  } catch (error) {
    logRouteError('Sent inbox messages load error', req, error)
    res.status(500).json({ message: 'Could not load sent inbox messages' })
  }
})

app.get('/api/inbox/team-challenge-scores', requireStorage, authMiddleware, async (req, res) => {
  try {
    const [receivedMessages, sentMessages] = await Promise.all([
      storage.listInboxMessagesForUser(req.user),
      storage.listSentInboxMessagesForUser(req.user),
    ])
    const userTeamIds = await resolveUserTeamIds(req.user)
    const scores = buildTeamChallengeScoreRecordsForUser([...receivedMessages, ...sentMessages], userTeamIds)
    logApi('team_challenge_score_records_loaded', {
      ...requestContext(req),
      teamChallengeScoreCount: scores.length,
      participatingTeamCount: userTeamIds.size,
    })
    res.json({ scores })
  } catch (error) {
    logRouteError('Team Challenge score records load error', req, error)
    res.status(500).json({ message: 'Could not load Team Challenge score records' })
  }
})

app.post('/api/inbox/messages', requireStorage, authMiddleware, async (req, res) => {
  try {
    const payload = normalizeInboxMessagePayload(req.body || {})
    let recipientEmail = payload.recipientEmail
    let recipient = null
    let parentMessage = null
    let threadId = null
    let parentMessageId = null
    let messageType = payload.messageType
    let teamContext = null

    logApi('inbox_message_send_started', {
      ...requestContext(req),
      recipientEmail,
      challengedTeamIdentifier: payload.challengedTeamIdentifier || null,
      proposerTeamId: payload.proposerTeamId || null,
      challengeDate: payload.challengeDate || null,
      challengeState: payload.challengeState || null,
      challengeCourse: payload.challengeCourse || null,
      challengeTeeColor: payload.challengeTeeColor || DEFAULT_TEE_COLOR,
      challengeScoringType: payload.challengeScoringType || 'stroke_play',
      challengePointsPerHole: payload.challengePointsPerHole ?? null,
      messageType: payload.messageType,
      replyToMessageId: payload.replyToMessageId,
      bodyLength: payload.body.length,
    })

    if (payload.replyToMessageId) {
      parentMessage = await storage.getInboxMessageForParticipant(payload.replyToMessageId, req.user)
      if (!parentMessage) {
        logApi('inbox_reply_thread_not_found', { ...requestContext(req), replyToMessageId: payload.replyToMessageId })
        return res.status(404).json({ message: 'Message thread not found.' })
      }

      threadId = parentMessage.threadId || parentMessage.id
      parentMessageId = parentMessage.id
      messageType = parentMessage.messageType === 'challenge_request' ? 'challenge_request' : (parentMessage.messageType === 'individual_challenge' ? 'individual_challenge' : 'message')

      if (messageType === 'challenge_request') {
        const resolvedChallenge = await resolveTeamChallengeForReply(req, parentMessage)
        if (resolvedChallenge.status !== 200) return res.status(resolvedChallenge.status).json(resolvedChallenge.body)
        recipient = resolvedChallenge.recipient
        recipientEmail = normalizeEmail(recipient.email)
        teamContext = resolvedChallenge.teamContext
        logApi('team_challenge_reply_recipient_resolved', {
          ...requestContext(req),
          replyToMessageId: payload.replyToMessageId,
          threadId,
          parentMessageId,
          recipientEmail,
          proposerTeamId: teamContext?.proposerTeamId || null,
          challengedTeamId: teamContext?.challengedTeamId || null,
          challengeScoringType: teamContext?.challengeScoringType || 'stroke_play',
          challengePointsPerHole: teamContext?.challengePointsPerHole ?? null,
        })
      } else if (messageType === 'individual_challenge') {
        const resolvedChallenge = await resolveIndividualChallengeForReply(req, parentMessage)
        if (resolvedChallenge.status !== 200) return res.status(resolvedChallenge.status).json(resolvedChallenge.body)
        recipient = resolvedChallenge.recipient
        recipientEmail = normalizeEmail(recipient.email)
        teamContext = resolvedChallenge.teamContext
        logApi('individual_challenge_reply_recipient_resolved', {
          ...requestContext(req),
          replyToMessageId: payload.replyToMessageId,
          threadId,
          parentMessageId,
          recipientEmail,
          participantCount: teamContext?.individualChallengeParticipants?.length || 0,
        })
      } else {
        const currentUserEmail = normalizeEmail(req.user?.email)
        const currentUserIsSender = String(parentMessage.senderUserId || '') === String(req.user?.id || '') || normalizeEmail(parentMessage.senderEmail) === currentUserEmail
        recipientEmail = currentUserIsSender ? parentMessage.recipientEmail : parentMessage.senderEmail
        logApi('inbox_reply_recipient_resolved', {
          ...requestContext(req),
          replyToMessageId: payload.replyToMessageId,
          threadId,
          parentMessageId,
          recipientEmail,
        })
      }
    } else if (payload.messageType === 'challenge_request') {
      const resolvedChallenge = await resolveTeamChallengeForNewMessage(req, payload)
      if (resolvedChallenge.status !== 200) return res.status(resolvedChallenge.status).json(resolvedChallenge.body)
      recipient = resolvedChallenge.recipient
      recipientEmail = normalizeEmail(recipient.email)
      teamContext = resolvedChallenge.teamContext
      logApi('team_challenge_recipient_resolved', {
        ...requestContext(req),
        proposerTeamId: teamContext?.proposerTeamId || null,
        proposerTeamName: teamContext?.proposerTeamName || null,
        challengedTeamId: teamContext?.challengedTeamId || null,
        challengedTeamName: teamContext?.challengedTeamName || null,
        challengedTeamIdentifier: teamContext?.challengedTeamIdentifier || null,
        challengeDate: teamContext?.challengeDate || null,
        challengeState: teamContext?.challengeState || null,
        challengeCourse: teamContext?.challengeCourse || null,
        challengeTeeColor: teamContext?.challengeTeeColor || DEFAULT_TEE_COLOR,
        challengeScoringType: teamContext?.challengeScoringType || 'stroke_play',
        challengePointsPerHole: teamContext?.challengePointsPerHole ?? null,
        recipientEmail,
      })
    } else if (payload.messageType === 'individual_challenge') {
      const resolvedChallenge = await resolveIndividualChallengeForNewMessage(req, payload)
      if (resolvedChallenge.status !== 200) return res.status(resolvedChallenge.status).json(resolvedChallenge.body)
      recipient = resolvedChallenge.recipient
      recipientEmail = normalizeEmail(recipient.email)
      teamContext = resolvedChallenge.teamContext
      logApi('individual_challenge_recipient_resolved', {
        ...requestContext(req),
        participantCount: teamContext?.individualChallengeParticipants?.length || 0,
        participantEmails: (teamContext?.individualChallengeParticipants || []).map((participant) => participant.email),
        challengeDate: teamContext?.challengeDate || null,
        challengeState: teamContext?.challengeState || null,
        challengeCourse: teamContext?.challengeCourse || null,
        challengeTeeColor: teamContext?.challengeTeeColor || DEFAULT_TEE_COLOR,
        challengeScoringType: teamContext?.challengeScoringType || 'stroke_play',
        challengePointsPerHole: teamContext?.challengePointsPerHole ?? null,
        recipientEmail,
      })
    }

    if (!recipient) {
      recipient = await storage.findUserByEmail(recipientEmail)
      if (!recipient) {
        logApi('inbox_message_recipient_not_found', { ...requestContext(req), recipientEmail, inviteRequired: true, replyToMessageId: payload.replyToMessageId })
        return res.status(404).json({
          message: 'Recipient does not exist in Golf Homiez. Send them an invite to join.',
          recipientEmail,
          inviteRequired: true,
        })
      }
    }

    const message = await storage.createInboxMessage({
      sender: req.user,
      recipient,
      messageType,
      body: payload.body,
      threadId,
      parentMessageId,
      teamContext,
    })
    logApi(messageType === 'challenge_request' ? 'team_challenge_message_sent' : (messageType === 'individual_challenge' ? 'individual_challenge_message_sent' : 'inbox_message_sent'), {
      ...requestContext(req),
      messageId: message?.id || null,
      recipientEmail: recipient.email,
      recipientUserId: recipient.id,
      messageType,
      threadId: message?.threadId || threadId || null,
      parentMessageId,
      replyToMessageId: payload.replyToMessageId,
      proposerTeamId: message?.proposerTeamId || teamContext?.proposerTeamId || null,
      challengedTeamId: message?.challengedTeamId || teamContext?.challengedTeamId || null,
      challengeStatus: message?.challengeStatus || teamContext?.challengeStatus || null,
      challengeDate: message?.challengeDate || teamContext?.challengeDate || null,
      challengeState: message?.challengeState || teamContext?.challengeState || null,
      challengeCourse: message?.challengeCourse || teamContext?.challengeCourse || null,
      challengeScoringType: message?.challengeScoringType || teamContext?.challengeScoringType || 'stroke_play',
      challengePointsPerHole: message?.challengePointsPerHole ?? teamContext?.challengePointsPerHole ?? null,
      individualParticipantCount: message?.individualChallengeParticipants?.length || teamContext?.individualChallengeParticipants?.length || 0,
    })
    res.status(201).json({ ok: true, message, notice: messageType === 'challenge_request' ? 'Your Team Challenge was sent successfully.' : (messageType === 'individual_challenge' ? 'Your Individual Challenge was sent successfully.' : 'Your message was sent successfully.') })
  } catch (error) {
    if (error instanceof Error && /valid recipient email|required|characters or less|thread reference|team|selected|date|state|course|invalid|Individual Challenge|participant|golfers/i.test(error.message)) {
      logApi('inbox_message_validation_failed', { ...requestContext(req), validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Inbox message send error', req, error)
    res.status(500).json({ message: 'Could not send inbox message' })
  }
})


app.patch('/api/inbox/messages/:id/complete', requireStorage, authMiddleware, async (req, res) => {
  try {
    const completion = await resolveChallengeCompletionForUser(req.params.id, req.user)
    if (completion.status !== 200) {
      logApi('challenge_complete_denied', { ...requestContext(req), messageId: req.params.id, status: completion.status, reason: completion.body?.message || null })
      return res.status(completion.status).json(completion.body)
    }
    const message = await storage.updateInboxChallengeStatus(completion.message.id, req.user, 'completed')
    if (!message) {
      logApi('challenge_complete_not_found', { ...requestContext(req), messageId: completion.message.id, threadId: completion.message.threadId || completion.message.id })
      return res.status(404).json({ message: 'Challenge not found' })
    }
    logApi('challenge_completed', {
      ...requestContext(req),
      messageId: message.id,
      threadId: message.threadId || null,
      messageType: message.messageType,
      challengeStatus: message.challengeStatus || 'completed',
      createdByUserId: completion.message.senderUserId || null,
      createdByEmail: completion.message.senderEmail || null,
    })
    res.json(message)
  } catch (error) {
    logRouteError('Challenge complete error', req, error)
    res.status(500).json({ message: 'Could not complete challenge' })
  }
})

app.patch('/api/inbox/messages/:id/deleted', requireStorage, authMiddleware, async (req, res) => {
  try {
    const deleted = req.body?.deleted === true
    const message = await storage.setInboxChallengeDeleted(req.params.id, req.user, deleted)
    if (!message) {
      logApi('inbox_challenge_user_delete_not_found', { ...requestContext(req), messageId: req.params.id, deleted })
      return res.status(404).json({ message: 'Challenge not found' })
    }
    logApi(deleted ? 'inbox_challenge_user_deleted' : 'inbox_challenge_user_restored', { ...requestContext(req), messageId: message.id, threadId: message.threadId || message.id, challengeDeletedAt: message.challengeDeletedAt || null })
    res.json(message)
  } catch (error) {
    logRouteError('Challenge user delete state error', req, error)
    res.status(500).json({ message: 'Could not update challenge visibility' })
  }
})

app.patch('/api/inbox/messages/:id/challenge-status', requireStorage, authMiddleware, async (req, res) => {
  try {
    const status = normalizeChallengeStatus(req.body?.status)
    if (status === 'completed') {
      logApi('team_challenge_status_completed_rejected', { ...requestContext(req), messageId: req.params.id })
      return res.status(400).json({ message: 'Use the complete challenge action to complete a challenge.' })
    }
    const message = await storage.updateInboxChallengeStatus(req.params.id, req.user, status)
    if (!message) {
      logApi('team_challenge_status_not_found', { ...requestContext(req), messageId: req.params.id, requestedStatus: status })
      return res.status(404).json({ message: 'Team Challenge not found' })
    }
    logApi('team_challenge_status_updated', {
      ...requestContext(req),
      messageId: message.id,
      threadId: message.threadId || null,
      proposerTeamId: message.proposerTeamId || null,
      challengedTeamId: message.challengedTeamId || null,
      challengeStatus: message.challengeStatus || status,
    })
    res.json(message)
  } catch (error) {
    if (error instanceof Error && /status/i.test(error.message)) {
      logApi('team_challenge_status_validation_failed', { ...requestContext(req), validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Team Challenge status update error', req, error)
    res.status(500).json({ message: 'Could not update Team Challenge' })
  }
})

app.patch('/api/inbox/messages/:id/team-score', requireStorage, authMiddleware, async (req, res) => {
  try {
    const score = normalizeTeamChallengeScore(req.body?.score)
    const holes = normalizeTeamChallengeHoles(req.body?.holes)
    const holeScoreSummary = summarizeProvidedHoleScores(holes)
    const participantMessage = await storage.getInboxMessageForParticipant(req.params.id, req.user)
    if (!participantMessage || participantMessage.messageType !== 'challenge_request') {
      logApi('team_challenge_score_not_found', { ...requestContext(req), messageId: req.params.id })
      return res.status(404).json({ message: 'Team Challenge not found' })
    }
    if (String(participantMessage.challengeStatus || '').toLowerCase() === 'completed') {
      logApi('team_challenge_score_update_locked', { ...requestContext(req), messageId: req.params.id, threadId: participantMessage.threadId || participantMessage.id })
      return res.status(409).json({ message: 'This challenge is complete, so scores are locked.' })
    }
    const userTeamIds = await resolveUserTeamIds(req.user)
    const side = userTeamChallengeSide(participantMessage, userTeamIds)
    if (!side) {
      logApi('team_challenge_score_update_forbidden', { ...requestContext(req), messageId: req.params.id, proposerTeamId: participantMessage.proposerTeamId || null, challengedTeamId: participantMessage.challengedTeamId || null })
      return res.status(403).json({ message: 'Only members of a Team Challenge team can update that team score.' })
    }
    const message = await storage.updateInboxChallengeScore(req.params.id, req.user, side, score, holes)
    if (!message) {
      logApi('team_challenge_score_update_missing', { ...requestContext(req), messageId: req.params.id, side, score })
      return res.status(404).json({ message: 'Team Challenge not found' })
    }
    logApi('team_challenge_score_updated', {
      ...requestContext(req),
      messageId: message.id,
      threadId: message.threadId || null,
      side,
      score,
      holeCount: Array.isArray(holes) ? holes.length : 0,
      providedHoleCount: holeScoreSummary.providedHoleCount,
      enteredStrokeTotal: holeScoreSummary.enteredStrokeTotal,
      proposerTeamId: message.proposerTeamId || null,
      challengedTeamId: message.challengedTeamId || null,
      proposerTeamScore: message.proposerTeamScore ?? null,
      challengedTeamScore: message.challengedTeamScore ?? null,
    })
    res.json(message)
  } catch (error) {
    if (error instanceof Error && /score|number|zero|holes|hole/i.test(error.message)) {
      logApi('team_challenge_score_validation_failed', { ...requestContext(req), validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Team Challenge score update error', req, error)
    res.status(500).json({ message: 'Could not update Team Challenge score' })
  }
})


app.patch('/api/inbox/messages/:id/individual-score', requireStorage, authMiddleware, async (req, res) => {
  try {
    const score = normalizeIndividualChallengeScore(req.body?.score)
    const holes = normalizeTeamChallengeHoles(req.body?.holes)
    const holeScoreSummary = summarizeProvidedHoleScores(holes)
    const participantMessage = await storage.getInboxMessageForParticipant(req.params.id, req.user)
    if (!participantMessage || participantMessage.messageType !== 'individual_challenge') {
      logApi('individual_challenge_score_not_found', { ...requestContext(req), messageId: req.params.id })
      return res.status(404).json({ message: 'Individual Challenge not found' })
    }
    if (String(participantMessage.challengeStatus || '').toLowerCase() === 'completed') {
      logApi('individual_challenge_score_update_locked', { ...requestContext(req), messageId: req.params.id, threadId: participantMessage.threadId || participantMessage.id })
      return res.status(409).json({ message: 'This challenge is complete, so scores are locked.' })
    }
    const participant = individualChallengeParticipantForUser(participantMessage, req.user)
    if (!participant) {
      logApi('individual_challenge_score_update_forbidden', { ...requestContext(req), messageId: req.params.id })
      return res.status(403).json({ message: 'Only golfers in an Individual Challenge can update their own score.' })
    }
    const soloScore = await createOrUpdateIndividualChallengeSoloScore(participantMessage, req.user, score, holes, participant)
    const message = await storage.updateInboxIndividualChallengeScore(req.params.id, req.user, score, holes, { soloScoreId: soloScore?.id || null })
    if (!message) {
      logApi('individual_challenge_score_update_missing', { ...requestContext(req), messageId: req.params.id, score })
      return res.status(404).json({ message: 'Individual Challenge not found' })
    }
    logApi('individual_challenge_score_updated', {
      ...requestContext(req),
      messageId: message.id,
      threadId: message.threadId || null,
      score,
      holeCount: Array.isArray(holes) ? holes.length : 0,
      providedHoleCount: holeScoreSummary.providedHoleCount,
      enteredStrokeTotal: holeScoreSummary.enteredStrokeTotal,
      participantCount: message.individualChallengeParticipants?.length || 0,
      soloScoreId: soloScore?.id || null,
    })
    res.json(message)
  } catch (error) {
    if (error instanceof Error && /score|number|zero|holes|hole/i.test(error.message)) {
      logApi('individual_challenge_score_validation_failed', { ...requestContext(req), validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Individual Challenge score update error', req, error)
    res.status(500).json({ message: 'Could not update Individual Challenge score' })
  }
})

app.patch('/api/inbox/messages/:id/read', requireStorage, authMiddleware, async (req, res) => {
  try {
    const message = await storage.markInboxMessageRead(req.params.id, req.user)
    if (!message) {
      logApi('inbox_message_read_not_found', { ...requestContext(req), messageId: req.params.id })
      return res.status(404).json({ message: 'Inbox message not found' })
    }
    logApi('inbox_message_read', { ...requestContext(req), messageId: message.id, senderEmail: message.senderEmail, messageType: message.messageType, threadId: message.threadId || null })
    res.json(message)
  } catch (error) {
    logRouteError('Inbox message read error', req, error)
    res.status(500).json({ message: 'Could not update inbox message' })
  }
})

app.get('/api/users/lookup', requireStorage, authMiddleware, async (req, res) => {
  try {
    const email = String(req.query.email || '').trim()
    if (!email) return res.status(400).json({ message: 'email query parameter required' })
    const normalized = normalizeEmail(email)
    logApi('team_member_lookup_started', { ...requestContext(req), email: normalized })
    const found = await storage.findUserByEmail(normalized)
    if (!found) {
      logApi('team_member_lookup_not_found', { ...requestContext(req), email: normalized })
      return res.json({ found: false, email: normalized })
    }
    const parts = splitName(found.name, found.email)
    logApi('team_member_lookup_found', { ...requestContext(req), email: found.email, verified: Boolean(found.emailVerified) })
    res.json({ found: true, email: found.email, firstName: parts.firstName, lastName: parts.lastName, name: found.name, verified: Boolean(found.emailVerified) })
  } catch (error) {
    logRouteError('User lookup error', req, error)
    res.status(500).json({ message: 'Could not look up user' })
  }
})

async function hydrateTeamMembersFromDirectory(normalizedMembers, req, actionName) {
  const hydrated = []
  for (const member of normalizedMembers) {
    if (!member.email) {
      hydrated.push(member)
      continue
    }
    const fallbackName = String(member.name || '').replace(/\s+/g, ' ').trim() || normalizeEmail(member.email).split('@')[0]
    const found = await storage.findUserByEmail(member.email)
    if (!found) {
      const status = normalizeTeamMemberStatus(member.status || 'invited', false)
      logApi(`${actionName}_member_directory_miss`, { ...requestContext(req), memberEmail: member.email, status })
      hydrated.push({ ...member, name: fallbackName, status, verified: false })
      continue
    }
    const parts = splitName(found.name, found.email)
    const name = `${parts.firstName} ${parts.lastName}`.replace(/\s+/g, ' ').trim() || fallbackName || normalizeEmail(found.email).split('@')[0]
    const verified = Boolean(found.emailVerified)
    const status = normalizeTeamMemberStatus(verified ? 'active' : 'pending_verification', verified)
    logApi(`${actionName}_member_directory_hydrated`, { ...requestContext(req), memberEmail: found.email, verified, status })
    hydrated.push({ ...member, name, email: normalizeEmail(found.email), verified, status })
  }
  return hydrated
}

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
    const onlyMine = String(req.query.mine || '').toLowerCase() === '1' || String(req.query.mine || '').toLowerCase() === 'true'
    const requesterEmail = normalizeEmail(req.user.email)
    const visibleTeams = onlyMine ? teams.filter((team) => (team.members || []).some((member) => normalizeEmail(member.email) === requesterEmail)) : teams
    logApi('teams_listed', { ...requestContext(req), onlyMine, teamCount: visibleTeams.length })
    res.json(visibleTeams)
  } catch (error) {
    logRouteError('List teams error', req, error)
    res.status(500).json({ message: 'Could not load teams' })
  }
})

app.post('/api/teams', requireStorage, authMiddleware, async (req, res) => {
  try {
    const { name, members } = req.body || {}
    const trimmed = String(name || '').replace(/\s+/g, ' ').trim()
    logApi('team_create_started', { ...requestContext(req), teamName: trimmed, requestedMemberCount: Array.isArray(members) ? members.length : 0 })
    if (!trimmed) {
      logApi('team_create_validation_failed', { ...requestContext(req), reason: 'missing_team_name' })
      return res.status(400).json({ message: 'Team name required' })
    }

    let normalizedMembers = normalizeCreateTeamMembers(members, req.user)
    normalizedMembers = await hydrateTeamMembersFromDirectory(normalizedMembers, req, 'team_create')

    if (!normalizedMembers[0]?.email) {
      logApi('team_create_validation_failed', { ...requestContext(req), teamName: trimmed, reason: 'missing_signed_in_email' })
      return res.status(400).json({ message: 'The signed-in user must have an email to create a team' })
    }
    if (!isValidTeamSize(normalizedMembers.length)) {
      logApi('team_create_validation_failed', { ...requestContext(req), teamName: trimmed, reason: 'invalid_team_size', memberCount: normalizedMembers.length })
      return res.status(400).json({ message: 'Teams can only have 2 to 4 team members.' })
    }

    for (const m of normalizedMembers) {
      if (!m.name) {
        logApi('team_create_validation_failed', { ...requestContext(req), teamName: trimmed, reason: 'missing_member_name', memberEmail: m.email })
        return res.status(400).json({ message: 'Each team member must have a name' })
      }
      if (!m.email) {
        logApi('team_create_validation_failed', { ...requestContext(req), teamName: trimmed, reason: 'missing_member_email', memberName: m.name })
        return res.status(400).json({ message: 'Each team member must have an email' })
      }
      if (!isEmail(m.email)) {
        logApi('team_create_validation_failed', { ...requestContext(req), teamName: trimmed, reason: 'invalid_member_email', memberEmail: m.email })
        return res.status(400).json({ message: `Invalid team member email: ${m.email}` })
      }
    }

    const seen = new Set()
    for (const m of normalizedMembers) {
      if (seen.has(m.email)) {
        logApi('team_create_validation_failed', { ...requestContext(req), teamName: trimmed, reason: 'duplicate_member_email', memberEmail: m.email })
        return res.status(400).json({ message: 'Duplicate team member email in the same team' })
      }
      seen.add(m.email)
    }

    const teams = await storage.listTeams()
    const exists = teams.find((team) => String(team?.name || '').replace(/\s+/g, ' ').trim().toLowerCase() === trimmed.toLowerCase()) || null
    if (exists) {
      const suggestedTeamName = buildSuggestedTeamName(trimmed, teams)
      const message = `Team name already exists`
      logApi('team_create_duplicate_name', { ...requestContext(req), teamName: trimmed, existingTeamId: exists.id, suggestedTeamName })
      return res.status(409).json({ message, suggestedTeamName })
    }

    try {
      const team = await storage.createTeam({ name: trimmed, members: normalizedMembers })
      logApi('team_created', { ...requestContext(req), teamId: team?.id || null, teamIdentifier: team?.teamIdentifier || null, teamName: team?.name || trimmed, memberCount: normalizedMembers.length })
      res.status(201).json(team)
    } catch (error) {
      if (/duplicate|ER_DUP_ENTRY|unique/i.test(String(error?.code || '') + ' ' + String(error?.message || ''))) {
        const latestTeams = await storage.listTeams()
        const suggestedTeamName = buildSuggestedTeamName(trimmed, latestTeams)
        const message = `Team name already exists`
        logApi('team_create_duplicate_name_race', { ...requestContext(req), teamName: trimmed, suggestedTeamName })
        return res.status(409).json({ message, suggestedTeamName })
      }
      throw error
    }
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
    const trimmed = String(name || '').replace(/\s+/g, ' ').trim()
    logApi('team_update_started', { ...requestContext(req), teamId: id, teamName: trimmed, requestedMemberCount: Array.isArray(members) ? members.length : 0 })
    if (!trimmed) {
      logApi('team_update_validation_failed', { ...requestContext(req), teamId: id, reason: 'missing_team_name' })
      return res.status(400).json({ message: 'Team name required' })
    }

    let normalizedMembers = normalizeCreateTeamMembers(members, req.user)
    normalizedMembers = await hydrateTeamMembersFromDirectory(normalizedMembers, req, 'team_update')

    if (!normalizedMembers[0]?.email) {
      logApi('team_update_validation_failed', { ...requestContext(req), teamId: id, teamName: trimmed, reason: 'missing_signed_in_email' })
      return res.status(400).json({ message: 'The signed-in user must have an email to create a team' })
    }
    if (!isValidTeamSize(normalizedMembers.length)) {
      logApi('team_update_validation_failed', { ...requestContext(req), teamId: id, teamName: trimmed, reason: 'invalid_team_size', memberCount: normalizedMembers.length })
      return res.status(400).json({ message: 'Teams can only have 2 to 4 team members.' })
    }

    for (const m of normalizedMembers) {
      if (!m.name) {
        logApi('team_update_validation_failed', { ...requestContext(req), teamId: id, teamName: trimmed, reason: 'missing_member_name', memberEmail: m.email })
        return res.status(400).json({ message: 'Each team member must have a name' })
      }
      if (!m.email) {
        logApi('team_update_validation_failed', { ...requestContext(req), teamId: id, teamName: trimmed, reason: 'missing_member_email', memberName: m.name })
        return res.status(400).json({ message: 'Each team member must have an email' })
      }
      if (!isEmail(m.email)) {
        logApi('team_update_validation_failed', { ...requestContext(req), teamId: id, teamName: trimmed, reason: 'invalid_member_email', memberEmail: m.email })
        return res.status(400).json({ message: `Invalid team member email: ${m.email}` })
      }
    }

    const seen = new Set()
    for (const m of normalizedMembers) {
      if (seen.has(m.email)) {
        logApi('team_update_validation_failed', { ...requestContext(req), teamId: id, teamName: trimmed, reason: 'duplicate_member_email', memberEmail: m.email })
        return res.status(400).json({ message: 'Duplicate team member email in the same team' })
      }
      seen.add(m.email)
    }

    const existing = await storage.getTeamById(id)
    if (!existing) {
      logApi('team_update_not_found', { ...requestContext(req), teamId: id })
      return res.status(404).json({ message: 'Team not found' })
    }

    const teams = await storage.listTeams()
    const nameTaken = teams.find((team) => String(team?.id) !== id && String(team?.name || '').replace(/\s+/g, ' ').trim().toLowerCase() === trimmed.toLowerCase()) || null
    if (nameTaken) {
      const suggestedTeamName = buildSuggestedTeamName(trimmed, teams, id)
      const message = `Team name already exists`
      logApi('team_update_duplicate_name', { ...requestContext(req), teamId: id, teamName: trimmed, existingTeamId: nameTaken.id, suggestedTeamName })
      return res.status(409).json({ message, suggestedTeamName })
    }

    const requesterEmail = normalizeEmail(req.user.email)
    const canEdit = (existing.members || []).some((m) => normalizeEmail(m.email) === requesterEmail)
    if (!canEdit) {
      logApi('team_update_forbidden', { ...requestContext(req), teamId: id, teamName: existing.name })
      return res.status(403).json({ message: 'Only team members can edit this team' })
    }

    try {
      const updated = await storage.updateTeam(id, { name: trimmed, members: normalizedMembers })
      logApi('team_updated', { ...requestContext(req), teamId: id, teamIdentifier: updated?.teamIdentifier || existing.teamIdentifier || null, teamName: updated?.name || trimmed, memberCount: normalizedMembers.length })
      res.json(updated)
    } catch (error) {
      if (/duplicate|ER_DUP_ENTRY|unique/i.test(String(error?.code || '') + ' ' + String(error?.message || ''))) {
        const latestTeams = await storage.listTeams()
        const suggestedTeamName = buildSuggestedTeamName(trimmed, latestTeams, id)
        const message = `Team name already exists`
        logApi('team_update_duplicate_name_race', { ...requestContext(req), teamId: id, teamName: trimmed, suggestedTeamName })
        return res.status(409).json({ message, suggestedTeamName })
      }
      throw error
    }
  } catch (error) {
    logRouteError('Update team error', req, error)
    res.status(500).json({ message: 'Could not update team' })
  }
})

app.delete('/api/teams/:id', requireStorage, authMiddleware, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ message: 'Team id required' })

    logApi('team_delete_started', { ...requestContext(req), teamId: id })
    const existing = await storage.getTeamById(id)
    if (!existing) {
      logApi('team_delete_not_found', { ...requestContext(req), teamId: id })
      return res.status(404).json({ message: 'Team not found' })
    }

    const requesterEmail = normalizeEmail(req.user.email)
    const canDelete = (existing.members || []).some((m) => normalizeEmail(m.email) === requesterEmail)
    if (!canDelete) {
      logApi('team_delete_forbidden', { ...requestContext(req), teamId: id, teamName: existing.name, requesterEmail })
      return res.status(403).json({ message: 'Only team members can delete this team' })
    }

    const allScores = await storage.listScores()
    const retainedLoggedEventsCount = (allScores || []).filter((score) => (
      score?.mode === 'team'
      && (String(score.team || '') === String(existing.name || '') || String(score.opponentTeam || '') === String(existing.name || ''))
    )).length

    await storage.deleteTeamById(id)
    logApi('team_deleted', { ...requestContext(req), teamId: id, teamName: existing.name, retainedLoggedEventsCount })
    res.json({ ok: true, deletedTeamId: id, retainedLoggedEventsCount })
  } catch (error) {
    logRouteError('Delete team error', req, error)
    res.status(500).json({ message: 'Could not delete team' })
  }
})



app.get('/api/scorecard-drafts', requireStorage, authMiddleware, async (req, res) => {
  try {
    const context = normalizeDraftContext(req.query || {}, req.user)
    const db = getPool()
    const holes = await listScorecardDraftHoles(db, context)
    logApi('scorecard_draft_loaded', {
      ...requestContext(req),
      mode: context.mode,
      scoringSide: context.scoringSide,
      date: context.date,
      state: context.state,
      course: context.course,
      team: context.team,
      opponentTeam: context.opponentTeam,
      holeCount: holes.length,
    })
    res.json({ holes, holeCount: holes.length })
  } catch (error) {
    const status = /required|between|score/.test(String(error?.message || '')) ? 400 : 500
    logRouteError('Load scorecard draft error', req, error)
    res.status(status).json({ message: error?.message || 'Could not load saved hole scores' })
  }
})

app.put('/api/scorecard-drafts/hole', requireStorage, authMiddleware, async (req, res) => {
  try {
    const context = normalizeDraftContext(req.body || {}, req.user)
    const hole = normalizeDraftHole(req.body?.hole || req.body || {})
    const db = getPool()
    const saved = await upsertScorecardDraftHole(db, context, hole)
    logApi('scorecard_draft_hole_saved', {
      ...requestContext(req),
      mode: context.mode,
      scoringSide: context.scoringSide,
      date: context.date,
      state: context.state,
      course: context.course,
      team: context.team,
      opponentTeam: context.opponentTeam,
      hole: saved.hole,
      score: saved.score,
    })
    res.json({ hole: saved })
  } catch (error) {
    const status = /required|between|score|authenticated/.test(String(error?.message || '')) ? 400 : 500
    logRouteError('Save scorecard draft hole error', req, error)
    res.status(status).json({ message: error?.message || 'Could not save hole score' })
  }
})


app.delete('/api/scorecard-drafts/hole', requireStorage, authMiddleware, async (req, res) => {
  try {
    const context = normalizeDraftContext({ ...(req.query || {}), ...(req.body || {}) }, req.user)
    const holeNumber = req.query?.hole ?? req.body?.hole ?? req.body?.holeNumber
    const db = getPool()
    const clearedDraftHoles = await deleteScorecardDraftHole(db, context, holeNumber)
    logApi('scorecard_draft_hole_cleared', {
      ...requestContext(req),
      mode: context.mode,
      scoringSide: context.scoringSide,
      date: context.date,
      state: context.state,
      course: context.course,
      team: context.team,
      opponentTeam: context.opponentTeam,
      hole: Number(holeNumber),
      clearedDraftHoles,
    })
    res.json({ clearedDraftHoles })
  } catch (error) {
    const status = /required|between|authenticated/.test(String(error?.message || '')) ? 400 : 500
    logRouteError('Clear scorecard draft hole error', req, error)
    res.status(status).json({ message: error?.message || 'Could not clear saved hole score' })
  }
})

app.delete('/api/scorecard-drafts', requireStorage, authMiddleware, async (req, res) => {
  try {
    const context = normalizeDraftContext(req.query || {}, req.user)
    const db = getPool()
    const clearedDraftHoles = await clearScorecardDraftHoles(db, context)
    logApi('scorecard_draft_cancelled', {
      ...requestContext(req),
      mode: context.mode,
      scoringSide: context.scoringSide,
      date: context.date,
      state: context.state,
      course: context.course,
      team: context.team,
      opponentTeam: context.opponentTeam,
      clearedDraftHoles,
    })
    res.json({ clearedDraftHoles })
  } catch (error) {
    const status = /required|authenticated/.test(String(error?.message || '')) ? 400 : 500
    logRouteError('Cancel scorecard draft error', req, error)
    res.status(status).json({ message: error?.message || 'Could not cancel saved hole scores' })
  }
})


function isScoreCreator(entry, user) {
  const userId = String(user?.id || '')
  const email = normalizeEmail(user?.email)
  return Boolean(
    (userId && String(entry?.createdByUserId || '') === userId) ||
    (email && normalizeEmail(entry?.createdByEmail) === email)
  )
}

async function canMutateScore(entry, user) {
  if (!entry || !user) return false
  if (isScoreCreator(entry, user)) return true
  if (entry.mode !== 'team') return false
  return await isUserOnTeam(entry.team, user.email) || await isUserOnTeam(entry.opponentTeam, user.email)
}

function coerceScoreNumber(value, fieldName) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) throw new Error(`${fieldName} must be a number`)
  if (numberValue < 0) throw new Error(`${fieldName} must be zero or greater`)
  return numberValue
}

function coerceOptionalScoreNumber(value, fieldName) {
  if (value === undefined || value === null || value === '') return null
  return coerceScoreNumber(value, fieldName)
}

function countProvidedHoleScores(holes) {
  if (!Array.isArray(holes)) return 0
  return holes.filter((hole) => {
    if (typeof hole === 'number') return Number.isFinite(hole)
    if (!hole || typeof hole !== 'object') return false
    if (Object.prototype.hasOwnProperty.call(hole, 'scoreProvided') || Object.prototype.hasOwnProperty.call(hole, 'score_provided')) {
      return hole.scoreProvided === true || hole.scoreProvided === 1 || hole.scoreProvided === '1' || hole.scoreProvided === 'true' || hole.score_provided === true || hole.score_provided === 1 || hole.score_provided === '1' || hole.score_provided === 'true'
    }
    return hole.score !== undefined && hole.score !== null && hole.score !== '' && Number.isFinite(Number(hole.score))
  }).length
}

function sameTeamName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
}

function scoreCourseMatches(entry, { state, course, courseId }) {
  const normalizedState = String(state || '').trim().toUpperCase()
  if (String(entry?.state || '').trim().toUpperCase() !== normalizedState) return false

  const normalizedCourseId = String(courseId || '').trim()
  const entryCourseId = String(entry?.golfCourseId || entry?.golf_course_id || '').trim()
  if (normalizedCourseId && entryCourseId && normalizedCourseId === entryCourseId) return true

  const normalizedCourse = String(course || '').trim().toLowerCase()
  return Boolean(normalizedCourse) && String(entry?.course || '').trim().toLowerCase() === normalizedCourse
}

function findMatchingTeamRound(scores, { date, state, course, courseId, team, opponentTeam }) {
  return (scores || []).find((entry) => {
    if (entry?.mode !== 'team') return false
    if (String(entry.date || '') !== String(date || '')) return false
    if (!scoreCourseMatches(entry, { state, course, courseId })) return false
    const normal = sameTeamName(entry.team, team) && sameTeamName(entry.opponentTeam, opponentTeam)
    const reversed = sameTeamName(entry.team, opponentTeam) && sameTeamName(entry.opponentTeam, team)
    return normal || reversed
  }) || null
}

function findMatchingSoloRound(scores, { date, state, course, courseId, user }) {
  return (scores || []).find((entry) => {
    if (entry?.mode !== 'solo') return false
    if (entry?.source === 'individual_challenge') return false
    if (String(entry.date || '') !== String(date || '')) return false
    if (!scoreCourseMatches(entry, { state, course, courseId })) return false
    return isScoreCreator(entry, user)
  }) || null
}

function viewerTeamRoundProjection(entry, { team, opponentTeam }) {
  if (!entry) return { score: null, teamTotal: null, opponentTotal: null, teamHoles: null, opponentHoles: null }
  const normal = sameTeamName(entry.team, team) && sameTeamName(entry.opponentTeam, opponentTeam)
  return {
    score: entry,
    teamTotal: normal ? entry.teamTotal ?? null : entry.opponentTotal ?? null,
    opponentTotal: normal ? entry.opponentTotal ?? null : entry.teamTotal ?? null,
    teamHoles: normal ? entry.holes ?? null : entry.opponentHoles ?? null,
    opponentHoles: normal ? entry.opponentHoles ?? null : entry.holes ?? null,
  }
}

async function loadScorecardDraftFallback(req, contextInput, scoringSide) {
  try {
    const context = normalizeDraftContext({ ...contextInput, scoringSide }, req.user)
    const draftHoles = await listScorecardDraftHoles(getPool(), context)
    const normalized = normalizeHoleScorePayload(draftHoles)
    if (normalized?.length) {
      logApi('scorecard_draft_used_for_score_persistence', {
        ...requestContext(req),
        mode: context.mode,
        scoringSide,
        holeCount: normalized.length,
        course: context.course,
        team: context.team,
        opponentTeam: context.opponentTeam,
      })
      return normalized
    }
  } catch (error) {
    logError('Failed to load scorecard draft fallback for score persistence', {
      error,
      scoringSide,
      userId: req.user?.id,
      course: contextInput?.course,
      team: contextInput?.team,
      opponentTeam: contextInput?.opponentTeam,
    })
  }

  return null
}

async function resolveTeamHolePayloads(req, { date, state, course, team, opponentTeam, holes, opponentHoles }) {
  let normalizedHoles = normalizeHoleScorePayload(holes)
  let normalizedOpponentHoles = normalizeHoleScorePayload(opponentHoles)
  const baseDraftContext = { mode: 'team', date, state: String(state).toUpperCase(), course, team, opponentTeam }

  if (!normalizedHoles?.length) {
    normalizedHoles = await loadScorecardDraftFallback(req, baseDraftContext, 'team')
  }
  if (!normalizedOpponentHoles?.length) {
    normalizedOpponentHoles = await loadScorecardDraftFallback(req, baseDraftContext, 'opponent')
  }

  return { normalizedHoles, normalizedOpponentHoles }
}

async function buildUpdatedScorePayload(existing, body, req) {
  const mode = existing.mode === 'solo' ? 'solo' : 'team'
  const date = body.date ?? existing.date
  const state = String(body.state ?? existing.state ?? '').trim().toUpperCase()
  const courseInput = String(body.course ?? existing.course ?? '').trim()
  const courseIdInput = String(body.courseId ?? body.course_id ?? existing.golfCourseId ?? existing.golf_course_id ?? '').trim()

  if (!date || !courseInput) throw new Error('date and course required')
  if (!isValidPastOrTodayDate(date, req.headers['x-user-timezone'])) throw new Error('Date must be today or earlier in your local time zone')
  if (!state) throw new Error('state required')

  const matchedCourse = await findGolfCourseForState(state, courseInput, courseIdInput)
  if (!matchedCourse) throw new Error('Select a golf course from the catalog for the selected state')

  const courseMetadata = resolveScoreCourseMetadata(state, matchedCourse)
  const teeColor = normalizeTeeColor(body.teeColor ?? body.tee_color ?? existing.teeColor ?? DEFAULT_TEE_COLOR)

  if (mode === 'solo') {
    const normalizedHoles = body.holes === undefined ? existing.holes : normalizeHoleScorePayload(body.holes)
    const providedHoleCount = countProvidedHoleScores(normalizedHoles)
    const roundScore = providedHoleCount > 0
      ? calculateProvidedHoleScoreTotal(normalizedHoles)
      : coerceScoreNumber(body.roundScore ?? existing.roundScore, 'roundScore')
    return {
      ...existing,
      mode: 'solo',
      date,
      state,
      course: matchedCourse.name,
      roundScore,
      teeColor,
      team: null,
      opponentTeam: null,
      teamTotal: null,
      opponentTotal: null,
      won: null,
      holes: normalizedHoles,
      opponentHoles: null,
      ...courseMetadata,
    }
  }

  const team = String(body.team ?? existing.team ?? '').trim()
  const opponentTeam = String(body.opponentTeam ?? existing.opponentTeam ?? '').trim()
  if (!team) throw new Error('team required')
  if (!opponentTeam) throw new Error('opponentTeam required')
  if (team.toLowerCase() === opponentTeam.toLowerCase()) throw new Error('Opponent team must be different from your team')

  const myTeam = await findTeamByName(team)
  if (!myTeam) throw new Error('Your team must be a known team (create it first)')
  const userOnTeam = await isUserOnTeam(team, req.user.email)
  if (!userOnTeam && !isScoreCreator(existing, req.user)) throw new Error('You are not a member of the selected team')

  const oppTeamObj = await findTeamByName(opponentTeam)
  if (!oppTeamObj) throw new Error('Opponent team must be a known team (create it first)')
  const userOnOpponentTeam = await isUserOnTeam(opponentTeam, req.user.email)
  if ((body.teamTotal !== undefined || body.holes !== undefined) && !userOnTeam) throw new Error('Only members of the selected team can modify that team score')
  if ((body.opponentTotal !== undefined || body.opponentHoles !== undefined) && !userOnOpponentTeam) throw new Error('Only members of the opponent team can modify the opponent score')

  const normalizedHoles = body.holes === undefined ? existing.holes : normalizeHoleScorePayload(body.holes)
  const normalizedOpponentHoles = body.opponentHoles === undefined ? existing.opponentHoles : normalizeHoleScorePayload(body.opponentHoles)
  const submittedTeamTotal = coerceOptionalScoreNumber(body.teamTotal ?? existing.teamTotal, 'teamTotal')
  const submittedOpponentTotal = coerceOptionalScoreNumber(body.opponentTotal ?? existing.opponentTotal, 'opponentTotal')
  const teamTotal = countProvidedHoleScores(normalizedHoles) > 0 ? calculateProvidedHoleScoreTotal(normalizedHoles) : submittedTeamTotal
  const opponentTotal = countProvidedHoleScores(normalizedOpponentHoles) > 0 ? calculateProvidedHoleScoreTotal(normalizedOpponentHoles) : submittedOpponentTotal
  if (teamTotal === null) throw new Error('teamTotal must be a number')
  const won = opponentTotal === null ? null : (teamTotal < opponentTotal ? true : (teamTotal > opponentTotal ? false : null))

  return {
    ...existing,
    mode: 'team',
    date,
    state,
    course: matchedCourse.name,
    team,
    opponentTeam,
    teamTotal,
    opponentTotal,
    roundScore: null,
    teeColor,
    won,
    holes: normalizedHoles,
    opponentHoles: normalizedOpponentHoles,
    ...courseMetadata,
  }
}

app.get('/api/solo-round-score', requireStorage, authMiddleware, async (req, res) => {
  try {
    const context = {
      date: String(req.query.date || '').trim(),
      state: String(req.query.state || '').trim().toUpperCase(),
      course: String(req.query.course || '').trim(),
      courseId: String(req.query.courseId || req.query.course_id || '').trim(),
    }
    if (!context.date || !context.state || !context.course) {
      return res.status(400).json({ message: 'date, state, and course are required' })
    }
    if (!isValidPastOrTodayDate(context.date, req.headers['x-user-timezone'])) {
      return res.status(400).json({ message: 'Date must be today or earlier in your local time zone' })
    }

    const matchedCourse = await findGolfCourseForState(context.state, context.course, context.courseId)
    if (!matchedCourse) return res.status(400).json({ message: 'Select a golf course from the catalog for the selected state' })

    const scores = await storage.listScores()
    const entry = findMatchingSoloRound(scores, { ...context, course: matchedCourse.name, user: req.user })
    const holes = Array.isArray(entry?.holes) ? entry.holes : null
    const providedHoleCount = countProvidedHoleScores(holes)
    logApi('solo_round_score_lookup_loaded', {
      ...requestContext(req),
      ...context,
      course: matchedCourse.name,
      scoreId: entry?.id || null,
      providedHoleCount,
      incomplete: providedHoleCount > 0 && providedHoleCount < 18,
    })
    res.json({ score: entry || null })
  } catch (error) {
    logRouteError('Solo round score lookup error', req, error)
    res.status(500).json({ message: 'Could not load solo round score' })
  }
})


app.get('/api/team-round-score', requireStorage, authMiddleware, async (req, res) => {
  try {
    const context = {
      date: String(req.query.date || '').trim(),
      state: String(req.query.state || '').trim().toUpperCase(),
      course: String(req.query.course || '').trim(),
      courseId: String(req.query.courseId || req.query.course_id || '').trim(),
      team: String(req.query.team || '').trim(),
      opponentTeam: String(req.query.opponentTeam || '').trim(),
    }
    if (!context.date || !context.state || !context.course || !context.team || !context.opponentTeam) {
      return res.status(400).json({ message: 'date, state, course, team, and opponentTeam are required' })
    }
    if (!(await isUserOnTeam(context.team, req.user.email)) && !(await isUserOnTeam(context.opponentTeam, req.user.email))) {
      logApi('team_round_score_lookup_forbidden', { ...requestContext(req), ...context })
      return res.status(403).json({ message: 'Only members of the teams involved can view this team round score.' })
    }
    const matchedCourse = await findGolfCourseForState(context.state, context.course, context.courseId)
    if (!matchedCourse) return res.status(400).json({ message: 'Select a golf course from the catalog for the selected state' })
    const scores = await storage.listScores()
    const entry = findMatchingTeamRound(scores, { ...context, course: matchedCourse.name })
    const projection = viewerTeamRoundProjection(entry, { team: context.team, opponentTeam: context.opponentTeam })
    logApi('team_round_score_lookup_loaded', {
      ...requestContext(req),
      ...context,
      course: matchedCourse.name,
      scoreId: entry?.id || null,
      hasTeamTotal: projection.teamTotal !== null && projection.teamTotal !== undefined,
      hasOpponentTotal: projection.opponentTotal !== null && projection.opponentTotal !== undefined,
    })
    res.json(projection)
  } catch (error) {
    logRouteError('Team round score lookup error', req, error)
    res.status(500).json({ message: 'Could not load team round score' })
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

      const matchedCourse = await findGolfCourseForState(state, course, body.courseId || body.course_id || '')
      if (!matchedCourse) return res.status(400).json({ message: 'Select a golf course from the catalog for the selected state' })

      const teeColor = normalizeTeeColor(body.teeColor || body.tee_color || DEFAULT_TEE_COLOR)
      const normalizedHoles = normalizeHoleScorePayload(holes)
      const providedHoleCount = countProvidedHoleScores(normalizedHoles)
      const currentHoleScoreTotal = calculateProvidedHoleScoreTotal(normalizedHoles)
      const storedRoundScore = providedHoleCount > 0 ? currentHoleScoreTotal : roundScore
      const courseMetadata = resolveScoreCourseMetadata(state, matchedCourse)
      const entry = await storage.createScore({
        mode: 'solo',
        date,
        state: String(state).toUpperCase(),
        course: matchedCourse.name,
        roundScore: storedRoundScore,
        teeColor,
        holes: normalizedHoles,
        ...courseMetadata,
        createdByUserId: req.user.id,
        createdByEmail: req.user.email,
      })
      if (normalizedHoles?.length) {
        try {
          const draftContext = normalizeDraftContext({ mode: 'solo', date, state: String(state).toUpperCase(), course: matchedCourse.name }, req.user)
          const clearedDraftHoles = await clearScorecardDraftHoles(getPool(), draftContext)
          logApi('scorecard_draft_cleared', { ...requestContext(req), mode: 'solo', scoreId: entry.id, clearedDraftHoles })
        } catch (draftError) {
          logError('Failed to clear solo scorecard draft after score creation', { error: draftError, scoreId: entry.id, userId: req.user.id })
        }
      }
      logApi('solo_score_created', {
        ...requestContext(req),
        scoreId: entry.id,
        course: matchedCourse.name,
        roundScore: storedRoundScore,
        teeColor,
        courseRating: courseMetadata.courseRating,
        slopeRating: courseMetadata.slopeRating,
        holeCount: normalizedHoles?.length || 0,
        providedHoleCount,
        incomplete: providedHoleCount > 0 && providedHoleCount < 18,
        currentHoleScoreTotal: normalizedHoles ? currentHoleScoreTotal : null,
      })
      return res.status(201).json(entry)
    }

    const { date, state, course, team, opponentTeam, teamTotal, opponentTotal, holes, opponentHoles } = body
    if (!date || !course || !team) return res.status(400).json({ message: 'date, course, team required' })
    if (!isValidPastOrTodayDate(date, req.headers['x-user-timezone'])) return res.status(400).json({ message: 'Date must be today or earlier in your local time zone' })
    if (!state || typeof state !== 'string' || !String(state).trim()) return res.status(400).json({ message: 'state required' })
    if (!opponentTeam || !String(opponentTeam).trim()) return res.status(400).json({ message: 'opponentTeam required' })
    if (String(opponentTeam).trim().toLowerCase() === String(team).trim().toLowerCase()) {
      return res.status(400).json({ message: 'Opponent team must be different from your team' })
    }
    const submittedTeamTotal = coerceOptionalScoreNumber(teamTotal, 'teamTotal')
    const submittedOpponentTotal = coerceOptionalScoreNumber(opponentTotal, 'opponentTotal')

    const matchedCourse = await findGolfCourseForState(state, course, body.courseId || body.course_id || '')
    if (!matchedCourse) return res.status(400).json({ message: 'Select a golf course from the catalog for the selected state' })

    const myTeam = await findTeamByName(team)
    if (!myTeam) return res.status(400).json({ message: 'Your team must be a known team (create it first)' })
    const userOnTeam = await isUserOnTeam(team, req.user.email)
    if (!userOnTeam) return res.status(403).json({ message: 'You are not a member of the selected team' })

    const oppTeamObj = await findTeamByName(opponentTeam)
    if (!oppTeamObj) return res.status(400).json({ message: 'Opponent team must be a known team (create it first)' })
    const userOnOpponentTeam = await isUserOnTeam(opponentTeam, req.user.email)
    if ((opponentTotal !== undefined && opponentTotal !== null && opponentTotal !== '') || (opponentHoles !== undefined && opponentHoles !== null)) {
      if (!userOnOpponentTeam) return res.status(403).json({ message: 'Only members of the opponent team can modify the opponent score' })
    }

    const courseMetadata = resolveScoreCourseMetadata(state, matchedCourse)
    const teeColor = normalizeTeeColor(body.teeColor || body.tee_color || DEFAULT_TEE_COLOR)
    const { normalizedHoles, normalizedOpponentHoles } = await resolveTeamHolePayloads(req, {
      date,
      state: String(state).toUpperCase(),
      course: matchedCourse.name,
      team,
      opponentTeam: String(opponentTeam).trim(),
      holes,
      opponentHoles: userOnOpponentTeam ? opponentHoles : null,
    })
    const persistedOpponentHoles = userOnOpponentTeam ? normalizedOpponentHoles : null
    const providedTeamHoleCount = countProvidedHoleScores(normalizedHoles)
    const providedOpponentHoleCount = countProvidedHoleScores(persistedOpponentHoles)
    const currentTeamHoleScoreTotal = calculateProvidedHoleScoreTotal(normalizedHoles)
    const currentOpponentHoleScoreTotal = calculateProvidedHoleScoreTotal(persistedOpponentHoles)
    const normalizedTeamTotal = providedTeamHoleCount > 0 ? currentTeamHoleScoreTotal : submittedTeamTotal
    const normalizedOpponentTotal = providedOpponentHoleCount > 0 ? currentOpponentHoleScoreTotal : submittedOpponentTotal
    if (normalizedTeamTotal === null) return res.status(400).json({ message: 'teamTotal must be a number' })
    const won = normalizedOpponentTotal === null ? null : (normalizedTeamTotal < normalizedOpponentTotal ? true : (normalizedTeamTotal > normalizedOpponentTotal ? false : null))

    const entry = await storage.createScore({
      mode: 'team',
      date,
      state: String(state).toUpperCase(),
      course: matchedCourse.name,
      team,
      opponentTeam: String(opponentTeam).trim(),
      teamTotal: normalizedTeamTotal,
      opponentTotal: normalizedOpponentTotal,
      won,
      teeColor,
      holes: normalizedHoles,
      opponentHoles: persistedOpponentHoles,
      ...courseMetadata,
      createdByUserId: req.user.id,
      createdByEmail: req.user.email,
    })
    if (normalizedHoles?.length || persistedOpponentHoles?.length) {
      try {
        const baseDraftContext = { mode: 'team', date, state: String(state).toUpperCase(), course: matchedCourse.name, team, opponentTeam: String(opponentTeam).trim() }
        const teamDraftContext = normalizeDraftContext({ ...baseDraftContext, scoringSide: 'team' }, req.user)
        const opponentDraftContext = userOnOpponentTeam ? normalizeDraftContext({ ...baseDraftContext, scoringSide: 'opponent' }, req.user) : null
        const clearedTeamDraftHoles = await clearScorecardDraftHoles(getPool(), teamDraftContext)
        const clearedOpponentDraftHoles = opponentDraftContext ? await clearScorecardDraftHoles(getPool(), opponentDraftContext) : 0
        logApi('scorecard_draft_cleared', { ...requestContext(req), mode: 'team', scoreId: entry.id, clearedDraftHoles: clearedTeamDraftHoles + clearedOpponentDraftHoles, clearedTeamDraftHoles, clearedOpponentDraftHoles })
      } catch (draftError) {
        logError('Failed to clear team scorecard draft after score creation', { error: draftError, scoreId: entry.id, userId: req.user.id })
      }
    }
    logApi('team_score_created', {
      ...requestContext(req),
      scoreId: entry.id,
      course: matchedCourse.name,
      team,
      opponentTeam: String(opponentTeam).trim(),
      teamTotal: normalizedTeamTotal,
      opponentTotal: normalizedOpponentTotal,
      teeColor,
      holeCount: normalizedHoles?.length || 0,
      opponentHoleCount: persistedOpponentHoles?.length || 0,
      currentTeamHoleScoreTotal: normalizedHoles ? currentTeamHoleScoreTotal : null,
      currentOpponentHoleScoreTotal: persistedOpponentHoles ? currentOpponentHoleScoreTotal : null,
      won,
    })
    res.status(201).json(entry)
  } catch (error) {
    logRouteError('Create score error', req, error)
    res.status(500).json({ message: 'Could not create score' })
  }
})


app.patch('/api/scores/:id', requireStorage, authMiddleware, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    const existing = await storage.getScoreById(id)
    if (!existing) return res.status(404).json({ message: 'Score not found' })
    if (!(await canMutateScore(existing, req.user))) return res.status(403).json({ message: 'Only the round creator or members of the teams involved can edit this round' })

    const updatedPayload = await buildUpdatedScorePayload(existing, req.body || {}, req)
    const updated = await storage.updateScoreById(id, updatedPayload)
    logApi('score_updated', {
      ...requestContext(req),
      scoreId: id,
      mode: updated?.mode || updatedPayload.mode,
      course: updated?.course || updatedPayload.course,
      team: updated?.team || updatedPayload.team || null,
      opponentTeam: updated?.opponentTeam || updatedPayload.opponentTeam || null,
      teeColor: updated?.teeColor || updatedPayload.teeColor || DEFAULT_TEE_COLOR,
      providedHoleCount: countProvidedHoleScores(updated?.holes || updatedPayload.holes),
      opponentProvidedHoleCount: countProvidedHoleScores(updated?.opponentHoles || updatedPayload.opponentHoles),
    })
    res.json(updated)
  } catch (error) {
    const message = error?.message || 'Could not update score'
    const status = /not a member/.test(message) ? 403 : (/required|must be|must be today|Select a golf course|known team|different/.test(message) ? 400 : 500)
    if (status >= 500) logRouteError('Update score error', req, error)
    res.status(status).json({ message })
  }
})


async function clearRoundScorecardDraftsForCancel(req, context) {
  if (!context.date || !context.state || !context.course) return { clearedDraftHoles: 0, clearedTeamDraftHoles: 0, clearedOpponentDraftHoles: 0 }

  const db = getPool()
  if (context.mode === 'solo') {
    const draftContext = normalizeDraftContext({ mode: 'solo', date: context.date, state: context.state, course: context.course }, req.user)
    const clearedDraftHoles = await clearScorecardDraftHoles(db, draftContext)
    return { clearedDraftHoles, clearedTeamDraftHoles: 0, clearedOpponentDraftHoles: 0 }
  }

  const baseDraftContext = { mode: 'team', date: context.date, state: context.state, course: context.course, team: context.team, opponentTeam: context.opponentTeam }
  const teamDraftContext = normalizeDraftContext({ ...baseDraftContext, scoringSide: 'team' }, req.user)
  const opponentDraftContext = normalizeDraftContext({ ...baseDraftContext, scoringSide: 'opponent' }, req.user)
  const clearedTeamDraftHoles = await clearScorecardDraftHoles(db, teamDraftContext)
  const clearedOpponentDraftHoles = await clearScorecardDraftHoles(db, opponentDraftContext)
  return { clearedDraftHoles: clearedTeamDraftHoles + clearedOpponentDraftHoles, clearedTeamDraftHoles, clearedOpponentDraftHoles }
}

function scoreMatchesCancelContext(entry, context, user) {
  if (!entry || entry.mode !== context.mode) return false
  if (String(entry.date || '') !== String(context.date || '')) return false
  if (!scoreCourseMatches(entry, context)) return false
  if (context.mode === 'solo') return isScoreCreator(entry, user)

  const normal = sameTeamName(entry.team, context.team) && sameTeamName(entry.opponentTeam, context.opponentTeam)
  const reversed = sameTeamName(entry.team, context.opponentTeam) && sameTeamName(entry.opponentTeam, context.team)
  return normal || reversed
}

async function findScoreForRoundCancel(req, context) {
  const scoreId = String(context.scoreId || '').trim()
  if (scoreId) {
    const entry = await storage.getScoreById(scoreId)
    if (entry && scoreMatchesCancelContext(entry, context, req.user)) return entry
    return null
  }

  const scores = await storage.listScores()
  return context.mode === 'solo'
    ? findMatchingSoloRound(scores, { ...context, user: req.user })
    : findMatchingTeamRound(scores, context)
}

app.delete('/api/scores/cancel-round', requireStorage, authMiddleware, async (req, res) => {
  try {
    const body = { ...(req.query || {}), ...(req.body || {}) }
    const mode = body.mode === 'solo' ? 'solo' : 'team'
    const context = {
      mode,
      date: String(body.date || '').trim(),
      state: String(body.state || '').trim().toUpperCase(),
      course: String(body.course || '').trim(),
      courseId: String(body.courseId || body.course_id || '').trim(),
      team: String(body.team || '').trim(),
      opponentTeam: String(body.opponentTeam || body.opponent_team || '').trim(),
      scoreId: String(body.scoreId || body.score_id || '').trim(),
    }

    if (!context.date || !context.state || !context.course) return res.status(400).json({ message: 'date, state, and course are required to cancel a round' })
    if (mode === 'team' && (!context.team || !context.opponentTeam)) return res.status(400).json({ message: 'team and opponentTeam are required to cancel a team round' })

    const draftResult = await clearRoundScorecardDraftsForCancel(req, context)
    const entry = await findScoreForRoundCancel(req, context)
    let deletedScoreId = null
    if (entry) {
      if (!(await canMutateScore(entry, req.user))) return res.status(403).json({ message: 'Only the round creator or members of the teams involved can cancel this round' })
      await storage.deleteScoreById(entry.id)
      deletedScoreId = entry.id
    }

    logApi('round_cancelled', {
      ...requestContext(req),
      mode: context.mode,
      date: context.date,
      state: context.state,
      course: context.course,
      courseId: context.courseId || null,
      team: context.team || null,
      opponentTeam: context.opponentTeam || null,
      requestedScoreId: context.scoreId || null,
      deletedScoreId,
      clearedDraftHoles: draftResult.clearedDraftHoles,
      clearedTeamDraftHoles: draftResult.clearedTeamDraftHoles,
      clearedOpponentDraftHoles: draftResult.clearedOpponentDraftHoles,
    })

    res.json({ ok: true, deletedScoreId, ...draftResult })
  } catch (error) {
    const message = error?.message || 'Could not cancel this round'
    const status = /required|authenticated/.test(message) ? 400 : 500
    if (status >= 500) logRouteError('Cancel round error', req, error)
    res.status(status).json({ message })
  }
})

app.delete('/api/scores/:id', requireStorage, authMiddleware, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    const entry = await storage.getScoreById(id)
    if (!entry) return res.status(404).json({ message: 'Score not found' })

    if (!(await canMutateScore(entry, req.user))) return res.status(403).json({ message: 'Only the round creator or members of the teams involved can delete this round' })

    await storage.deleteScoreById(id)
    logApi('score_deleted', { ...requestContext(req), scoreId: id, mode: entry.mode, course: entry.course, team: entry.team || null, opponentTeam: entry.opponentTeam || null })
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
    if (!adminUser) {
      logApi('admin_password_reset_requested_unknown_identifier', { ...requestContext(req), identifier })
      return res.json({ ok: true })
    }

    const resetToken = await createAdminResetToken(adminUser.id)
    await sendAdminPasswordResetEmail(req, adminUser, resetToken)
    logApi('admin_password_reset_email_sent', { ...requestContext(req), adminUserId: adminUser.id, username: adminUser.username, email: adminUser.email })
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
    logApi('admin_portal_metadata_loaded', { ...requestContext(req), adminUserId: req.adminUser.id, summary: data.summary, teamRows: data.teams?.length || 0, teamsWithMemberEmails: (data.teams || []).filter((team) => team.team_member_emails).length })
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

app.delete('/api/admin/admin-users/:id', adminMiddleware, async (req, res) => {
  try {
    const targetAdminUserId = String(req.params.id || '').trim()
    if (!targetAdminUserId) return res.status(400).json({ message: 'Admin user id is required' })

    const result = await deleteAdminUser({ adminUserId: targetAdminUserId, requestedByAdminUserId: req.adminUser.id })
    const adminUsers = await listAdminUsers()
    logApi('admin_user_deleted', { ...requestContext(req), deletedAdminUserId: targetAdminUserId, adminUserId: req.adminUser.id })
    res.json({ ...result, adminUsers })
  } catch (error) {
    if (error instanceof Error && /not found|own admin|last active/i.test(error.message)) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Delete admin user error', req, error)
    res.status(500).json({ message: 'Could not delete admin user' })
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
    if (!cancelledTournamentCleanupScheduler) {
      cancelledTournamentCleanupScheduler = startScheduledJobRunner(() => getPool(), { logApi, logError, logInfo, logScheduledJob })
    }
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
