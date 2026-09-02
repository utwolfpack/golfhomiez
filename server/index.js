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
import { accessLogMiddleware, getLogPaths, logApi, logError, logFrontend, logInfo, logScheduledJob, logWarn, requestContext, requestCorrelationMiddleware } from './lib/logger.js'
import { getNearestLocation as getNearestServerLocation, searchLocations as searchServerLocations } from './lib/location-service.js'
import { findGolfCourseForState, findNearestGolfCourse, formatGolfCoursePhysicalAddress, getGolfCourseByName, listGolfCourseStates, listGolfCoursesForState, resolveGolfCourseForState } from './lib/golf-course-service.js'
import { calculateHoleScoreTotal, calculateProvidedHoleScoreTotal, getHoleScorecardForCourse, normalizeHoleScorePayload } from './lib/hole-scorecard.js'
import { clearScorecardDraftHoles, deleteScorecardDraftHole, listScorecardDraftHoles, normalizeDraftContext, normalizeDraftHole, upsertScorecardDraftHole } from './lib/scorecard-drafts.js'
import { sendMail } from './mailer.js'
import { generateQrSvg } from './lib/qr-code.js'
import { cancelScheduledJob, configureScheduledJob, listScheduledJobs, runScheduledJob, shouldRunScheduledJobInBackground, startScheduledJobRunner } from './lib/scheduled-jobs.js'
import { searchGolfCourseTournaments, syncGolfHomiezTournamentSearchRecord } from './lib/tournament-discovery.js'
import { searchGolfHomiezCourses } from './lib/golf-course-search.js'
import { v4 as uuidv4 } from 'uuid'
import { authenticateHostLogin, clearHostSessionCookie, createAdditionalHostAccount, createHostPasswordReset, createHostSession, deleteHostCourseAccount, destroyHostSession, ensureHostAuthSchema, getHostAccountBySession, getHostPortalData, hostAuthMiddleware, resetHostPassword, serializeHostSessionCookie, transferHostCourseAdmin } from './lib/host-auth.js'
import { authenticateOrganizerLogin, clearOrganizerSessionCookie, createOrganizerPasswordReset, createOrganizerSession, destroyOrganizerSession, ensureOrganizerAuthSchema, getOrganizerAccountBySession, organizerAuthMiddleware, registerOrganizerAccount, resetOrganizerPassword, serializeOrganizerSessionCookie } from './lib/organizer-auth.js'
import { approveHostAccountRequest, authenticateAdminRequest, clearAdminSessionCookie, createAdminResetToken, createAdminSessionCookie, refreshAdminSessionCookie, createAdminUser, createHostAccountRequest, consumeAdminResetToken, deleteAdminUser, deleteHostAccountRequest, getAdminUserByUsername, listAdminUsers, listPortalData, verifyPassword } from './lib/admin-portal.js'
import { buildOrganizerInviteDetails, createHostManagedTournament, createTournament, createTournamentOrganizerInvite, ensureTournamentInviteSchema, listHostAccounts, listOrganizerTournaments, sanitizeOrganizerTournamentInvitePayload, sanitizeTournamentTemplateData } from './lib/rbac.js'
import { findTournamentDateConflict, formatTournamentScheduleDate, normalizeTournamentScheduleDate } from './lib/tournament-schedule-conflicts.js'
import { requestUserTimeZone } from './lib/time-zone.js'
import { normalizeChallengeStatus, normalizeInboxMessagePayload, normalizeTeamChallengeScore, normalizeIndividualChallengeScore, normalizeTeamChallengeHoles, normalizeIndividualChallengeParticipantEmails, normalizeTeamChallengeScoringType, normalizeTeamChallengePointsPerHole, validateIndividualChallengeDateRange, validateOptionalChallengeState, validateOptionalChallengeCourse } from './lib/inbox-service.js'
import { addMessageGroupMember, appendTournamentPortalMessage, createMessageGroup, deleteMessageGroup, createTournamentMessageThread, createTournamentNotification, getTournamentMessageConversationForUser, getUserNotificationSummary, listMessageGroups, listTournamentMessageThreads, loadUserNotificationPage, markTournamentMessagesRead, removeMessageGroupMember, sendMessageGroupMessage, setNotificationThreadState, startTournamentUserConversationFromNotification, validateNotificationMessageBody } from './lib/notification-service.js'
import { DEFAULT_TEE_COLOR, normalizeTeeColor } from './lib/tee-colors.js'
import { getExternalApiCallSummary } from './lib/external-api-metrics.js'
import { getFeatureFlags, featureFlagDefinitionsForApi, isFeatureEnabled } from './lib/feature-flags.js'
import { loadProfileSummary } from './lib/profile-summary.js'
import { createGolfCoursePublicPageForApprovedHost, getGolfCoursePublicPageByHostAccount, getGolfCoursePublicPageBySlug, syncGolfCoursePublicPageCatalogDefaults, updateGolfCoursePublicPageForHost } from './lib/golf-course-public-pages.js'
import { buildSuggestedTournamentStartAssignments, listTournamentStartAssignmentsForTournaments, normalizeTeeTimeIntervalMinutes, normalizeTournamentStartTime, normalizeTournamentStartType, replaceTournamentStartAssignments } from './lib/tournament-start-schedule.js'
import { loadTournamentFinalLeaderboard } from './lib/tournament-final-leaderboard.js'
import { setTournamentArchiveState } from './lib/tournament-archive.js'
import { createMarketingVideoSection, deleteMarketingVideoSection, getHomeMarketingSettings, listMarketingVideoSections, normalizeMarketingVideoAudience, updateHomeMarketingSettings } from './lib/marketing-settings.js'
import { PASSWORD_POLICY_MESSAGE, validatePasswordPolicy } from './lib/password-policy.js'
import { completeCheckout, createAccessCode, createCheckout, createPaymentMethodCheckout, createPortal, getBillingStatus, listAccessCodes, processStripeWebhook, redeemAccessCode, requireBillingAccess, setCancellation, updateAccessCode } from './lib/billing.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.set('trust proxy', 1)
const PORT = Number(process.env.PORT)
let cancelledTournamentCleanupScheduler = null
if (!Number.isFinite(PORT) || PORT <= 0) throw new Error('PORT must be set to a valid positive number in the environment')
let storageReady = false
const DEFAULT_TOURNAMENT_TEAM_SLOT_LIMIT = 24
const DEFAULT_TOURNAMENT_CHECK_IN_TIME = '08:00'
const DEFAULT_TOURNAMENT_TEE_TIME = '08:30'
const DEFAULT_TEE_TIME_INTERVAL_MINUTES = 10

function rejectPasswordPolicy(req, res, password, accountType, action) {
  const result = validatePasswordPolicy(password)
  if (result.ok) return false
  logApi('password_policy_rejected', {
    ...requestContext(req),
    accountType,
    action,
    failures: result.failures,
  })
  res.status(400).json({ message: PASSWORD_POLICY_MESSAGE })
  return true
}

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

    const scorecardHoles = Array.isArray(scorecard.holes) ? scorecard.holes : []
    const providedHoleCount = scorecardHoles.filter((hole) => hole?.scoreProvided === true && Number.isFinite(Number(hole?.score))).length
    const unsetScoreHoleCount = scorecardHoles.filter((hole) => hole?.score == null).length
    const unsavedScoreValueCount = scorecardHoles.filter((hole) => hole?.scoreProvided !== true && hole?.score != null).length

    logApi('golf_course_scorecard_completed', {
      ...requestContext(req),
      state,
      course: scorecard.course,
      courseId: scorecard.courseId,
      source: scorecard.source,
      teeColor: scorecard.teeColor || teeColor,
      availableTeeColors: scorecard.availableTeeColors || [],
      golferLocationProvided: Number.isFinite(golferLatitude) && Number.isFinite(golferLongitude),
      holeCount: scorecardHoles.length,
      distanceToFlagCount: scorecardHoles.filter((hole) => Number.isFinite(Number(hole.distanceToFlagYards))).length,
      providedHoleCount,
      unsetScoreHoleCount,
      unsavedScoreValueCount,
      scoreValuePolicy: 'saved_holes_only',
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
app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  try {
    const result = await processStripeWebhook(getPool(), req.body, req.headers['stripe-signature'])
    return res.json({ received: true, ...result })
  } catch (error) {
    logRouteError('Stripe webhook error', req, error)
    return res.status(400).json({ message: 'Invalid Stripe webhook.' })
  }
})
const apiJsonBodyLimit = String(process.env.API_JSON_BODY_LIMIT || '4mb').trim() || '4mb'
app.use(express.json({ limit: apiJsonBodyLimit }))
app.use((error, req, res, next) => {
  if (error?.type === 'entity.too.large') {
    logRouteError('JSON payload too large', req, error, { bodyLimit: apiJsonBodyLimit })
    return res.status(413).json({ message: 'Uploaded image is too large. Please select a smaller image or try again after the image is compressed.' })
  }
  return next(error)
})

app.get('/api/marketing/home', async (req, res) => {
  try {
    const settings = await getHomeMarketingSettings()
    logApi('home_marketing_settings_loaded', {
      ...requestContext(req),
      updatedAt: settings.updatedAt || null,
    })
    return res.json(settings)
  } catch (error) {
    logRouteError('Home marketing settings load error', req, error)
    return res.status(500).json({ message: 'Home marketing content is temporarily unavailable.' })
  }
})

app.get('/api/marketing/videos', async (req, res) => {
  try {
    const audience = req.query.audience ? normalizeMarketingVideoAudience(req.query.audience) : null
    const sections = await listMarketingVideoSections({ audience })
    logApi('marketing_video_sections_loaded', {
      ...requestContext(req),
      audience,
      sectionCount: sections.length,
    })
    return res.json({ sections })
  } catch (error) {
    if (/Video page must be/i.test(String(error?.message || ''))) {
      logWarn('Marketing video section audience validation failed', {
        ...requestContext(req),
        audience: req.query.audience || null,
        validationMessage: error.message,
      })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Marketing video sections load error', req, error)
    return res.status(500).json({ message: 'Marketing videos are temporarily unavailable.' })
  }
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
    const billingRecoveryPaths = new Set(['/api/profile', '/api/billing/status', '/api/billing/checkout', '/api/billing/checkout/complete', '/api/billing/payment-method', '/api/billing/portal', '/api/billing/cancel', '/api/billing/resume', '/api/billing/redeem-code'])
    if (!billingRecoveryPaths.has(req.path)) {
      const [[profile]] = await getPool().execute(
        'SELECT profile_enriched_at AS profileEnrichedAt FROM app_users WHERE auth_user_id = ? OR id = ? LIMIT 1',
        [user.id, user.id],
      )
      if (!profile?.profileEnrichedAt) {
        logApi('profile_setup_required', { ...requestContext(req), userId: user.id })
        return res.status(428).json({ message: 'Complete your required profile information before continuing.', code: 'PROFILE_SETUP_REQUIRED' })
      }
      const entitlement = await requireBillingAccess(getPool(), user)
      if (!entitlement) return res.status(402).json({ message: 'Subscription or access code required.', code: 'BILLING_ACCESS_REQUIRED' })
      if (!entitlement.setupComplete) {
        logApi('billing_setup_required', { ...requestContext(req), userId: user.id })
        return res.status(428).json({ message: 'Add a payment method or use a promo code before continuing.', code: 'BILLING_SETUP_REQUIRED' })
      }
      req.billingEntitlement = entitlement
    }
    next()
  } catch (error) {
    logRouteError('Auth middleware error', req, error)
    res.status(500).json({ message: 'Authentication failed' })
  }
}

app.get('/api/billing/status', requireStorage, authMiddleware, async (req, res) => {
  try {
    const status = await getBillingStatus(getPool(), req.user)
    logApi('billing_status_loaded', { ...requestContext(req), accessSource: status.accessSource, accessAllowed: status.accessAllowed, setupComplete: status.setupComplete })
    return res.json(status)
  }
  catch (error) { logRouteError('Billing status error', req, error); return res.status(500).json({ message: 'Could not load billing status.' }) }
})

app.post('/api/billing/checkout', requireStorage, authMiddleware, async (req, res) => {
  try {
    const url = await createCheckout(getPool(), req.user, getClientAppBaseUrl(req))
    logApi('billing_checkout_created', { ...requestContext(req), userId: req.user.id })
    return res.json({ url })
  }
  catch (error) { logRouteError('Billing checkout error', req, error); return res.status(error.statusCode || 500).json({ message: error.message || 'Could not start checkout.' }) }
})

app.post('/api/billing/checkout/complete', requireStorage, authMiddleware, async (req, res) => {
  try {
    const status = await completeCheckout(getPool(), req.user, req.body?.sessionId)
    logApi('billing_checkout_completion_confirmed', { ...requestContext(req), userId: req.user.id, setupComplete: status.setupComplete })
    return res.json(status)
  } catch (error) {
    logRouteError('Billing checkout completion error', req, error, { body: undefined })
    return res.status(error.statusCode || 500).json({ message: error.message || 'Could not confirm Checkout.' })
  }
})

app.post('/api/billing/payment-method', requireStorage, authMiddleware, async (req, res) => {
  try {
    const url = await createPaymentMethodCheckout(getPool(), req.user, getClientAppBaseUrl(req))
    logApi('billing_payment_method_checkout_created', { ...requestContext(req), userId: req.user.id })
    return res.json({ url })
  }
  catch (error) { logRouteError('Billing payment method checkout error', req, error); return res.status(error.statusCode || 500).json({ message: error.message || 'Could not update payment method.' }) }
})

app.post('/api/billing/portal', requireStorage, authMiddleware, async (req, res) => {
  try {
    const url = await createPortal(getPool(), req.user, getClientAppBaseUrl(req))
    logApi('billing_portal_created', { ...requestContext(req), userId: req.user.id })
    return res.json({ url })
  }
  catch (error) { logRouteError('Billing portal error', req, error); return res.status(error.statusCode || 500).json({ message: error.message || 'Could not open billing portal.' }) }
})

app.post('/api/billing/cancel', requireStorage, authMiddleware, async (req, res) => {
  try { const status = await setCancellation(getPool(), req.user, true); logApi('billing_cancellation_scheduled', { ...requestContext(req), userId: req.user.id }); return res.json(status) }
  catch (error) { logRouteError('Billing cancellation error', req, error); return res.status(error.statusCode || 500).json({ message: error.message || 'Could not schedule cancellation.' }) }
})

app.post('/api/billing/resume', requireStorage, authMiddleware, async (req, res) => {
  try { return res.json(await setCancellation(getPool(), req.user, false)) }
  catch (error) { logRouteError('Billing resume error', req, error); return res.status(error.statusCode || 500).json({ message: error.message || 'Could not resume subscription.' }) }
})

app.post('/api/billing/redeem-code', requireStorage, authMiddleware, async (req, res) => {
  try { await redeemAccessCode(getPool(), req.user, req.body?.code); return res.json(await getBillingStatus(getPool(), req.user)) }
  catch (error) { logRouteError('Billing promo-code redemption error', req, error, { body: undefined }); return res.status(error.statusCode || 500).json({ message: error.message || 'Could not redeem access code.' }) }
})

app.get('/api/admin/billing/access-codes', adminMiddleware, async (req, res) => {
  try { const codes = await listAccessCodes(getPool()); logApi('admin_access_codes_loaded', { ...requestContext(req), adminUserId: req.adminUser.id, codeCount: codes.length }); return res.json({ codes }) }
  catch (error) { logRouteError('Admin access-code list error', req, error); return res.status(500).json({ message: 'Could not load access codes.' }) }
})

app.post('/api/admin/billing/access-codes', adminMiddleware, async (req, res) => {
  try { return res.status(201).json({ created: await createAccessCode(getPool(), req.adminUser, req.body), codes: await listAccessCodes(getPool()) }) }
  catch (error) { logRouteError('Admin access-code create error', req, error); return res.status(error.statusCode || 500).json({ message: error.message || 'Could not create access code.' }) }
})

app.patch('/api/admin/billing/access-codes/:id', adminMiddleware, async (req, res) => {
  try { await updateAccessCode(getPool(), req.params.id, req.body || {}); return res.json({ codes: await listAccessCodes(getPool()) }) }
  catch (error) { logRouteError('Admin access-code update error', req, error); return res.status(error.statusCode || 500).json({ message: error.message || 'Could not update access code.' }) }
})

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
  const firstName = String(body.firstName || '').trim().replace(/\s+/g, ' ')
  const lastName = String(body.lastName || '').trim().replace(/\s+/g, ' ')
  const phone = sanitizeProfilePhone(body.phone, 64)
  const primaryCity = normalizeProfileValue(body.primaryCity)
  const primaryState = normalizeProfileValue(body.primaryState)
  const primaryZipCode = normalizeProfileValue(body.primaryZipCode)
  const socialPreferencesEnabled = Boolean(options.socialPreferencesEnabled)
  const alcoholPreference = socialPreferencesEnabled ? (normalizeProfileValue(body.alcoholPreference) || '') : ''
  const cannabisPreference = socialPreferencesEnabled ? (normalizeProfileValue(body.cannabisPreference) || '') : ''
  const sobrietyPreference = socialPreferencesEnabled ? (normalizeProfileValue(body.sobrietyPreference) || '') : ''

  if (!firstName) throw new Error('First name is required.')
  if (!lastName) throw new Error('Last name is required.')
  if (firstName.length > 100 || lastName.length > 100) throw new Error('First and last name must each be 100 characters or less.')
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
    firstName,
    lastName,
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
  const names = splitName(row.name, row.email)
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    firstName: names.firstName,
    lastName: names.lastName,
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



function normalizeHostPortalAccount(account = {}) {
  const golfCourseName = String(account.golfCourseName || account.golf_course_name || account.account_name || account.course_name || account.name || '').trim()
  return {
    ...account,
    id: account.id || null,
    email: account.email || '',
    golfCourseId: account.golfCourseId || account.golf_course_id || null,
    golfCourseName,
    contactName: account.contactName || account.contact_name || null,
    phone: account.phone || null,
    websiteUrl: account.websiteUrl || account.website_url || null,
    notes: account.notes || null,
    isCourseAdmin: Boolean(account.isCourseAdmin ?? account.is_course_admin),
    createdByHostAccountId: account.createdByHostAccountId || account.created_by_host_account_id || null,
    isValidated: Boolean(account.isValidated ?? account.is_validated),
    validatedAt: account.validatedAt || account.validated_at || null,
    createdAt: account.createdAt || account.created_at || null,
    updatedAt: account.updatedAt || account.updated_at || null,
  }
}

function formatTournamentLocationFromCoursePage(page = {}, fallbackName = '') {
  const addressLine = String(page.addressLine1 || page.address_line1 || '').trim()
  const city = String(page.city || '').trim()
  const state = String(page.stateCode || page.state_code || page.state || '').trim()
  const postalCode = String(page.postalCode || page.postal_code || '').trim()
  const cityState = [city, state].filter(Boolean).join(', ')
  const cityStatePostal = [cityState, postalCode].filter(Boolean).join(' ')
  return [addressLine, cityStatePostal].filter(Boolean).join(', ') || String(fallbackName || '').trim()
}

async function resolveHostTournamentDefaultLocation(db, hostAccount, req = null) {
  const normalizedAccount = normalizeHostPortalAccount(hostAccount)
  const context = req ? requestContext(req) : {}
  const hostState = hostAccount?.stateCode || hostAccount?.state_code || hostAccount?.state || ''

  if (normalizedAccount.golfCourseId || normalizedAccount.golfCourseName) {
    try {
      const course = await resolveGolfCourseForState(hostState, normalizedAccount.golfCourseName, normalizedAccount.golfCourseId)
      const courseLocation = formatGolfCoursePhysicalAddress(course)
      if (courseLocation) {
        logApi('host_tournament_default_location_resolved', {
          ...context,
          hostAccountId: normalizedAccount.id,
          golfCourseId: normalizedAccount.golfCourseId || course?.id || null,
          golfCourseName: normalizedAccount.golfCourseName || course?.name || null,
          source: 'golf_course_catalog_account',
          location: courseLocation,
        })
        return courseLocation
      }
    } catch (error) {
      logWarn('host_tournament_account_course_location_lookup_failed', {
        ...context,
        hostAccountId: normalizedAccount.id,
        golfCourseId: normalizedAccount.golfCourseId || null,
        golfCourseName: normalizedAccount.golfCourseName || null,
        error,
      })
    }
  }

  try {
    const publicPage = normalizedAccount.id
      ? await getGolfCoursePublicPageByHostAccount(db, normalizedAccount.id, { baseUrl: req ? getHostAppBaseUrl(req) : '' })
      : null
    const publicPageLocation = formatTournamentLocationFromCoursePage(publicPage, '')
    if (publicPageLocation) {
      logApi('host_tournament_default_location_resolved', {
        ...context,
        hostAccountId: normalizedAccount.id,
        golfCourseName: normalizedAccount.golfCourseName || publicPage?.golfCourseName || null,
        source: 'golf_course_public_page',
        location: publicPageLocation,
      })
      return publicPageLocation
    }
  } catch (error) {
    logWarn('host_tournament_public_page_location_lookup_failed', {
      ...context,
      hostAccountId: normalizedAccount.id,
      golfCourseName: normalizedAccount.golfCourseName || null,
      error,
    })
  }

  if (normalizedAccount.golfCourseName) {
    try {
      const course = await getGolfCourseByName(normalizedAccount.golfCourseName, hostState)
      const courseLocation = formatGolfCoursePhysicalAddress(course)
      if (courseLocation) {
        logApi('host_tournament_default_location_resolved', {
          ...context,
          hostAccountId: normalizedAccount.id,
          golfCourseName: normalizedAccount.golfCourseName,
          source: 'golf_course_catalog',
          location: courseLocation,
        })
        return courseLocation
      }
    } catch (error) {
      logWarn('host_tournament_course_location_lookup_failed', {
        ...context,
        hostAccountId: normalizedAccount.id,
        golfCourseName: normalizedAccount.golfCourseName,
        error,
      })
    }
  }

  const fallbackLocation = normalizedAccount.golfCourseName || ''
  logApi('host_tournament_default_location_resolved', {
    ...context,
    hostAccountId: normalizedAccount.id,
    golfCourseName: normalizedAccount.golfCourseName || null,
    source: fallbackLocation ? 'golf_course_name' : 'unavailable',
    location: fallbackLocation || null,
  })
  return fallbackLocation
}

function applyHostTournamentDefaults(input = {}, { defaultLocation = '', golfCourseName = '' } = {}) {
  const source = input && typeof input === 'object' ? input : {}
  const templateData = source.templateData && typeof source.templateData === 'object' && !Array.isArray(source.templateData)
    ? { ...source.templateData }
    : {}
  const existingLocation = String(templateData.locationAddress || '').trim()
  const resolvedLocation = existingLocation || String(defaultLocation || '').trim()
  const existingHostOrganization = String(templateData.hostOrganization || '').trim()
  const resolvedHostOrganization = existingHostOrganization || String(golfCourseName || '').trim()
  const checkInTime = String(templateData.checkInTime || '').trim() || DEFAULT_TOURNAMENT_CHECK_IN_TIME
  const teeTime = String(templateData.teeTime || '').trim() || DEFAULT_TOURNAMENT_TEE_TIME
  const teeTimeIntervalMinutes = Math.min(60, Math.max(5, Number.parseInt(String(templateData.teeTimeIntervalMinutes || ''), 10) || DEFAULT_TEE_TIME_INTERVAL_MINUTES))
  return {
    ...source,
    templateData: {
      ...templateData,
      locationAddress: resolvedLocation || null,
      hostOrganization: resolvedHostOrganization || null,
      checkInTime,
      teeTime,
      teeTimeIntervalMinutes,
    },
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
    startDate: normalizeTournamentScheduleDate(row.start_date || row.starts_at) || null,
    endDate: normalizeTournamentScheduleDate(row.end_date || row.ends_at) || null,
    status: row.status,
    archivedAt: row.archived_at || null,
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

function getTournamentTeamSizeFromTemplateData(templateData = {}) {
  const source = templateData && typeof templateData === 'object' ? templateData : {}
  const configuredSize = Number(source.tournamentTeamSize)
  if ([2, 3, 4].includes(configuredSize)) return configuredSize
  const legacyMatch = String(source.tournamentFormat || '').match(/\b([234])\b/)
  const legacySize = legacyMatch ? Number(legacyMatch[1]) : 4
  return [2, 3, 4].includes(legacySize) ? legacySize : 4
}

function enforceTournamentTeamSize(members = [], requiredTeamSize = 4) {
  const normalizedRequiredTeamSize = [2, 3, 4].includes(Number(requiredTeamSize)) ? Number(requiredTeamSize) : 4
  if (members.length !== normalizedRequiredTeamSize) {
    throw new Error(`Tournament teams must have exactly ${normalizedRequiredTeamSize} players for this tournament.`)
  }
}

async function resolveRegistrationTeam(pool, body = {}, user, requiredTeamSize = 4) {
  const requestedTeamId = String(body.teamId || '').trim()
  const requesterEmail = normalizeEmail(user?.email)

  if (requestedTeamId) {
    const team = await storage.getTeamById(requestedTeamId)
    if (!team) throw new Error('Selected team was not found.')
    const isMember = (team.members || []).some((member) => normalizeEmail(member.email) === requesterEmail)
    if (!isMember) throw new Error('You must be a member of an existing team to register it for a tournament.')
    enforceTournamentTeamSize(team.members || [], requiredTeamSize)
    return { teamId: team.id, teamName: team.name, teamMembers: team.members || [] }
  }

  const teamName = String(body.teamName || '').trim()
  const rawMembers = Array.isArray(body.teamMembers) ? body.teamMembers : []
  if (!teamName) throw new Error('Team name is required for tournament registration.')
  const normalizedMembers = normalizeCreateTeamMembers(rawMembers, user)
  enforceTournamentTeamSize(normalizedMembers, requiredTeamSize)
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

async function loadTournamentStartAssignmentsSafely(pool, tournamentIds = []) {
  const ids = [...new Set((tournamentIds || []).map((id) => String(id || '').trim()).filter(Boolean))]
  try {
    return await listTournamentStartAssignmentsForTournaments(pool, ids)
  } catch (error) {
    logWarn('tournament_start_assignments_load_failed', { tournamentIds: ids, error })
    return new Map(ids.map((id) => [id, []]))
  }
}

async function attachTournamentRegistrations(pool, tournaments = []) {
  const tournamentIds = tournaments.map((item) => item.id)
  const registrationsByTournament = await listTournamentRegistrations(pool, tournamentIds)
  const startAssignmentsByTournament = await loadTournamentStartAssignmentsSafely(pool, tournamentIds)
  return Promise.all(tournaments.map(async (item) => {
    const registrations = registrationsByTournament.get(String(item.id)) || []
    const withStats = await attachTournamentCapacityStats(pool, item, registrations)
    return { ...withStats, registrations, startAssignments: startAssignmentsByTournament.get(String(item.id)) || [] }
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
  if (!portal || portal.tournament.archivedAt) return { status: 404, body: { message: 'Tournament not found' } }

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
  const startAssignmentsByTournament = await loadTournamentStartAssignmentsSafely(pool, [row.id])
  const startAssignments = startAssignmentsByTournament.get(String(row.id)) || []
  const capacityStats = await buildTournamentCapacityStats(pool, row, registrations)
  const mappedRow = await resolveTournamentGolfCourseAddress({ ...row, registrations, registration_count: registrations.length, registered_team_count: capacityStats.registeredTeamCount, verified_user_count: capacityStats.verifiedUserCount }, req)
  const tournament = { ...mapTournamentPortalRow(mappedRow, req), tournamentIdentifier: row.tournament_identifier || null, ...capacityStats, startAssignments }
  const finalLeaderboard = String(tournament.status || '').toLowerCase() === 'completed'
    ? await loadTournamentFinalLeaderboard(pool, tournament.id, registrations)
    : []
  return { tournament, registrationCount: capacityStats.registeredTeamCount, registrations, startAssignments, finalLeaderboard, ...capacityStats }
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
  const completed = String(publicTournament.status || '').toLowerCase() === 'completed'

  return {
    ...publicPortal,
    startAssignments: completed ? [] : (publicPortal.startAssignments || []),
    finalLeaderboard: completed ? (Array.isArray(publicPortal.finalLeaderboard) ? publicPortal.finalLeaderboard : []) : [],
    tournament: {
      ...publicTournament,
      startAssignments: completed ? [] : (publicTournament.startAssignments || []),
    },
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
  if (!name) throw new Error('Tournament Name is a required field. Enter a tournament name and try again.')
  const status = String(body.status || 'draft').trim()
  const allowedStatuses = new Set(['draft', 'published', 'completed', 'cancelled'])
  const allowedTemplateKeys = new Set(['classic-flyer', 'fairway-poster', 'modern-open', 'charity-tribute', 'sunset-drive', 'green-invite'])
  const templateKey = String(body.templateKey || 'classic-flyer').trim()
  const templateBackgroundImageUrl = String(body.templateBackgroundImageUrl || '').trim()
  const startDate = String(body.startDate || '').trim().slice(0, 10)
  const templateData = sanitizeTournamentTemplateData(body.templateData)
  const registrationDeadline = String(templateData.registrationDeadline || '').trim().slice(0, 10)
  if (!allowedStatuses.has(status)) throw new Error('Tournament Status is invalid. Select Draft, Published, Completed, or Cancelled.')
  if (['published', 'completed'].includes(status) && !startDate) throw new Error('Tournament Start Date is a required field before publishing or completing. Add a tournament date and try again.')
  if (startDate && Number.isNaN(Date.parse(`${startDate}T00:00:00Z`))) throw new Error('Tournament Start Date is invalid. Select a valid calendar date and try again.')
  if (registrationDeadline && Number.isNaN(Date.parse(`${registrationDeadline}T00:00:00Z`))) throw new Error('Registration Deadline is invalid. Select a valid calendar date and try again.')
  if (startDate && registrationDeadline && registrationDeadline > startDate) throw new Error('Registration Deadline cannot be after the Tournament Start Date. Select a deadline on or before the tournament date and try again.')
  if (!allowedTemplateKeys.has(templateKey)) throw new Error('Tournament Template is invalid. Select an available tournament template.')
  return {
    name,
    description: body.description == null ? null : String(body.description).trim() || null,
    startDate: startDate || null,
    endDate: null,
    status,
    isPublic: status === 'published',
    templateKey,
    templateBackgroundImageUrl: templateBackgroundImageUrl || null,
    templateData,
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
    golfCourseId: row.golf_course_id || null,
    email: row.email,
    role: 'host',
    golfCourseName: row.catalog_golf_course_name || row.golf_course_name || row.account_name || row.course_name || row.name || '',
    contactName: row.contact_name || null,
    phone: row.phone || row.catalog_phone || null,
    websiteUrl: row.website_url || null,
    notes: row.notes || null,
    catalogCourse: row.golf_course_id ? {
      id: row.golf_course_id,
      name: row.catalog_golf_course_name || null,
      phone: row.catalog_phone || null,
      websiteUrl: row.catalog_website_url || null,
      addressLine1: row.catalog_address_line1 || null,
      city: row.catalog_city || null,
      stateCode: row.catalog_state_code || null,
      postalCode: row.catalog_postal_code || null,
    } : null,
    isValidated: Boolean(row.is_validated),
    validatedAt: row.validated_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

async function getHostProfile(pool, hostAccountId) {
  await ensureHostAuthSchema(pool)
  const [rows] = await pool.execute(
    `SELECT ha.*,
            gc.name AS catalog_golf_course_name,
            gc.phone AS catalog_phone,
            COALESCE(NULLIF(TRIM(gc.website), ''), NULLIF(TRIM(gc.golf_course_website), '')) AS catalog_website_url,
            gc.address AS catalog_address_line1,
            gc.city AS catalog_city,
            gc.state_code AS catalog_state_code,
            gc.postal_code AS catalog_postal_code
       FROM host_accounts ha
       LEFT JOIN golf_courses gc ON gc.id = ha.golf_course_id
      WHERE ha.id = ?
      LIMIT 1`,
    [hostAccountId],
  )
  return mapHostProfileRow(rows[0] || null)
}

function sanitizeHostProfilePayload(body = {}) {
  return {
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
  if (existing.archived_at) throw new Error('Restore the archived tournament before editing it.')
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
    registrationUrl: ['published', 'completed'].includes(String(row.status || '').toLowerCase()) ? tournamentPortalUrl(req, row.tournament_identifier || row.id) : null,
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
    registrationUrl: ['published', 'completed'].includes(String(row.status || '').toLowerCase()) ? (req ? tournamentPortalUrl(req, row.tournament_identifier || row.id) : tournamentPortalPath(row.tournament_identifier || row.id)) : null,
  }))
  return attachTournamentRegistrations(pool, tournaments)
}

function hostTournamentConflictDetails(tournament, hostAccount) {
  const templateData = tournament?.templateData && typeof tournament.templateData === 'object'
    ? tournament.templateData
    : parseTournamentTemplateData(tournament?.template_data) || {}
  const host = normalizeHostPortalAccount(hostAccount)
  return {
    tournamentId: tournament?.id || null,
    tournamentIdentifier: tournament?.tournamentIdentifier || tournament?.tournament_identifier || null,
    tournamentName: tournament?.name || 'Existing GolfHomiez tournament',
    startDate: normalizeTournamentScheduleDate(tournament?.startDate || tournament?.start_date),
    golfCourseName: tournament?.hostGolfCourseName || tournament?.host_golf_course_name || host.golfCourseName || 'Golf course',
    contactPerson: String(templateData.contactPerson || host.contactName || '').trim() || null,
    contactPhone: String(templateData.contactPhone || host.phone || '').trim() || null,
    contactEmail: normalizeEmail(templateData.contactEmail || tournament?.organizerEmail || host.email) || null,
  }
}

async function findHostTournamentDateConflict(pool, hostAccount, startDate, req = null, excludeTournamentId = null) {
  if (!normalizeTournamentScheduleDate(startDate)) return null
  const tournaments = await listHostPortalTournaments(pool, hostAccount, req)
  const conflict = findTournamentDateConflict(tournaments, startDate, excludeTournamentId)
  return conflict ? hostTournamentConflictDetails(conflict, hostAccount) : null
}

function formatHostTournamentDateConflictMessage(conflict) {
  const contactParts = [conflict.contactPerson, conflict.contactPhone, conflict.contactEmail].filter(Boolean)
  const contactText = contactParts.length ? contactParts.join(' · ') : 'not yet provided'
  return `Another GolfHomiez tournament is already scheduled for ${conflict.golfCourseName} on ${formatTournamentScheduleDate(conflict.startDate)}. Tournament: ${conflict.tournamentName}. Point of Contact: ${contactText}. Choose a different Tournament Start Date.`
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

async function listRegisteredTournamentMessageRecipients(pool, tournamentId) {
  const [rows] = await pool.execute(
    `SELECT auth_user_id, email, name
       FROM tournament_registrations
      WHERE tournament_id = ?
        AND status = 'registered'
      ORDER BY created_at ASC`,
    [tournamentId],
  )
  const recipients = new Map()
  rows.forEach((row) => {
    const email = normalizeEmail(row.email)
    if (!email || recipients.has(email)) return
    recipients.set(email, { id: row.auth_user_id || null, email, name: row.name || null })
  })
  return [...recipients.values()]
}

async function resolveTournamentHostRecipient(pool, tournamentOrId) {
  let tournament = tournamentOrId && typeof tournamentOrId === 'object' ? tournamentOrId : null
  const tournamentId = String(tournament?.id || tournamentOrId || '').trim()
  let hostAccountId = tournament?.host_account_id || tournament?.hostAccountId || null
  if (!hostAccountId && tournamentId) {
    const [[row] = []] = await pool.execute('SELECT host_account_id FROM tournaments WHERE id = ? OR tournament_identifier = ? LIMIT 1', [tournamentId, tournamentId])
    hostAccountId = row?.host_account_id || null
  }
  if (!hostAccountId) return null

  const candidateRows = []
  for (const tableName of ['host_role_accounts', 'host_accounts']) {
    try {
      const columns = await listTableColumns(pool, tableName)
      if (!columns.size) continue
      const [[row] = []] = await pool.execute(`SELECT * FROM ${tableName} WHERE id = ? LIMIT 1`, [hostAccountId])
      if (row) candidateRows.push(row)
    } catch {
      // Continue to the compatibility table when an older environment lacks this table shape.
    }
  }

  for (const row of candidateRows) {
    let email = normalizeEmail(row.email)
    let authUserId = row.auth_user_id || null
    let name = row.contact_name || row.golf_course_name || row.account_name || row.course_name || row.name || null
    if ((!email || !authUserId) && row.role_assignment_id) {
      try {
        const [[assignment] = []] = await pool.execute('SELECT * FROM user_role_assignments WHERE id = ? LIMIT 1', [row.role_assignment_id])
        email = email || normalizeEmail(assignment?.email)
        authUserId = authUserId || assignment?.auth_user_id || null
        name = name || assignment?.name || assignment?.email || null
      } catch {
        // Some reconciled schemas store host identity directly on the host account.
      }
    }
    if (email) return { id: authUserId || row.id || null, email, name: name || email }
  }
  return null
}

async function sendTournamentPortalNotifications({ pool, tournament, sender, senderRole, body, recipientMode, recipientEmails, req }) {
  const normalizedBody = validateNotificationMessageBody(body)
  const registeredRecipients = await listRegisteredTournamentMessageRecipients(pool, tournament.id)
  const byEmail = new Map(registeredRecipients.map((recipient) => [normalizeEmail(recipient.email), recipient]))
  const mode = String(recipientMode || 'selected').trim().toLowerCase()
  const selectedEmails = mode === 'all'
    ? registeredRecipients.map((recipient) => normalizeEmail(recipient.email)).filter(Boolean)
    : [...new Set((Array.isArray(recipientEmails) ? recipientEmails : []).map((email) => normalizeEmail(email)).filter(Boolean))]
  if (!selectedEmails.length) throw new Error('Select at least one registered golfer to receive the tournament message.')
  const invalidEmail = selectedEmails.find((email) => !byEmail.has(email))
  if (invalidEmail) throw new Error(`${invalidEmail} is not a registered golfer for this tournament.`)
  const recipients = selectedEmails.map((email) => byEmail.get(email)).filter(Boolean)
  if (!recipients.length) throw new Error('This tournament does not have any registered golfers to message.')

  const actionUrl = tournamentPortalPath(tournament.tournament_identifier || tournament.tournamentIdentifier || tournament.id)
  const tournamentDescriptor = {
    id: tournament.id,
    name: tournament.name || 'Tournament',
    startDate: tournament.start_date || tournament.startDate || null,
  }
  const host = senderRole === 'host' ? sender : await resolveTournamentHostRecipient(pool, tournament)
  if (!host?.email) throw new Error('The tournament host does not have an email address available for messages.')
  return createTournamentMessageThread(pool, {
    sender,
    senderRole,
    host,
    recipients,
    tournament: tournamentDescriptor,
    body: normalizedBody,
    actionUrl,
    correlationId: req.correlationId || null,
  })
}

async function updateHostOwnedTournament(pool, hostAccount, tournamentId, input, req = null) {
  const existing = await getHostEditableTournament(pool, hostAccount, tournamentId)
  if (!existing) return null
  if (existing.archived_at) throw new Error('Restore the archived tournament before editing it.')
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
    registrationUrl: ['published', 'completed'].includes(String(input.status || '').toLowerCase()) ? tournamentPortalUrl(req, existing.tournament_identifier || existing.id) : null,
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
    if (rejectPasswordPolicy(req, res, password, 'admin', 'reset_password')) return

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

app.get('/api/admin/marketing/home', adminMiddleware, async (req, res) => {
  try {
    const settings = await getHomeMarketingSettings()
    logApi('admin_home_marketing_settings_loaded', {
      ...requestContext(req),
      adminUserId: req.adminUser.id,
      updatedAt: settings.updatedAt || null,
    })
    return res.json(settings)
  } catch (error) {
    logRouteError('Admin home marketing settings load error', req, error, { adminUserId: req.adminUser?.id || null })
    return res.status(500).json({ message: 'Could not load home marketing settings.' })
  }
})

app.put('/api/admin/marketing/home', adminMiddleware, async (req, res) => {
  try {
    logApi('admin_home_marketing_settings_update_started', {
      ...requestContext(req),
      adminUserId: req.adminUser.id,
    })
    const settings = await updateHomeMarketingSettings(req.body, {
      adminUserId: req.adminUser.id,
      correlationId: req.correlationId || null,
    })
    logApi('admin_home_marketing_settings_updated', {
      ...requestContext(req),
      adminUserId: req.adminUser.id,
      updatedAt: settings.updatedAt || null,
    })
    return res.json(settings)
  } catch (error) {
    if (/valid YouTube video URL/i.test(String(error?.message || ''))) {
      logWarn('Admin home marketing settings validation failed', {
        ...requestContext(req),
        adminUserId: req.adminUser?.id || null,
        validationMessage: error.message,
      })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Admin home marketing settings update error', req, error, { adminUserId: req.adminUser?.id || null })
    return res.status(500).json({ message: 'Could not save home marketing settings.' })
  }
})

app.get('/api/admin/marketing/videos', adminMiddleware, async (req, res) => {
  try {
    const sections = await listMarketingVideoSections()
    logApi('admin_marketing_video_sections_loaded', {
      ...requestContext(req),
      adminUserId: req.adminUser.id,
      sectionCount: sections.length,
    })
    return res.json({ sections })
  } catch (error) {
    logRouteError('Admin marketing video sections load error', req, error, { adminUserId: req.adminUser?.id || null })
    return res.status(500).json({ message: 'Could not load marketing video sections.' })
  }
})

app.post('/api/admin/marketing/videos', adminMiddleware, async (req, res) => {
  try {
    logApi('admin_marketing_video_section_create_started', {
      ...requestContext(req),
      adminUserId: req.adminUser.id,
      audience: req.body?.audience || null,
      sectionName: req.body?.name || null,
    })
    const section = await createMarketingVideoSection(req.body, {
      adminUserId: req.adminUser.id,
      correlationId: req.correlationId || null,
    })
    logApi('admin_marketing_video_section_created', {
      ...requestContext(req),
      adminUserId: req.adminUser.id,
      sectionId: section.id,
      audience: section.audience,
      sectionSlug: section.sectionSlug,
      relativeLink: section.relativeLink,
    })
    return res.status(201).json(section)
  } catch (error) {
    if (/Video page must be|Video section name|valid YouTube video URL/i.test(String(error?.message || ''))) {
      logWarn('Admin marketing video section validation failed', {
        ...requestContext(req),
        adminUserId: req.adminUser?.id || null,
        validationMessage: error.message,
      })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Admin marketing video section create error', req, error, { adminUserId: req.adminUser?.id || null })
    return res.status(500).json({ message: 'Could not add marketing video section.' })
  }
})

app.delete('/api/admin/marketing/videos/:sectionId', adminMiddleware, async (req, res) => {
  try {
    const sectionId = String(req.params.sectionId || '').trim()
    logApi('admin_marketing_video_section_delete_started', {
      ...requestContext(req),
      adminUserId: req.adminUser.id,
      sectionId,
    })
    const deleted = await deleteMarketingVideoSection(sectionId)
    if (!deleted) {
      logWarn('Admin marketing video section not found for delete', {
        ...requestContext(req),
        adminUserId: req.adminUser.id,
        sectionId,
      })
      return res.status(404).json({ message: 'Marketing video section was not found.' })
    }
    logApi('admin_marketing_video_section_deleted', {
      ...requestContext(req),
      adminUserId: req.adminUser.id,
      sectionId,
    })
    return res.status(204).end()
  } catch (error) {
    if (/Video section id is required/i.test(String(error?.message || ''))) {
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Admin marketing video section delete error', req, error, { adminUserId: req.adminUser?.id || null })
    return res.status(500).json({ message: 'Could not delete marketing video section.' })
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
      successCount: report.successCount,
      failureCount: report.failureCount,
      successRatePercent: report.successRatePercent,
      averageDurationMs: report.averageDurationMs,
      distinctEndpointCount: report.distinctEndpointCount,
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
    const runOptions = {
      triggeredBy: 'manual',
      correlationId: req.correlationId,
      adminUser: req.adminUser,
      logApi,
      logError,
      logScheduledJob,
    }

    if (shouldRunScheduledJobInBackground(jobId)) {
      const existingJobs = await listScheduledJobs(getPool())
      const existingJob = existingJobs.find((job) => job.id === jobId)
      if (existingJob?.canCancel) {
        return res.status(409).json({ message: `Scheduled job is already running: ${jobId}` })
      }

      const backgroundRun = runScheduledJob(getPool(), jobId, runOptions)
      void backgroundRun.catch((error) => {
        logError('Admin scheduled background job failed after acceptance', {
          correlationId: req.correlationId,
          adminUserId: req.adminUser?.id || null,
          jobId,
          error,
        })
      })

      // runScheduledJob registers the active run synchronously before its first database await.
      // Yield once so a run id can normally be persisted before returning the refreshed job list.
      await new Promise((resolve) => setImmediate(resolve))
      const jobs = await listScheduledJobs(getPool())
      const activeJob = jobs.find((job) => job.id === jobId)
      logApi('admin_scheduled_job_background_run_accepted', {
        ...requestContext(req),
        adminUserId: req.adminUser.id,
        jobId,
        runId: activeJob?.activeRunId || null,
      })
      logScheduledJob('admin_scheduled_job_background_run_accepted', {
        ...requestContext(req),
        adminUserId: req.adminUser.id,
        jobId,
        runId: activeJob?.activeRunId || null,
      })
      return res.status(202).json({
        result: {
          jobId,
          runId: activeJob?.activeRunId || null,
          status: 'running',
          output: null,
          nextRunAt: activeJob?.nextRunAt || null,
          correlationId: req.correlationId,
        },
        jobs,
      })
    }

    const result = await runScheduledJob(getPool(), jobId, runOptions)
    const jobs = await listScheduledJobs(getPool())
    res.json({ result: { jobId: result.job.id, runId: result.runId, status: result.status, output: result.output, nextRunAt: result.nextRunAt, correlationId: req.correlationId }, jobs })
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
    if (rejectPasswordPolicy(req, res, password, 'admin', 'create_account')) return

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
    logApi('host_account_request_approved', { ...requestContext(req), requestId, adminUserId: req.adminUser.id, hostAccountId: result.hostAccountId || null, publicPagePath: result.publicPage?.path || null, publicPageSlug: result.publicPage?.slug || null })
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
    const golfCourseId = String(req.body?.golfCourseId || req.body?.golf_course_id || '').trim()
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
    if (rejectPasswordPolicy(req, res, password, 'golf_course', 'request_account')) return

    const matchedCourse = await findGolfCourseForState(stateCode, golfCourseName, golfCourseId)
    if (!matchedCourse) return res.status(400).json({ message: 'Select a golf course from the database catalog for the selected state.' })

    const request = await createHostAccountRequest({
      firstName,
      lastName,
      email,
      stateCode,
      stateName,
      golfCourseId: matchedCourse.id,
      golfCourseName: matchedCourse.name,
      representativeDetails,
      password,
    })
    logApi('host_account_request_created', { ...requestContext(req), email, golfCourseId: matchedCourse.id, golfCourseName: matchedCourse.name, stateCode, requestId: request.id })
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
    if (rejectPasswordPolicy(req, res, password, 'golf_course', 'reset_password')) return
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
    const account = normalizeHostPortalAccount(data.account || data.host || req.hostAccount)
    const defaultTournamentLocation = await resolveHostTournamentDefaultLocation(db, account, req)
    const portalAccount = {
      ...account,
      golfCourseAddress: defaultTournamentLocation || null,
      defaultTournamentLocation: defaultTournamentLocation || account.golfCourseName || null,
    }
    const tournaments = await listHostPortalTournaments(db, portalAccount, req)
    logApi('host_portal_loaded', {
      ...requestContext(req),
      hostAccountId: portalAccount.id || req.hostAccount.id,
      tournamentCount: tournaments.length,
      defaultTournamentLocationAvailable: Boolean(portalAccount.defaultTournamentLocation),
    })
    const hostAccounts = (data.hostAccounts || []).map((host) => normalizeHostPortalAccount(host))
    res.json({ ...data, account: portalAccount, host: portalAccount, hostAccounts, tournaments })
  } catch (error) {
    logRouteError('Host portal load error', req, error)
    res.status(500).json({ message: 'Could not load golf-course portal' })
  }
})


app.post('/api/host/accounts', hostAuthMiddleware, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)
    const contactName = String(req.body?.contactName || '').trim()
    const password = String(req.body?.password || '')
    logApi('host_additional_account_create_started', { ...requestContext(req), hostAccountId: req.hostAccount.id, email })
    const hostAccount = await createAdditionalHostAccount(getPool(), {
      actingHostAccountId: req.hostAccount.id,
      email,
      contactName,
      password,
    })
    const normalized = normalizeHostPortalAccount(hostAccount)
    logApi('host_additional_account_created', { ...requestContext(req), hostAccountId: req.hostAccount.id, createdHostAccountId: normalized.id, email: normalized.email })
    return res.status(201).json({ hostAccount: normalized })
  } catch (error) {
    if (error instanceof Error && /valid email|host name|Password must|already uses|not available/i.test(error.message)) {
      logApi('host_additional_account_create_rejected', { ...requestContext(req), hostAccountId: req.hostAccount?.id || null, reason: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Additional host account create error', req, error)
    return res.status(500).json({ message: 'The host account could not be created. Try again. If the problem continues, contact support with the correlation ID from this request.' })
  }
})

app.post('/api/host/accounts/admin-transfer', hostAuthMiddleware, async (req, res) => {
  try {
    const targetHostAccountId = String(req.body?.targetHostAccountId || '').trim()
    const deleteCurrentAdmin = Boolean(req.body?.deleteCurrentAdmin)
    logApi('host_admin_transfer_started', { ...requestContext(req), hostAccountId: req.hostAccount.id, targetHostAccountId, deleteCurrentAdmin })
    const result = await transferHostCourseAdmin(getPool(), {
      actingHostAccountId: req.hostAccount.id,
      targetHostAccountId,
      deleteCurrentAdmin,
    })
    if (deleteCurrentAdmin) res.setHeader('Set-Cookie', clearHostSessionCookie())
    logApi('host_admin_transferred', { ...requestContext(req), hostAccountId: req.hostAccount.id, targetHostAccountId: result.targetHostAccountId, deletedCurrentAdmin: result.deletedCurrentAdmin })
    return res.json(result)
  } catch (error) {
    if (error instanceof Error && /Only the golf-course host admin|Select another host|not available/i.test(error.message)) {
      logApi('host_admin_transfer_rejected', { ...requestContext(req), hostAccountId: req.hostAccount?.id || null, reason: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host admin transfer error', req, error)
    return res.status(500).json({ message: 'Admin access could not be transferred. Refresh the portal and try again. If the problem continues, contact support with the correlation ID from this request.' })
  }
})

app.delete('/api/host/accounts/:id', hostAuthMiddleware, async (req, res) => {
  try {
    const targetHostAccountId = String(req.params.id || '').trim()
    logApi('host_account_delete_started', { ...requestContext(req), hostAccountId: req.hostAccount.id, targetHostAccountId })
    const result = await deleteHostCourseAccount(getPool(), { actingHostAccountId: req.hostAccount.id, targetHostAccountId })
    logApi('host_account_deleted', { ...requestContext(req), hostAccountId: req.hostAccount.id, targetHostAccountId })
    return res.json(result)
  } catch (error) {
    if (error instanceof Error && /Only the golf-course host admin|not found|Transfer admin|not available/i.test(error.message)) {
      logApi('host_account_delete_rejected', { ...requestContext(req), hostAccountId: req.hostAccount?.id || null, reason: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host account delete error', req, error)
    return res.status(500).json({ message: 'The host account could not be deleted. Refresh the portal and try again. If the problem continues, contact support with the correlation ID from this request.' })
  }
})

app.get('/api/golf-course-pages/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase()
    if (!slug) return res.status(400).json({ message: 'Golf-course page URL is required.' })
    const page = await getGolfCoursePublicPageBySlug(getPool(), slug, { baseUrl: getHostAppBaseUrl(req) })
    if (!page) {
      logApi('golf_course_public_page_not_found', { ...requestContext(req), slug })
      return res.status(404).json({ message: 'Golf-course page not found.' })
    }
    logApi('golf_course_public_page_loaded', { ...requestContext(req), slug: page.slug, hostAccountId: page.hostAccountId, tournamentCount: page.tournamentCount, calendarAvailable: page.calendarAvailable, calendarPath: page.calendarPath })
    return res.json(page)
  } catch (error) {
    logRouteError('Golf-course public page load error', req, error)
    return res.status(500).json({ message: 'Could not load golf-course page.' })
  }
})


app.get('/api/host/profile', hostAuthMiddleware, async (req, res) => {
  try {
    const db = getPool()
    const profile = await getHostProfile(db, req.hostAccount.id)
    if (!profile) return res.status(404).json({ message: 'Host profile not found' })
    let publicPage = await getGolfCoursePublicPageByHostAccount(db, req.hostAccount.id, { baseUrl: getHostAppBaseUrl(req) })
    if (!publicPage) {
      try {
        publicPage = await createGolfCoursePublicPageForApprovedHost(db, {
          hostAccountId: req.hostAccount.id,
          golfCourseId: profile.golfCourseId || req.hostAccount.golf_course_id || null,
          golfCourseName: profile.golfCourseName,
          baseUrl: getHostAppBaseUrl(req),
        })
        logApi('golf_course_public_page_backfilled', { ...requestContext(req), hostAccountId: profile.id, publicPageSlug: publicPage?.slug || null })
      } catch (backfillError) {
        logWarn('golf_course_public_page_backfill_failed', { ...requestContext(req), hostAccountId: profile.id, error: backfillError })
        publicPage = null
      }
    }
    if (publicPage) {
      publicPage = await syncGolfCoursePublicPageCatalogDefaults(db, req.hostAccount.id, {
        baseUrl: getHostAppBaseUrl(req),
        correlationId: req.correlationId,
      })
    }
    logApi('host_profile_loaded', {
      ...requestContext(req),
      hostAccountId: profile.id,
      publicPageSlug: publicPage?.slug || null,
      accountPhoneFromCatalog: Boolean(profile.catalogCourse?.phone && profile.phone === profile.catalogCourse.phone),
      publicPageCatalogDefaultsLoaded: Boolean(publicPage?.golfCourseId),
    })
    res.json({ ...profile, publicPage })
  } catch (error) {
    logRouteError('Host profile load error', req, error)
    res.status(500).json({ message: 'Could not load host profile' })
  }
})

app.put('/api/host/profile', hostAuthMiddleware, async (req, res) => {
  try {
    logApi('host_profile_update_started', { ...requestContext(req), hostAccountId: req.hostAccount.id, hasNotes: Boolean(String(req.body?.notes ?? '').trim()) })
    const db = getPool()
    const input = sanitizeHostProfilePayload(req.body || {})
    const profile = await updateHostProfile(db, req.hostAccount.id, input)
    let existingPublicPage = await getGolfCoursePublicPageByHostAccount(db, req.hostAccount.id, { baseUrl: getHostAppBaseUrl(req) })
    const publicPageInput = req.body?.publicPage && typeof req.body.publicPage === 'object' ? req.body.publicPage : req.body || {}
    if (!existingPublicPage) {
      existingPublicPage = await createGolfCoursePublicPageForApprovedHost(db, {
        hostAccountId: req.hostAccount.id,
        golfCourseId: profile.golfCourseId || req.hostAccount.golf_course_id || null,
        golfCourseName: profile.golfCourseName,
        stateCode: publicPageInput.stateCode || publicPageInput.publicStateCode || null,
        baseUrl: getHostAppBaseUrl(req),
      })
      logApi('golf_course_public_page_backfilled', { ...requestContext(req), hostAccountId: profile.id, publicPageSlug: existingPublicPage?.slug || null, source: 'host_profile_update' })
    }
    existingPublicPage = await syncGolfCoursePublicPageCatalogDefaults(db, req.hostAccount.id, {
      baseUrl: getHostAppBaseUrl(req),
      correlationId: req.correlationId,
    }) || existingPublicPage
    const publicPage = await updateGolfCoursePublicPageForHost(db, req.hostAccount.id, {
      ...publicPageInput,
      golfCourseName: profile.golfCourseName,
    }, { baseUrl: getHostAppBaseUrl(req) })
    logApi('host_profile_updated', { ...requestContext(req), hostAccountId: profile?.id || req.hostAccount.id, publicPageSlug: publicPage?.slug || null, publicPagePublished: publicPage?.isPublished ?? null })
    res.json({ ...profile, publicPage })
  } catch (error) {
    if (error instanceof Error && /required|invalid|must be|too large|banner/i.test(error.message)) {
      logApi('host_profile_update_rejected', { ...requestContext(req), hostAccountId: req.hostAccount.id, reason: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host profile update error', req, error)
    res.status(500).json({ message: 'Could not update host profile' })
  }
})


async function saveTournamentStartSchedule(pool, tournament, registrations, body, actor, req) {
  const assignments = await replaceTournamentStartAssignments(pool, {
    tournamentId: tournament.id,
    registrations,
    assignments: body?.assignments,
    updatedByAuthUserId: actor,
    correlationId: req.correlationId,
  })
  logApi('tournament_start_schedule_saved', {
    ...requestContext(req),
    tournamentId: tournament.id,
    actor,
    assignmentCount: assignments.length,
    startType: assignments[0]?.startType || null,
  })
  return assignments
}

async function autoCreateTournamentStartSchedule(pool, tournament, registrations, body, actor, req) {
  const startType = normalizeTournamentStartType(body?.startType)
  const firstStartTime = normalizeTournamentStartTime(body?.firstStartTime || body?.teeTime, DEFAULT_TOURNAMENT_TEE_TIME)
  const intervalMinutes = normalizeTeeTimeIntervalMinutes(body?.intervalMinutes, DEFAULT_TEE_TIME_INTERVAL_MINUTES)
  const suggestedAssignments = buildSuggestedTournamentStartAssignments(registrations, {
    tournamentId: tournament.id,
    startType,
    firstStartTime,
    intervalMinutes,
  })
  const currentTemplateData = parseTournamentTemplateData(tournament.template_data) || {}
  await pool.execute(
    'UPDATE tournaments SET template_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [JSON.stringify({ ...currentTemplateData, startType, teeTime: firstStartTime, teeTimeIntervalMinutes: intervalMinutes }), tournament.id],
  )
  const assignments = await replaceTournamentStartAssignments(pool, {
    tournamentId: tournament.id,
    registrations,
    assignments: suggestedAssignments,
    updatedByAuthUserId: actor,
    correlationId: req.correlationId,
  })
  logApi('tournament_start_schedule_auto_created', {
    ...requestContext(req),
    tournamentId: tournament.id,
    actor,
    assignmentCount: assignments.length,
    registeredTeamCount: registrations.length,
    startType,
    firstStartTime,
    intervalMinutes,
  })
  return assignments
}

function isTournamentStartScheduleValidationError(error) {
  return error instanceof Error && /required|registered|schedule|team|time|hole|maximum|appears more than once|no longer registered/i.test(error.message)
}

async function handleHostTournamentArchiveState(req, res, archived) {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const db = getPool()
    const existing = await getHostEditableTournament(db, req.hostAccount, tournamentId)
    if (!existing) {
      logApi('host_tournament_archive_not_found', { ...requestContext(req), hostAccountId: req.hostAccount?.id || null, tournamentId, archived })
      return res.status(404).json({ message: 'Tournament not found for this golf-course account.' })
    }

    const state = await setTournamentArchiveState(db, existing.id, archived)
    const portal = await getTournamentPortalById(db, existing.id, req)
    const tournament = portal?.tournament || null
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this golf-course account.' })

    const context = requestContext(req)
    const searchRecord = await syncGolfHomiezTournamentSearchRecord(db, tournament.id, {
      correlationId: context.correlationId,
      tournamentUrl: !archived && tournament.status === 'published' ? tournamentPortalUrl(req, tournament.tournamentIdentifier || tournament.id) : null,
    })
    logApi('golfhomiez_tournament_search_record_synced', { ...context, hostAccountId: req.hostAccount.id, tournamentId: tournament.id, status: tournament.status, archived: Boolean(tournament.archivedAt), ...searchRecord })
    logApi(archived ? 'host_tournament_archived' : 'host_tournament_restored', {
      ...context,
      hostAccountId: req.hostAccount.id,
      tournamentId: tournament.id,
      tournamentIdentifier: tournament.tournamentIdentifier || null,
      status: tournament.status,
      archivedAt: tournament.archivedAt || null,
      changed: state.changed,
    })
    return res.json(tournament)
  } catch (error) {
    logRouteError(archived ? 'Host tournament archive error' : 'Host tournament restore error', req, error)
    return res.status(500).json({ message: archived ? 'The tournament could not be archived. Try again.' : 'The tournament could not be restored. Try again.' })
  }
}

async function handleOrganizerTournamentArchiveState(req, res, archived) {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const db = getPool()
    const existing = await getOrganizerEditableTournament(db, req.organizerUser, tournamentId)
    if (!existing) {
      logApi('organizer_tournament_archive_not_found', { ...requestContext(req), tournamentId, email: normalizeEmail(req.organizerUser?.email), archived })
      return res.status(404).json({ message: 'Tournament not found for this organizer invitation.' })
    }

    const state = await setTournamentArchiveState(db, existing.id, archived)
    const portal = await getTournamentPortalById(db, existing.id, req)
    const tournament = portal?.tournament || null
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this organizer invitation.' })

    const context = requestContext(req)
    const searchRecord = await syncGolfHomiezTournamentSearchRecord(db, tournament.id, {
      correlationId: context.correlationId,
      tournamentUrl: !archived && tournament.status === 'published' ? tournamentPortalUrl(req, tournament.tournamentIdentifier || tournament.id) : null,
    })
    logApi('golfhomiez_tournament_search_record_synced', { ...context, tournamentId: tournament.id, status: tournament.status, archived: Boolean(tournament.archivedAt), organizerEmail: normalizeEmail(req.organizerUser?.email), ...searchRecord })
    logApi(archived ? 'organizer_tournament_archived' : 'organizer_tournament_restored', {
      ...context,
      tournamentId: tournament.id,
      tournamentIdentifier: tournament.tournamentIdentifier || null,
      status: tournament.status,
      archivedAt: tournament.archivedAt || null,
      changed: state.changed,
      email: normalizeEmail(req.organizerUser?.email),
    })
    return res.json(tournament)
  } catch (error) {
    logRouteError(archived ? 'Organizer tournament archive error' : 'Organizer tournament restore error', req, error)
    return res.status(500).json({ message: archived ? 'The tournament could not be archived. Try again.' : 'The tournament could not be restored. Try again.' })
  }
}

app.post('/api/host/tournaments', hostAuthMiddleware, async (req, res) => {
  try {
    const db = getPool()
    await ensureTournamentInviteSchema(db)
    const context = requestContext(req)
    const userTimeZone = requestUserTimeZone(req)
    const defaultTournamentLocation = await resolveHostTournamentDefaultLocation(db, req.hostAccount, req)
    const golfCourseName = normalizeHostPortalAccount(req.hostAccount).golfCourseName
    const input = applyHostTournamentDefaults(req.body || {}, { defaultLocation: defaultTournamentLocation, golfCourseName })
    const submittedLocation = String(req.body?.templateData?.locationAddress || '').trim()
    const submittedHostOrganization = String(req.body?.templateData?.hostOrganization || '').trim()
    const submittedCheckInTime = String(req.body?.templateData?.checkInTime || '').trim()
    const submittedTeeTime = String(req.body?.templateData?.teeTime || '').trim()
    logApi('host_tournament_create_started', {
      ...context,
      hostAccountId: req.hostAccount.id,
      nameProvided: Boolean(String(input.name || '').trim()),
      tournamentEmailProvided: Boolean(String(input.organizerEmail || input.email || '').trim()),
      organizerInviteRequested: Boolean(String(input.organizerEmail || input.email || '').trim()),
      defaultLocationApplied: Boolean(!submittedLocation && input.templateData?.locationAddress),
      defaultHostOrganizationApplied: Boolean(!submittedHostOrganization && input.templateData?.hostOrganization),
      defaultCheckInTimeApplied: Boolean(!submittedCheckInTime && input.templateData?.checkInTime === DEFAULT_TOURNAMENT_CHECK_IN_TIME),
      defaultTeeTimeApplied: Boolean(!submittedTeeTime && input.templateData?.teeTime === DEFAULT_TOURNAMENT_TEE_TIME),
      optionalContentProvided: Boolean(input.description || input.startDate || submittedLocation),
      userTimeZone,
      requestedStartDate: normalizeTournamentScheduleDate(input.startDate) || null,
    })
    const dateConflict = await findHostTournamentDateConflict(db, req.hostAccount, input.startDate, req)
    if (dateConflict) {
      const message = formatHostTournamentDateConflictMessage(dateConflict)
      logApi('host_tournament_date_conflict_detected', {
        ...context,
        hostAccountId: req.hostAccount.id,
        requestedStartDate: normalizeTournamentScheduleDate(input.startDate),
        conflictingTournamentId: dateConflict.tournamentId,
        conflictingTournamentIdentifier: dateConflict.tournamentIdentifier,
        golfCourseName: dateConflict.golfCourseName,
      })
      return res.status(409).json({ message, code: 'TOURNAMENT_DATE_CONFLICT', conflict: dateConflict })
    }
    const tournament = await createHostManagedTournament(db, req.hostAccount.id, input)
    const searchRecord = await syncGolfHomiezTournamentSearchRecord(db, tournament.id, {
      correlationId: context.correlationId,
      tournamentUrl: tournament.status === 'published' ? tournamentPortalUrl(req, tournament.tournamentIdentifier || tournament.id) : null,
    })
    logApi('golfhomiez_tournament_search_record_synced', { ...context, hostAccountId: req.hostAccount.id, tournamentId: tournament.id, status: tournament.status, ...searchRecord })
    logApi('host_tournament_created', {
      ...context,
      hostAccountId: req.hostAccount.id,
      tournamentId: tournament.id,
      tournamentIdentifier: tournament.tournamentIdentifier,
      name: tournament.name,
      tournamentEmail: tournament.organizerEmail || normalizeEmail(input.organizerEmail || input.email),
      organizerInviteRequested: Boolean(tournament.organizerEmail || normalizeEmail(input.organizerEmail || input.email)),
      defaultLocationApplied: Boolean(!submittedLocation && input.templateData?.locationAddress),
      defaultHostOrganizationApplied: Boolean(!submittedHostOrganization && input.templateData?.hostOrganization),
      checkInTime: input.templateData?.checkInTime || null,
      teeTime: input.templateData?.teeTime || null,
      templateKey: tournament.templateKey || input.templateKey || 'classic-flyer',
      tournamentTeamSize: getTournamentTeamSizeFromTemplateData(input.templateData),
      userTimeZone,
      storedStartDate: normalizeTournamentScheduleDate(tournament.startDate) || null,
    })
    res.status(201).json({ tournament })
  } catch (error) {
    if (error instanceof Error && /Tournament|required|invalid|email/i.test(error.message)) {
      logApi('host_tournament_create_validation_failed', { ...requestContext(req), hostAccountId: req.hostAccount?.id || null, validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host tournament create error', req, error)
    res.status(500).json({ message: 'The tournament could not be created. Review the form and try again. If the problem continues, contact support with the correlation ID from this request.' })
  }
})

app.put('/api/host/tournaments/:id', hostAuthMiddleware, async (req, res) => {
  try {
    const userTimeZone = requestUserTimeZone(req)
    const tournamentId = String(req.params.id || '').trim()
    const input = sanitizeOrganizerTournamentUpdatePayload(req.body || {})
    const db = getPool()
    const existingTournament = await getHostEditableTournament(db, req.hostAccount, tournamentId)
    if (!existingTournament) {
      logApi('host_tournament_update_not_found', { ...requestContext(req), hostAccountId: req.hostAccount?.id || null, tournamentId })
      return res.status(404).json({ message: 'Tournament not found for this golf-course account.' })
    }
    const requestedStartDate = input.startDate || null
    const dateConflict = await findHostTournamentDateConflict(db, req.hostAccount, requestedStartDate, req, existingTournament.id)
    if (dateConflict) {
      const context = requestContext(req)
      const message = formatHostTournamentDateConflictMessage(dateConflict)
      logApi('host_tournament_update_date_conflict_detected', {
        ...context,
        hostAccountId: req.hostAccount.id,
        tournamentId: existingTournament.id,
        requestedStartDate: normalizeTournamentScheduleDate(requestedStartDate),
        conflictingTournamentId: dateConflict.tournamentId,
        conflictingTournamentIdentifier: dateConflict.tournamentIdentifier,
        golfCourseName: dateConflict.golfCourseName,
      })
      return res.status(409).json({ message, code: 'TOURNAMENT_DATE_CONFLICT', conflict: dateConflict })
    }
    const tournament = await updateHostOwnedTournament(db, req.hostAccount, tournamentId, input, req)
    if (!tournament) {
      logApi('host_tournament_update_not_found', { ...requestContext(req), hostAccountId: req.hostAccount?.id || null, tournamentId })
      return res.status(404).json({ message: 'Tournament not found for this golf-course account.' })
    }
    const context = requestContext(req)
    const searchRecord = await syncGolfHomiezTournamentSearchRecord(getPool(), tournament.id, {
      correlationId: context.correlationId,
      tournamentUrl: tournament.status === 'published' ? tournamentPortalUrl(req, tournament.tournamentIdentifier || tournament.id) : null,
    })
    logApi('golfhomiez_tournament_search_record_synced', { ...context, hostAccountId: req.hostAccount.id, tournamentId: tournament.id, status: tournament.status, ...searchRecord })
    logApi('host_tournament_updated', { ...context, hostAccountId: req.hostAccount.id, tournamentId: tournament.id, status: tournament.status, templateKey: tournament.templateKey || input.templateKey || 'classic-flyer', teamSlotLimit: tournament.teamSlotLimit, registeredTeamCount: tournament.registeredTeamCount, openTeamSlotCount: tournament.openTeamSlotCount, tournamentSummaryPresent: Boolean(input.templateData?.tournamentSummary), tournamentSummaryLength: String(input.templateData?.tournamentSummary || '').length, tournamentTeamSize: getTournamentTeamSizeFromTemplateData(input.templateData), userTimeZone, requestedStartDate: normalizeTournamentScheduleDate(input.startDate) || null, storedStartDate: normalizeTournamentScheduleDate(tournament.startDate) || null })
    res.json(tournament)
  } catch (error) {
    if (error instanceof Error && /required|invalid|cannot be after|Restore the archived/i.test(error.message)) {
      logApi('host_tournament_update_validation_failed', { ...requestContext(req), validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host tournament update error', req, error)
    res.status(500).json({ message: 'The tournament could not be saved. Review the form and try again. If the problem continues, contact support with the correlation ID from this request.' })
  }
})


app.post('/api/host/tournaments/:id/archive', hostAuthMiddleware, async (req, res) => handleHostTournamentArchiveState(req, res, true))
app.post('/api/host/tournaments/:id/restore', hostAuthMiddleware, async (req, res) => handleHostTournamentArchiveState(req, res, false))


app.get('/api/host/tournaments/:id/messages', hostAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const db = getPool()
    const tournament = await getHostEditableTournament(db, req.hostAccount, tournamentId)
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this golf-course account.' })
    const host = normalizeHostPortalAccount(req.hostAccount)
    const result = await listTournamentMessageThreads(db, tournament.id, { role: 'host', id: host.authUserId || host.id || null, email: host.email })
    logApi('host_tournament_messages_loaded', { ...requestContext(req), tournamentId: tournament.id, threadCount: result.totalThreads, messageCount: result.totalMessages, unreadCount: result.unreadCount })
    return res.json(result)
  } catch (error) {
    logRouteError('Host tournament messages load error', req, error)
    return res.status(500).json({ message: 'Tournament messages could not be loaded.' })
  }
})

app.patch('/api/host/tournaments/:id/messages/read', hostAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const db = getPool()
    const tournament = await getHostEditableTournament(db, req.hostAccount, tournamentId)
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this golf-course account.' })
    const host = normalizeHostPortalAccount(req.hostAccount)
    const state = await markTournamentMessagesRead(db, tournament.id, { role: 'host', id: host.authUserId || host.id || null, email: host.email })
    logApi('host_tournament_messages_marked_read', { ...requestContext(req), tournamentId: tournament.id })
    return res.json({ ok: true, ...state })
  } catch (error) {
    logRouteError('Host tournament messages mark-read error', req, error)
    return res.status(500).json({ message: 'Tournament message notifications could not be marked read.' })
  }
})

app.post('/api/host/tournaments/:id/messages', hostAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const db = getPool()
    const tournament = await getHostEditableTournament(db, req.hostAccount, tournamentId)
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this golf-course account.' })
    const host = normalizeHostPortalAccount(req.hostAccount)
    const result = await sendTournamentPortalNotifications({
      pool: db,
      tournament,
      sender: { id: host.authUserId || host.id || null, email: host.email, name: host.contactName || host.golfCourseName || 'Tournament host' },
      senderRole: 'host',
      body: req.body?.body,
      recipientMode: req.body?.recipientMode,
      recipientEmails: req.body?.recipientEmails,
      req,
    })
    logApi('host_tournament_messages_sent', { ...requestContext(req), tournamentId: tournament.id, threadId: result.threadId, sentCount: result.sentCount, recipientEmails: result.recipientEmails })
    return res.status(201).json({ ok: true, sentCount: result.sentCount, threadId: result.threadId })
  } catch (error) {
    if (error instanceof Error && /required|characters|registered golfer|Select at least one|host does not have/i.test(error.message)) {
      logApi('host_tournament_messages_validation_failed', { ...requestContext(req), tournamentId: req.params.id, validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host tournament messages send error', req, error)
    return res.status(500).json({ message: 'Tournament messages could not be sent.' })
  }
})

app.post('/api/host/tournaments/:id/message-threads/:threadId/messages', hostAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const db = getPool()
    const tournament = await getHostEditableTournament(db, req.hostAccount, tournamentId)
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this golf-course account.' })
    const host = normalizeHostPortalAccount(req.hostAccount)
    const conversation = await appendTournamentPortalMessage(db, {
      tournamentId: tournament.id,
      threadId: req.params.threadId,
      sender: { id: host.authUserId || host.id || null, email: host.email, name: host.contactName || host.golfCourseName || 'Tournament host' },
      senderRole: 'host',
      body: req.body?.body,
      correlationId: req.correlationId || null,
    })
    if (!conversation) return res.status(404).json({ message: 'Tournament message thread not found.' })
    logApi('host_tournament_message_reply_sent', { ...requestContext(req), tournamentId: tournament.id, threadId: conversation.id, recipientCount: conversation.recipients.length })
    return res.status(201).json({ ok: true, conversation })
  } catch (error) {
    if (error instanceof Error && /required|characters/i.test(error.message)) return res.status(400).json({ message: error.message })
    logRouteError('Host tournament message reply error', req, error)
    return res.status(500).json({ message: 'The tournament message reply could not be sent.' })
  }
})

app.post('/api/host/tournaments/:id/start-schedule/auto', hostAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const db = getPool()
    const tournament = await getHostEditableTournament(db, req.hostAccount, tournamentId)
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this golf-course account.' })
    if (tournament.archived_at) return res.status(409).json({ message: 'Restore the archived tournament before changing its team start schedule.' })
    const registrationsByTournament = await listTournamentRegistrations(db, [tournament.id])
    const registrations = registrationsByTournament.get(String(tournament.id)) || []
    const assignments = await autoCreateTournamentStartSchedule(db, tournament, registrations, req.body || {}, req.hostAccount.authUserId || req.hostAccount.id, req)
    return res.json({ assignments })
  } catch (error) {
    if (isTournamentStartScheduleValidationError(error)) {
      logApi('host_tournament_start_schedule_validation_failed', { ...requestContext(req), tournamentId: req.params.id, validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host tournament start schedule auto-create error', req, error)
    return res.status(500).json({ message: 'The team start schedule could not be created. Refresh the tournament and try again.' })
  }
})

app.put('/api/host/tournaments/:id/start-schedule', hostAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const db = getPool()
    const tournament = await getHostEditableTournament(db, req.hostAccount, tournamentId)
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this golf-course account.' })
    if (tournament.archived_at) return res.status(409).json({ message: 'Restore the archived tournament before changing its team start schedule.' })
    const registrationsByTournament = await listTournamentRegistrations(db, [tournament.id])
    const registrations = registrationsByTournament.get(String(tournament.id)) || []
    const assignments = await saveTournamentStartSchedule(db, tournament, registrations, req.body || {}, req.hostAccount.authUserId || req.hostAccount.id, req)
    return res.json({ assignments })
  } catch (error) {
    if (isTournamentStartScheduleValidationError(error)) {
      logApi('host_tournament_start_schedule_validation_failed', { ...requestContext(req), tournamentId: req.params.id, validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Host tournament start schedule save error', req, error)
    return res.status(500).json({ message: 'The team start schedule could not be saved. Review the assignments and try again.' })
  }
})


app.post('/api/host/tournaments/:id/invite', hostAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    if (!tournamentId) return res.status(400).json({ message: 'Tournament id is required.' })
    const payload = sanitizeOrganizerTournamentInvitePayload(req.body || {})
    const db = getPool()
    await ensureTournamentInviteSchema(db)
    const tournaments = await listHostPortalTournaments(db, req.hostAccount, req)
    const tournament = tournaments.find((item) => item.id === tournamentId)
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this host account.' })
    if (tournament.archivedAt) return res.status(409).json({ message: 'Restore the archived tournament before inviting an organizer.' })
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
    const context = requestContext(req)
    const searchRecord = await syncGolfHomiezTournamentSearchRecord(getPool(), tournament.id, {
      correlationId: context.correlationId,
      tournamentUrl: tournament.status === 'published' ? tournamentPortalUrl(req, tournament.tournamentIdentifier || tournament.id) : null,
    })
    logApi('golfhomiez_tournament_search_record_synced', { ...context, tournamentId: tournament.id, status: tournament.status, organizerEmail: normalizeEmail(req.organizerUser?.email), ...searchRecord })
    logApi('organizer_tournament_updated', { ...context, tournamentId: tournament.id, status: tournament.status, templateKey: tournament.templateKey || input.templateKey || 'classic-flyer', teamSlotLimit: tournament.teamSlotLimit, registeredTeamCount: tournament.registeredTeamCount, openTeamSlotCount: tournament.openTeamSlotCount, tournamentSummaryPresent: Boolean(input.templateData?.tournamentSummary), tournamentSummaryLength: String(input.templateData?.tournamentSummary || '').length, tournamentTeamSize: getTournamentTeamSizeFromTemplateData(input.templateData), email: normalizeEmail(req.organizerUser?.email) })
    res.json(tournament)
  } catch (error) {
    if (error instanceof Error && /required|invalid|cannot be after|Restore the archived/i.test(error.message)) {
      logApi('organizer_tournament_update_validation_failed', { ...requestContext(req), validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Organizer tournament update error', req, error)
    res.status(500).json({ message: 'The tournament could not be saved. Review the form and try again. If the problem continues, contact support with the correlation ID from this request.' })
  }
})


app.post('/api/organizer/tournaments/:id/archive', requireStorage, organizerAuthMiddleware, async (req, res) => handleOrganizerTournamentArchiveState(req, res, true))
app.post('/api/organizer/tournaments/:id/restore', requireStorage, organizerAuthMiddleware, async (req, res) => handleOrganizerTournamentArchiveState(req, res, false))


app.get('/api/organizer/tournaments/:id/messages', requireStorage, organizerAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const db = getPool()
    const tournament = await getOrganizerEditableTournament(db, req.organizerUser, tournamentId)
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this organizer invitation.' })
    const result = await listTournamentMessageThreads(db, tournament.id, { role: 'organizer', id: req.organizerUser?.id || null, email: req.organizerUser?.email || '' })
    logApi('organizer_tournament_messages_loaded', { ...requestContext(req), tournamentId: tournament.id, threadCount: result.totalThreads, messageCount: result.totalMessages, unreadCount: result.unreadCount })
    return res.json(result)
  } catch (error) {
    logRouteError('Organizer tournament messages load error', req, error)
    return res.status(500).json({ message: 'Tournament messages could not be loaded.' })
  }
})

app.patch('/api/organizer/tournaments/:id/messages/read', requireStorage, organizerAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const db = getPool()
    const tournament = await getOrganizerEditableTournament(db, req.organizerUser, tournamentId)
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this organizer invitation.' })
    const state = await markTournamentMessagesRead(db, tournament.id, { role: 'organizer', id: req.organizerUser?.id || null, email: req.organizerUser?.email || '' })
    logApi('organizer_tournament_messages_marked_read', { ...requestContext(req), tournamentId: tournament.id })
    return res.json({ ok: true, ...state })
  } catch (error) {
    logRouteError('Organizer tournament messages mark-read error', req, error)
    return res.status(500).json({ message: 'Tournament message notifications could not be marked read.' })
  }
})

app.post('/api/organizer/tournaments/:id/messages', requireStorage, organizerAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const db = getPool()
    const tournament = await getOrganizerEditableTournament(db, req.organizerUser, tournamentId)
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this organizer invitation.' })
    const organizerName = req.organizerUser?.name || req.organizerUser?.organizationName || req.organizerUser?.contactName || 'Tournament organizer'
    const result = await sendTournamentPortalNotifications({
      pool: db,
      tournament,
      sender: { id: req.organizerUser?.id || null, email: req.organizerUser?.email || '', name: organizerName },
      senderRole: 'organizer',
      body: req.body?.body,
      recipientMode: req.body?.recipientMode,
      recipientEmails: req.body?.recipientEmails,
      req,
    })
    logApi('organizer_tournament_messages_sent', { ...requestContext(req), tournamentId: tournament.id, threadId: result.threadId, sentCount: result.sentCount, recipientEmails: result.recipientEmails })
    return res.status(201).json({ ok: true, sentCount: result.sentCount, threadId: result.threadId })
  } catch (error) {
    if (error instanceof Error && /required|characters|registered golfer|Select at least one|host does not have/i.test(error.message)) {
      logApi('organizer_tournament_messages_validation_failed', { ...requestContext(req), tournamentId: req.params.id, validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Organizer tournament messages send error', req, error)
    return res.status(500).json({ message: 'Tournament messages could not be sent.' })
  }
})

app.post('/api/organizer/tournaments/:id/message-threads/:threadId/messages', requireStorage, organizerAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const db = getPool()
    const tournament = await getOrganizerEditableTournament(db, req.organizerUser, tournamentId)
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this organizer invitation.' })
    const organizerName = req.organizerUser?.name || req.organizerUser?.organizationName || req.organizerUser?.contactName || 'Tournament organizer'
    const conversation = await appendTournamentPortalMessage(db, {
      tournamentId: tournament.id,
      threadId: req.params.threadId,
      sender: { id: req.organizerUser?.id || null, email: req.organizerUser?.email || '', name: organizerName },
      senderRole: 'organizer',
      body: req.body?.body,
      correlationId: req.correlationId || null,
    })
    if (!conversation) return res.status(404).json({ message: 'Tournament message thread not found.' })
    logApi('organizer_tournament_message_reply_sent', { ...requestContext(req), tournamentId: tournament.id, threadId: conversation.id, recipientCount: conversation.recipients.length })
    return res.status(201).json({ ok: true, conversation })
  } catch (error) {
    if (error instanceof Error && /required|characters/i.test(error.message)) return res.status(400).json({ message: error.message })
    logRouteError('Organizer tournament message reply error', req, error)
    return res.status(500).json({ message: 'The tournament message reply could not be sent.' })
  }
})

app.post('/api/organizer/tournaments/:id/start-schedule/auto', requireStorage, organizerAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const db = getPool()
    const tournament = await getOrganizerEditableTournament(db, req.organizerUser, tournamentId)
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this organizer invitation.' })
    if (tournament.archived_at) return res.status(409).json({ message: 'Restore the archived tournament before changing its team start schedule.' })
    const registrationsByTournament = await listTournamentRegistrations(db, [tournament.id])
    const registrations = registrationsByTournament.get(String(tournament.id)) || []
    const assignments = await autoCreateTournamentStartSchedule(db, tournament, registrations, req.body || {}, req.organizerUser.id, req)
    return res.json({ assignments })
  } catch (error) {
    if (isTournamentStartScheduleValidationError(error)) {
      logApi('organizer_tournament_start_schedule_validation_failed', { ...requestContext(req), tournamentId: req.params.id, validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Organizer tournament start schedule auto-create error', req, error)
    return res.status(500).json({ message: 'The team start schedule could not be created. Refresh the tournament and try again.' })
  }
})

app.put('/api/organizer/tournaments/:id/start-schedule', requireStorage, organizerAuthMiddleware, async (req, res) => {
  try {
    const tournamentId = String(req.params.id || '').trim()
    const db = getPool()
    const tournament = await getOrganizerEditableTournament(db, req.organizerUser, tournamentId)
    if (!tournament) return res.status(404).json({ message: 'Tournament not found for this organizer invitation.' })
    if (tournament.archived_at) return res.status(409).json({ message: 'Restore the archived tournament before changing its team start schedule.' })
    const registrationsByTournament = await listTournamentRegistrations(db, [tournament.id])
    const registrations = registrationsByTournament.get(String(tournament.id)) || []
    const assignments = await saveTournamentStartSchedule(db, tournament, registrations, req.body || {}, req.organizerUser.id, req)
    return res.json({ assignments })
  } catch (error) {
    if (isTournamentStartScheduleValidationError(error)) {
      logApi('organizer_tournament_start_schedule_validation_failed', { ...requestContext(req), tournamentId: req.params.id, validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Organizer tournament start schedule save error', req, error)
    return res.status(500).json({ message: 'The team start schedule could not be saved. Review the assignments and try again.' })
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
    if (rejectPasswordPolicy(req, res, password, 'organizer', 'register_account')) return
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
    if (rejectPasswordPolicy(req, res, password, 'organizer', 'reset_password')) return
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
    if (!portal) {
      logApi('tournament_portal_qr_code_not_found', { ...requestContext(req), tournamentId: id })
      return res.status(404).type('text/plain').send('Tournament not found')
    }
    const portalStatus = String(portal.tournament.status || '').toLowerCase()
    if (portal.tournament.archivedAt || !['published', 'completed'].includes(portalStatus)) {
      logApi('tournament_portal_qr_code_not_found', { ...requestContext(req), tournamentId: id, portalStatus, archived: Boolean(portal.tournament.archivedAt), reason: portal.tournament.archivedAt ? 'archived' : 'not_public' })
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
    const portalStatus = String(portal.tournament.status || '').toLowerCase()
    if (portal.tournament.archivedAt || !['published', 'completed'].includes(portalStatus)) return res.status(404).json({ message: 'Tournament not found' })

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

    const completed = String(portal.tournament.status || '').toLowerCase() === 'completed'
    logApi('tournament_portal_loaded', { ...requestContext(req), tournamentId: id, tournamentStatus: portal.tournament.status, registrationCount: portal.registrationCount, registeredTeamCount: portal.registeredTeamCount, verifiedUserCount: portal.verifiedUserCount, teamSlotLimit: portal.teamSlotLimit, openTeamSlotCount: portal.openTeamSlotCount, viewerRegistered: Boolean(viewerRegistration), publicResponseIncludesTeamRoster: false, finalLeaderboardTeamCount: completed ? Number(portal.finalLeaderboard?.length || 0) : 0 })
    if (completed) {
      logApi('completed_tournament_final_leaderboard_loaded', { ...requestContext(req), tournamentId: portal.tournament.id, tournamentIdentifier: portal.tournament.tournamentIdentifier || null, teamCount: Number(portal.finalLeaderboard?.length || 0) })
    }
    const response = publicTournamentPortalResponse(portal, viewerRegistration)
    res.json(response)
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
    if (portal.tournament.archivedAt || portal.tournament.status === 'cancelled' || portal.tournament.status === 'completed') return res.status(400).json({ message: 'Tournament registration is closed.' })
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

    const requiredTeamSize = getTournamentTeamSizeFromTemplateData(portal.tournament.templateData)
    logApi('tournament_registration_team_size_checked', { ...requestContext(req), tournamentId: resolvedTournamentId, requestedTournamentId: tournamentId, requiredTeamSize })
    const registrationTeam = await resolveRegistrationTeam(pool, req.body || {}, req.user, requiredTeamSize)
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
      await createTournamentNotification(pool, {
        sender: { id: null, email: '', name: portal.tournament.hostGolfCourseName || portal.tournament.organizerName || 'GolfHomiez' },
        recipient: { id: req.user.id, email: req.user.email, name: req.user.name || null },
        tournament: { id: resolvedTournamentId, name: portal.tournament.name, startDate: portal.tournament.startDate || null },
        body: `Registration confirmed for ${portal.tournament.name}.`,
        actionUrl: tournamentPortalPath(portal.tournament.tournamentIdentifier || resolvedTournamentId),
        correlationId: req.correlationId || null,
        senderRole: 'system',
      })
      logApi('tournament_registration_notification_created', { ...requestContext(req), tournamentId: resolvedTournamentId, authUserId: req.user.id })
    } catch (notificationError) {
      logRouteError('Tournament registration notification error', req, notificationError, { tournamentId: resolvedTournamentId, authUserId: req.user.id })
    }
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
    logApi('tournament_registration_completed', { ...requestContext(req), tournamentId: resolvedTournamentId, requestedTournamentId: tournamentId, authUserId: req.user.id, email: registeredEmail, requiredTeamSize, teamSlotLimit: portal.tournament.teamSlotLimit, teamAlreadyRegistered, registeredTeamCount: Number(portal.tournament.registeredTeamCount || 0) + (teamAlreadyRegistered ? 0 : 1), openTeamSlotCount: Math.max(Number(portal.tournament.openTeamSlotCount || 0) - (teamAlreadyRegistered ? 0 : 1), 0) })
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



app.get('/api/users/golf-course-search', requireStorage, authMiddleware, async (req, res) => {
  try {
    logApi('user_golf_course_search_started', { ...requestContext(req), authUserId: req.user.id })
    const result = await searchGolfHomiezCourses(getPool(), {
      state: req.query.state,
      city: req.query.city,
      zipCode: req.query.zipCode,
      golfCourseName: req.query.golfCourseName,
    }, {
      page: req.query.page,
    })
    logApi('user_golf_course_search_completed', {
      ...requestContext(req),
      authUserId: req.user.id,
      filters: result.filters,
      page: result.pagination.page,
      pageSize: result.pagination.pageSize,
      resultCount: result.courses.length,
      totalResults: result.pagination.totalResults,
      golfHomiezHostedResultsOnPage: result.courses.filter((course) => Number(course.hostedTournamentCount) > 0).length,
      golfHomiezPublicPageResultsOnPage: result.courses.filter((course) => Boolean(course.golfCoursePagePath)).length,
      phoneResultsOnPage: result.courses.filter((course) => Boolean(course.phone)).length,
      zipRadiusMiles: result.zipSearch.radiusMiles,
      zipRadiusResolved: result.zipSearch.radiusResolved,
      zipRadiusSource: result.zipSearch.source,
      searchStrategy: result.diagnostics?.strategy || null,
      catalogCourseRows: result.diagnostics?.catalogCourseRows ?? null,
      publicPageRows: result.diagnostics?.publicPageRows ?? null,
      hostRows: result.diagnostics?.hostRows ?? null,
      tournamentRows: result.diagnostics?.tournamentRows ?? null,
      indexedTournamentRows: result.diagnostics?.indexedTournamentRows ?? null,
    })
    if (result.filters.zipCode && !result.zipSearch.radiusResolved) {
      logApi('user_golf_course_search_zip_radius_unavailable', {
        ...requestContext(req),
        authUserId: req.user.id,
        zipCode: result.filters.zipCode,
        fallback: 'exact_zip_only',
      })
    }
    return res.json(result)
  } catch (error) {
    if (error instanceof Error && /Zip Code|ZIP code/i.test(error.message)) {
      logApi('user_golf_course_search_validation_failed', { ...requestContext(req), authUserId: req.user?.id || null, error: error.message })
      return res.status(400).json({ message: error.message })
    }
    logApi('user_golf_course_search_failed', {
      ...requestContext(req),
      authUserId: req.user?.id || null,
      searchStage: error?.golfCourseSearchStage || null,
      errorCode: error?.code || null,
      errorNumber: error?.errno || null,
    })
    logRouteError('User golf course search error', req, error)
    return res.status(500).json({ message: 'Could not search golf courses' })
  }
})

app.get('/api/users/tournament-search', requireStorage, authMiddleware, async (req, res) => {
  try {
    logApi('user_tournament_search_started', { ...requestContext(req), authUserId: req.user.id, timeZone: String(req.query.timeZone || '').trim() || null })
    const result = await searchGolfCourseTournaments(getPool(), {
      state: req.query.state,
      city: req.query.city,
      zipCode: req.query.zipCode,
      golfCourseName: req.query.golfCourseName,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      timeZone: req.query.timeZone,
    }, {
      page: req.query.page,
      viewerUserId: req.user.id,
      viewerEmail: normalizeEmail(req.user.email),
    })
    logApi('user_tournament_search_completed', {
      ...requestContext(req),
      authUserId: req.user.id,
      filters: result.filters,
      page: result.pagination.page,
      pageSize: result.pagination.pageSize,
      resultCount: result.tournaments.length,
      totalResults: result.pagination.totalResults,
      golfHomiezResultCount: result.tournaments.filter((tournament) => tournament.isGolfHomiezTournament).length,
      registeredGolfHomiezResultCount: result.tournaments.filter((tournament) => tournament.isGolfHomiezTournament && tournament.isRegistered).length,
      golfHomiezPublicPageResultsOnPage: result.tournaments.filter((tournament) => Boolean(tournament.golfCoursePagePath)).length,
      phoneResultsOnPage: result.tournaments.filter((tournament) => Boolean(tournament.golfCoursePhone)).length,
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
          AND t.archived_at IS NULL
          AND (tr.auth_user_id = ? OR LOWER(tr.email) = LOWER(?))
        GROUP BY t.id, tr.id
        ORDER BY COALESCE(t.start_date, t.created_at) DESC, tr.created_at DESC`,
      [req.user.id, email],
    )
    const rowsWithAddresses = await resolveTournamentGolfCourseAddresses(rows, req)
    const registrationRows = rowsWithAddresses.map((row) => ({
      row,
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
    const tournamentIds = [...new Set(registrationRows.map(({ row }) => String(row.id || '').trim()).filter(Boolean))]
    const teamScoreByTournamentAndTeam = new Map()
    let teamScoreLoadFailed = false
    if (tournamentIds.length) {
      try {
        const placeholders = tournamentIds.map(() => '?').join(',')
        const [scoreRows] = await pool.execute(
          `SELECT tournament_id, team_key, total_score, updated_at
             FROM tournament_team_scores
            WHERE tournament_id IN (${placeholders})`,
          tournamentIds,
        )
        for (const scoreRow of scoreRows) {
          const totalScore = scoreRow.total_score == null ? null : Number(scoreRow.total_score)
          teamScoreByTournamentAndTeam.set(`${scoreRow.tournament_id}::${scoreRow.team_key}`, {
            totalScore: Number.isFinite(totalScore) ? totalScore : null,
            updatedAt: scoreRow.updated_at || null,
          })
        }
      } catch (error) {
        teamScoreLoadFailed = true
        logWarn('user_registered_tournament_team_scores_load_failed', {
          ...requestContext(req),
          authUserId: req.user.id,
          tournamentCount: tournamentIds.length,
          error,
        })
      }
    }
    const tournaments = registrationRows.map(({ row, registration }) => {
      const score = teamScoreByTournamentAndTeam.get(`${row.id}::${tournamentRegistrationTeamKey(registration)}`) || null
      return {
        ...mapTournamentPortalRow(row, req),
        tournamentIdentifier: row.tournament_identifier || null,
        registration,
        teamScore: score?.totalScore ?? null,
        teamScoreUpdatedAt: score?.updatedAt || null,
      }
    })
    logApi('user_registered_tournaments_loaded', {
      ...requestContext(req),
      authUserId: req.user.id,
      email,
      tournamentCount: tournaments.length,
      activeTournamentCount: tournaments.filter((tournament) => ['published', 'active'].includes(String(tournament.status || '').toLowerCase())).length,
      completedTournamentCount: tournaments.filter((tournament) => String(tournament.status || '').toLowerCase() === 'completed').length,
      tournamentWithTeamScoreCount: tournaments.filter((tournament) => tournament.teamScore != null).length,
      teamScoreLoadFailed,
    })
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
    const profileName = `${profile.firstName} ${profile.lastName}`.replace(/\s+/g, ' ').trim()
    logApi('profile_save_started', { ...requestContext(req), hasName: Boolean(profile.firstName && profile.lastName), hasPhone: Boolean(profile.phone), hasLocation: Boolean(profile.primaryCity && profile.primaryState && profile.primaryZipCode), socialPreferencesEnabled })
    const existingRow = await ensureAppUserProfileRow(req.user)
    await auth.api.updateUser({ headers: fromNodeHeaders(req.headers), body: { name: profileName } })
    logApi('profile_auth_name_updated', { ...requestContext(req), userId: req.user.id, hasName: Boolean(profileName) })
    const updatedUser = { ...req.user, name: profileName }
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
        profileName,
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
      ensureAppUserProfileRow(updatedUser),
      loadProfileSummary(pool, updatedUser),
    ])
    logApi('profile_save_completed', { ...requestContext(req), needsEnrichment: !row?.profile_enriched_at || !row?.phone || !row?.primary_city || !row?.primary_state || !row?.primary_zip_code, hasName: Boolean(profile.firstName && profile.lastName), hasPhone: Boolean(row?.phone), hasLocation: Boolean(row?.primary_city && row?.primary_state && row?.primary_zip_code), socialPreferencesEnabled, roundsGolfed: summary?.roundsGolfed || 0 })
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
      challengeEndDate: parentMessage.challengeEndDate || parentMessage.challengeDate || null,
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

async function resolveChallengeCompletionForUser(messageId, user, action = 'complete it') {
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
    return { status: 403, body: { message: `Only the golfer who created the challenge can ${action}.` } }
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
  const resolvedParticipants = []
  let existingGolfHomiezCount = 0
  for (const email of payload.individualParticipantEmails || []) {
    const user = await storage.findUserByEmail(email)
    if (user) {
      resolvedParticipants.push(user)
      existingGolfHomiezCount += 1
    } else {
      resolvedParticipants.push({ id: null, email, name: null })
    }
  }
  const participants = buildIndividualChallengeParticipants(req.user, resolvedParticipants)
  if (participants.length > 25) {
    logApi('individual_challenge_too_many_golfers', { ...requestContext(req), participantCount: participants.length })
    return { status: 400, body: { message: 'Individual Challenge supports up to 25 golfers.' } }
  }
  const recipient = resolvedParticipants.find((item) => item?.id && normalizeEmail(item.email) !== normalizeEmail(req.user?.email)) || req.user
  return {
    status: 200,
    recipient,
    teamContext: {
      challengeStatus: 'proposed',
      challengeDate: payload.challengeDate,
      challengeEndDate: payload.challengeEndDate || payload.challengeDate || null,
      challengeState: payload.challengeState || null,
      challengeCourse: payload.challengeCourse || null,
      challengeTeeColor: normalizeTeeColor(payload.challengeTeeColor || DEFAULT_TEE_COLOR),
      individualChallengeParticipants: participants,
    },
    existingGolfHomiezCount,
    pendingInviteCount: Math.max(0, resolvedParticipants.length - existingGolfHomiezCount),
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

  const creatorAssignedCourse = String(message?.challengeCourse || '').trim()
  const scoreState = String(creatorAssignedCourse ? message?.challengeState : participant?.courseState || '').trim().toUpperCase()
  const requestedCourse = String(creatorAssignedCourse || participant?.courseName || '').trim()
  const requestedCourseId = creatorAssignedCourse ? '' : String(participant?.courseId || '').trim()
  if (!scoreState || !requestedCourse) throw new Error('Choose a golf course before entering an Individual Challenge score.')
  const matchedCourse = await resolveGolfCourseForState(scoreState, requestedCourse, requestedCourseId)
  if (!matchedCourse) throw new Error('Select a golf course from the database catalog before entering an Individual Challenge score.')
  const scoreCourse = matchedCourse.name || requestedCourse
  const courseMetadata = resolveScoreCourseMetadata(scoreState, matchedCourse)
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
        courseState: scoreState,
        courseName: scoreCourse,
        golfCourseId: courseMetadata.golfCourseId || null,
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
    courseState: scoreState,
    courseName: scoreCourse,
    golfCourseId: courseMetadata.golfCourseId || null,
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
      challengeEndDate: parentMessage.challengeEndDate || parentMessage.challengeDate || null,
      challengeState: parentMessage.challengeState || null,
      challengeCourse: parentMessage.challengeCourse || null,
      challengeTeeColor: normalizeTeeColor(parentMessage.challengeTeeColor || DEFAULT_TEE_COLOR),
      individualChallengeParticipants: parentMessage.individualChallengeParticipants || [],
    },
  }
}

app.get('/api/notifications/tournament-messages/:messageId', requireStorage, authMiddleware, async (req, res) => {
  try {
    const notification = await storage.getInboxMessageForParticipant(req.params.messageId, req.user)
    if (!notification || notification.messageType !== 'tournament_notification') return res.status(404).json({ message: 'Tournament message not found.' })
    const db = getPool()
    const host = await resolveTournamentHostRecipient(db, notification.tournamentId)
    const conversation = notification.tournamentConversationId
      ? await getTournamentMessageConversationForUser(db, notification.tournamentConversationId, req.user)
      : null
    logApi('golfer_tournament_conversation_loaded', { ...requestContext(req), tournamentId: notification.tournamentId, notificationId: notification.id, conversationId: conversation?.id || null, messageCount: conversation?.messages?.length || 0 })
    return res.json({ conversation, canMessageHost: Boolean(host?.email), hostName: host?.name || 'Tournament host' })
  } catch (error) {
    logRouteError('Golfer tournament conversation load error', req, error)
    return res.status(500).json({ message: 'Tournament conversation could not be loaded.' })
  }
})

app.post('/api/notifications/tournament-messages/:messageId', requireStorage, authMiddleware, async (req, res) => {
  try {
    const notification = await storage.getInboxMessageForParticipant(req.params.messageId, req.user)
    if (!notification || notification.messageType !== 'tournament_notification') return res.status(404).json({ message: 'Tournament message not found.' })
    const db = getPool()
    const host = await resolveTournamentHostRecipient(db, notification.tournamentId)
    if (!host?.email) return res.status(409).json({ message: 'The tournament host does not have an email address available for messages.' })
    const conversation = await startTournamentUserConversationFromNotification(db, {
      notification,
      user: req.user,
      host,
      body: req.body?.body,
      correlationId: req.correlationId || null,
    })
    if (!conversation) return res.status(403).json({ message: 'You no longer have access to this tournament conversation.' })
    logApi('golfer_tournament_message_sent_to_host', { ...requestContext(req), tournamentId: notification.tournamentId, notificationId: notification.id, conversationId: conversation.id, originalRecipientCount: conversation.recipients.length })
    return res.status(201).json({ ok: true, conversation })
  } catch (error) {
    if (error instanceof Error && /required|characters|host does not have/i.test(error.message)) {
      logApi('golfer_tournament_message_validation_failed', { ...requestContext(req), notificationId: req.params.messageId, validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Golfer tournament message send error', req, error)
    return res.status(500).json({ message: 'Your tournament message could not be sent.' })
  }
})

app.get('/api/notifications/summary', requireStorage, authMiddleware, async (req, res) => {
  try {
    const summary = await getUserNotificationSummary(getPool(), storage, req.user)
    logApi('notifications_summary_loaded', { ...requestContext(req), unreadCount: summary.unreadCount, categoryCounts: summary.categoryCounts })
    res.json(summary)
  } catch (error) {
    logRouteError('Notifications summary error', req, error)
    res.status(500).json({ message: 'Could not load notification summary' })
  }
})

app.get('/api/notifications', requireStorage, authMiddleware, async (req, res) => {
  try {
    const result = await loadUserNotificationPage(getPool(), storage, req.user, {
      filter: req.query.filter,
      deleted: String(req.query.deleted || '').toLowerCase() === 'true',
      page: req.query.page,
      pageSize: req.query.pageSize,
    })
    logApi('notifications_loaded', {
      ...requestContext(req),
      filter: String(req.query.filter || 'all'),
      deleted: String(req.query.deleted || '').toLowerCase() === 'true',
      page: result.page,
      pageSize: result.pageSize,
      notificationCount: result.notifications.length,
      total: result.total,
      unreadCount: result.unreadCount,
    })
    res.json(result)
  } catch (error) {
    logRouteError('Notifications load error', req, error)
    res.status(500).json({ message: 'Could not load notifications' })
  }
})

app.patch('/api/notifications/threads/:threadId/state', requireStorage, authMiddleware, async (req, res) => {
  try {
    const hasDeleted = Object.prototype.hasOwnProperty.call(req.body || {}, 'deleted')
    const state = await setNotificationThreadState(getPool(), req.user, req.params.threadId, {
      markRead: req.body?.markRead === true,
      ...(hasDeleted ? { deleted: req.body?.deleted === true } : {}),
    })
    logApi('notification_thread_state_updated', {
      ...requestContext(req),
      threadId: req.params.threadId,
      markRead: req.body?.markRead === true,
      deleted: hasDeleted ? req.body?.deleted === true : null,
      lastReadAt: state.lastReadAt,
      deletedAt: state.deletedAt,
    })
    res.json(state)
  } catch (error) {
    if (error instanceof Error && /required/i.test(error.message)) return res.status(400).json({ message: error.message })
    logRouteError('Notification thread state update error', req, error)
    res.status(500).json({ message: 'Could not update notification state' })
  }
})

app.get('/api/message-groups', requireStorage, authMiddleware, async (req, res) => {
  try {
    const groups = await listMessageGroups(getPool(), req.user)
    logApi('message_groups_loaded', { ...requestContext(req), groupCount: groups.length })
    res.json({ groups })
  } catch (error) {
    logRouteError('Message groups load error', req, error)
    res.status(500).json({ message: 'Could not load message groups' })
  }
})

app.post('/api/message-groups', requireStorage, authMiddleware, async (req, res) => {
  try {
    const rawEmails = Array.isArray(req.body?.memberEmails) ? req.body.memberEmails : []
    const memberEmails = [...new Set(rawEmails.map((value) => normalizeEmail(value)).filter(Boolean))]
    const members = []
    for (const email of memberEmails) {
      const member = await storage.findUserByEmail(email)
      if (!member) {
        logApi('message_group_member_not_found', { ...requestContext(req), email })
        return res.status(404).json({ message: `No GolfHomiez user exists for ${email}.`, recipientEmail: email, inviteRequired: true })
      }
      members.push(member)
    }
    const groupId = await createMessageGroup(getPool(), req.user, { name: req.body?.name, members })
    const groups = await listMessageGroups(getPool(), req.user)
    const group = groups.find((item) => String(item.id) === String(groupId)) || null
    logApi('message_group_created', { ...requestContext(req), groupId, memberCount: group?.members?.length || 0 })
    res.status(201).json({ group })
  } catch (error) {
    if (error instanceof Error && /required|characters/i.test(error.message)) {
      logApi('message_group_create_validation_failed', { ...requestContext(req), validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Message group create error', req, error)
    res.status(500).json({ message: 'Could not create message group' })
  }
})

app.delete('/api/message-groups/:id', requireStorage, authMiddleware, async (req, res) => {
  try {
    const result = await deleteMessageGroup(getPool(), req.params.id, req.user)
    if (!result) return res.status(404).json({ message: 'Message group not found or you cannot manage it.' })
    logApi('message_group_deleted', { ...requestContext(req), groupId: req.params.id, messagesPreserved: true })
    res.json({ ok: true, deletedGroupId: String(req.params.id), messagesPreserved: true })
  } catch (error) {
    logRouteError('Message group delete error', req, error)
    res.status(500).json({ message: 'Could not delete message group' })
  }
})

app.post('/api/message-groups/:id/members', requireStorage, authMiddleware, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)
    if (!email) return res.status(400).json({ message: 'Member email is required.' })
    const member = await storage.findUserByEmail(email)
    if (!member) return res.status(404).json({ message: `No GolfHomiez user exists for ${email}.`, recipientEmail: email, inviteRequired: true })
    const group = await addMessageGroupMember(getPool(), req.params.id, req.user, member)
    if (!group) return res.status(404).json({ message: 'Message group not found or you cannot manage it.' })
    const groups = await listMessageGroups(getPool(), req.user)
    logApi('message_group_member_added', { ...requestContext(req), groupId: req.params.id, memberEmail: email })
    res.json({ group: groups.find((item) => String(item.id) === String(req.params.id)) || null })
  } catch (error) {
    if (error instanceof Error && /required|valid/i.test(error.message)) return res.status(400).json({ message: error.message })
    logRouteError('Message group member add error', req, error)
    res.status(500).json({ message: 'Could not add group member' })
  }
})

app.delete('/api/message-groups/:id/members/:email', requireStorage, authMiddleware, async (req, res) => {
  try {
    const result = await removeMessageGroupMember(getPool(), req.params.id, req.user, req.params.email, req.correlationId || null)
    if (!result) return res.status(404).json({ message: 'Message group not found or you cannot manage it.' })
    const groups = await listMessageGroups(getPool(), req.user)
    logApi('message_group_member_removed', { ...requestContext(req), groupId: req.params.id, memberEmail: normalizeEmail(req.params.email), removed: result.removed })
    res.json({ removed: result.removed, group: groups.find((item) => String(item.id) === String(req.params.id)) || null })
  } catch (error) {
    if (error instanceof Error && /required|cannot be removed/i.test(error.message)) return res.status(400).json({ message: error.message })
    logRouteError('Message group member remove error', req, error)
    res.status(500).json({ message: 'Could not remove group member' })
  }
})

app.post('/api/message-groups/:id/messages', requireStorage, authMiddleware, async (req, res) => {
  try {
    const result = await sendMessageGroupMessage(getPool(), req.params.id, req.user, req.body?.body, req.correlationId || null)
    if (result.status !== 201) return res.status(result.status).json({ message: result.message })
    logApi('message_group_message_sent', { ...requestContext(req), groupId: req.params.id, messageId: result.id, threadId: result.threadId })
    res.status(201).json({ ok: true, messageId: result.id, threadId: result.threadId })
  } catch (error) {
    if (error instanceof Error && /required|characters/i.test(error.message)) return res.status(400).json({ message: error.message })
    logRouteError('Message group send error', req, error)
    res.status(500).json({ message: 'Could not send group message' })
  }
})

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
        existingGolfHomiezCount: resolvedChallenge.existingGolfHomiezCount ?? null,
        pendingInviteCount: resolvedChallenge.pendingInviteCount ?? null,
        challengeDate: teamContext?.challengeDate || null,
        challengeEndDate: teamContext?.challengeEndDate || null,
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
      challengeEndDate: message?.challengeEndDate || teamContext?.challengeEndDate || null,
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


app.patch('/api/inbox/messages/:id/challenge-settings', requireStorage, authMiddleware, async (req, res) => {
  try {
    const completion = await resolveChallengeCompletionForUser(req.params.id, req.user, 'update its settings')
    if (completion.status !== 200) {
      logApi('challenge_settings_update_denied', { ...requestContext(req), messageId: req.params.id, status: completion.status, reason: completion.body?.message || null })
      return res.status(completion.status).json(completion.body)
    }
    const initialMessage = completion.message
    const challengeTeeColor = normalizeTeeColor(req.body?.challengeTeeColor || req.body?.teeColor || initialMessage.challengeTeeColor || DEFAULT_TEE_COLOR)
    const settings = { challengeTeeColor }

    if (initialMessage.messageType === 'challenge_request') {
      const challengeScoringType = normalizeTeamChallengeScoringType(req.body?.challengeScoringType ?? initialMessage.challengeScoringType)
      const challengePointsPerHole = normalizeTeamChallengePointsPerHole(req.body?.challengePointsPerHole ?? initialMessage.challengePointsPerHole, challengeScoringType)
      settings.challengeScoringType = challengeScoringType
      settings.challengePointsPerHole = challengePointsPerHole
    } else if (initialMessage.messageType === 'individual_challenge') {
      const dateRange = validateIndividualChallengeDateRange(
        Object.prototype.hasOwnProperty.call(req.body || {}, 'challengeDate') ? req.body.challengeDate : initialMessage.challengeDate,
        Object.prototype.hasOwnProperty.call(req.body || {}, 'challengeEndDate') ? req.body.challengeEndDate : (initialMessage.challengeEndDate || initialMessage.challengeDate),
      )
      settings.challengeDate = dateRange.challengeDate
      settings.challengeEndDate = dateRange.challengeEndDate
      settings.challengeState = validateOptionalChallengeState(Object.prototype.hasOwnProperty.call(req.body || {}, 'challengeState') ? req.body.challengeState : initialMessage.challengeState)
      settings.challengeCourse = validateOptionalChallengeCourse(Object.prototype.hasOwnProperty.call(req.body || {}, 'challengeCourse') ? req.body.challengeCourse : initialMessage.challengeCourse)
    }

    logApi('challenge_settings_update_started', {
      ...requestContext(req),
      messageId: initialMessage.id,
      threadId: initialMessage.threadId || initialMessage.id,
      messageType: initialMessage.messageType,
      challengeTeeColor: settings.challengeTeeColor,
      challengeScoringType: settings.challengeScoringType || null,
      challengePointsPerHole: settings.challengePointsPerHole ?? null,
      challengeDate: settings.challengeDate ?? initialMessage.challengeDate ?? null,
      challengeEndDate: settings.challengeEndDate ?? initialMessage.challengeEndDate ?? null,
      challengeState: settings.challengeState ?? initialMessage.challengeState ?? null,
      challengeCourse: settings.challengeCourse ?? initialMessage.challengeCourse ?? null,
    })
    const message = await storage.updateInboxChallengeSettings(initialMessage.id, req.user, settings)
    if (!message) return res.status(409).json({ message: 'This challenge is complete, so its settings are locked.' })
    logApi('challenge_settings_update_succeeded', { ...requestContext(req), messageId: message.id, threadId: message.threadId || message.id, messageType: message.messageType, challengeTeeColor: message.challengeTeeColor, challengeScoringType: message.challengeScoringType || null, challengePointsPerHole: message.challengePointsPerHole ?? null, challengeDate: message.challengeDate || null, challengeEndDate: message.challengeEndDate || null })
    res.json(message)
  } catch (error) {
    if (error instanceof Error && /challenge|date|state|course|points|tee/i.test(error.message)) {
      logApi('challenge_settings_update_validation_failed', { ...requestContext(req), messageId: req.params.id, validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Challenge settings update error', req, error)
    res.status(500).json({ message: 'Could not update challenge settings' })
  }
})

app.patch('/api/inbox/messages/:id/individual-participants/refresh', requireStorage, authMiddleware, async (req, res) => {
  try {
    const message = await storage.getInboxMessageForParticipant(req.params.id, req.user)
    if (!message || message.messageType !== 'individual_challenge') {
      logApi('individual_challenge_participant_refresh_not_found', { ...requestContext(req), messageId: req.params.id })
      return res.status(404).json({ message: 'Individual Challenge not found' })
    }

    const currentParticipants = Array.isArray(message.individualChallengeParticipants) ? message.individualChallengeParticipants : []
    let transitionedToRegisteredCount = 0
    let registeredCount = 0
    let changedCount = 0
    const refreshedParticipants = []

    logApi('individual_challenge_participant_refresh_started', {
      ...requestContext(req),
      messageId: message.id,
      threadId: message.threadId || message.id,
      participantCount: currentParticipants.length,
    })

    for (const participant of currentParticipants) {
      const email = normalizeEmail(participant?.email)
      const found = email ? await storage.findUserByEmail(email) : null
      if (!found) {
        refreshedParticipants.push(participant)
        continue
      }

      const parts = splitName(found.name, found.email)
      const registeredName = `${parts.firstName} ${parts.lastName}`.replace(/\s+/g, ' ').trim() || normalizeEmail(found.email).split('@')[0]
      const nextParticipant = {
        ...participant,
        userId: found.id || participant?.userId || null,
        email: normalizeEmail(found.email || email),
        name: registeredName,
      }
      registeredCount += 1
      if (!participant?.userId && nextParticipant.userId) transitionedToRegisteredCount += 1
      if (String(participant?.userId || '') !== String(nextParticipant.userId || '') || String(participant?.name || '') !== String(nextParticipant.name || '') || normalizeEmail(participant?.email) !== nextParticipant.email) changedCount += 1
      refreshedParticipants.push(nextParticipant)
    }

    const updatedMessage = changedCount > 0
      ? await storage.updateInboxIndividualChallengeParticipants(message.id, req.user, refreshedParticipants)
      : message
    if (!updatedMessage) return res.status(404).json({ message: 'Individual Challenge not found' })

    const pendingCount = Math.max(0, refreshedParticipants.length - registeredCount)
    logApi('individual_challenge_participant_refresh_succeeded', {
      ...requestContext(req),
      messageId: updatedMessage.id,
      threadId: updatedMessage.threadId || updatedMessage.id,
      participantCount: refreshedParticipants.length,
      registeredCount,
      pendingCount,
      transitionedToRegisteredCount,
      changedCount,
    })
    res.json({
      message: updatedMessage,
      participants: updatedMessage.individualChallengeParticipants || refreshedParticipants,
      registeredCount,
      pendingCount,
      transitionedToRegisteredCount,
    })
  } catch (error) {
    logRouteError('Individual Challenge participant refresh error', req, error)
    res.status(500).json({ message: 'Could not refresh Individual Challenge golfers' })
  }
})

app.patch('/api/inbox/messages/:id/individual-course', requireStorage, authMiddleware, async (req, res) => {
  try {
    const message = await storage.getInboxMessageForParticipant(req.params.id, req.user)
    if (!message || message.messageType !== 'individual_challenge') {
      logApi('individual_challenge_course_not_found', { ...requestContext(req), messageId: req.params.id })
      return res.status(404).json({ message: 'Individual Challenge not found' })
    }
    if (String(message.challengeStatus || '').toLowerCase() === 'completed') {
      logApi('individual_challenge_course_update_locked', { ...requestContext(req), messageId: message.id, threadId: message.threadId || message.id })
      return res.status(409).json({ message: 'This challenge is complete, so the golf course is locked.' })
    }
    if (String(message.challengeCourse || '').trim()) {
      logApi('individual_challenge_course_update_creator_assigned', { ...requestContext(req), messageId: message.id, threadId: message.threadId || message.id, challengeCourse: message.challengeCourse })
      return res.status(409).json({ message: 'The challenge creator selected the golf course for this Individual Challenge.' })
    }
    const participant = individualChallengeParticipantForUser(message, req.user)
    if (!participant) {
      logApi('individual_challenge_course_update_forbidden', { ...requestContext(req), messageId: message.id })
      return res.status(403).json({ message: 'Only golfers in this Individual Challenge can choose their round course.' })
    }

    const state = validateOptionalChallengeState(req.body?.state)
    const courseName = validateOptionalChallengeCourse(req.body?.course)
    const courseId = String(req.body?.courseId || '').trim().slice(0, 191)
    if (!state || !courseName) return res.status(400).json({ message: 'Select a state and golf course before logging your Individual Challenge round.' })

    logApi('individual_challenge_course_update_started', {
      ...requestContext(req),
      messageId: message.id,
      threadId: message.threadId || message.id,
      participantEmail: normalizeEmail(participant.email),
      requestedState: state,
      requestedCourse: courseName,
      requestedCourseId: courseId || null,
    })
    const matchedCourse = await resolveGolfCourseForState(state, courseName, courseId)
    if (!matchedCourse) {
      logApi('individual_challenge_course_update_invalid_course', { ...requestContext(req), messageId: message.id, requestedState: state, requestedCourse: courseName, requestedCourseId: courseId || null })
      return res.status(400).json({ message: 'Select a golf course from the database catalog for the selected state.' })
    }
    const updated = await storage.updateInboxIndividualChallengeCourse(message.id, req.user, {
      courseId: matchedCourse.id || null,
      courseState: matchedCourse.state || state,
      courseName: matchedCourse.name || courseName,
    })
    if (!updated) return res.status(409).json({ message: 'The Individual Challenge golf course could not be updated.' })
    logApi('individual_challenge_course_update_succeeded', {
      ...requestContext(req),
      messageId: updated.id,
      threadId: updated.threadId || updated.id,
      participantEmail: normalizeEmail(participant.email),
      courseId: matchedCourse.id || null,
      courseState: matchedCourse.state || state,
      courseName: matchedCourse.name || courseName,
    })
    res.json(updated)
  } catch (error) {
    if (error instanceof Error && /challenge|state|course/i.test(error.message)) {
      logApi('individual_challenge_course_update_validation_failed', { ...requestContext(req), messageId: req.params.id, validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Individual Challenge course update error', req, error)
    res.status(500).json({ message: 'Could not update Individual Challenge golf course' })
  }
})


app.post('/api/inbox/messages/:id/individual-participants', requireStorage, authMiddleware, async (req, res) => {
  try {
    const completion = await resolveChallengeCompletionForUser(req.params.id, req.user, 'add golfers')
    if (completion.status !== 200) {
      logApi('individual_challenge_member_add_denied', { ...requestContext(req), messageId: req.params.id, status: completion.status, reason: completion.body?.message || null })
      return res.status(completion.status).json(completion.body)
    }
    const initialMessage = completion.message
    if (initialMessage.messageType !== 'individual_challenge') return res.status(400).json({ message: 'Golfers can only be added to an Individual Challenge.' })
    const [email] = normalizeIndividualChallengeParticipantEmails([req.body?.email])
    if ((initialMessage.individualChallengeParticipants || []).some((participant) => normalizeEmail(participant.email) === email)) {
      return res.status(409).json({ message: 'That golfer is already invited to this Individual Challenge.' })
    }
    const user = await storage.findUserByEmail(email)
    const participant = user || { id: null, email, name: null }
    logApi('individual_challenge_member_add_started', { ...requestContext(req), messageId: initialMessage.id, threadId: initialMessage.threadId || initialMessage.id, participantEmail: email, golfHomiezUserFound: Boolean(user) })
    const result = await storage.addInboxIndividualChallengeParticipant(initialMessage.id, req.user, participant)
    if (!result?.message) return res.status(409).json({ message: 'This challenge is complete, so golfers can no longer be added.' })
    if (!result.added) return res.status(409).json({ message: 'That golfer is already invited to this Individual Challenge.' })

    const addedMessage = await storage.createInboxMessage({
      sender: req.user,
      recipient: participant,
      messageType: 'individual_challenge',
      body: `${participant.name || email} was invited to the Individual Challenge.`,
      threadId: result.message.threadId || result.message.id,
      parentMessageId: result.message.id,
      teamContext: {
        challengeStatus: result.message.challengeStatus || 'proposed',
        challengeDate: result.message.challengeDate || null,
        challengeEndDate: result.message.challengeEndDate || result.message.challengeDate || null,
        challengeState: result.message.challengeState || null,
        challengeCourse: result.message.challengeCourse || null,
        challengeTeeColor: normalizeTeeColor(result.message.challengeTeeColor || DEFAULT_TEE_COLOR),
        individualChallengeParticipants: result.participants,
      },
    })
    logApi('individual_challenge_member_add_succeeded', { ...requestContext(req), messageId: initialMessage.id, threadId: result.message.threadId || result.message.id, notificationMessageId: addedMessage?.id || null, participantEmail: email, participantCount: result.participants.length, golfHomiezUserFound: Boolean(user) })
    res.status(201).json({ message: addedMessage || result.message, participants: result.participants, golfHomiezUserFound: Boolean(user) })
  } catch (error) {
    if (error instanceof Error && /email|golfers|Individual Challenge/i.test(error.message)) {
      logApi('individual_challenge_member_add_validation_failed', { ...requestContext(req), messageId: req.params.id, validationError: error.message })
      return res.status(400).json({ message: error.message })
    }
    logRouteError('Individual Challenge member add error', req, error)
    res.status(500).json({ message: 'Could not add golfer to Individual Challenge' })
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
    if (error instanceof Error && /score|number|zero|holes|hole|course|state/i.test(error.message)) {
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
      const manualName = splitName(String(member.name || ''), '')
      const missingRequiredName = !manualName.firstName || !manualName.lastName
      logApi(`${actionName}_member_directory_miss`, { ...requestContext(req), memberEmail: member.email, status, missingRequiredName })
      hydrated.push({ ...member, name: String(member.name || '').replace(/\s+/g, ' ').trim(), status, verified: false, _missingRequiredName: missingRequiredName })
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
    const unnamedInvitedMember = normalizedMembers.find((member) => member._missingRequiredName)
    if (unnamedInvitedMember) {
      logApi('team_create_validation_failed', { ...requestContext(req), teamName: trimmed, reason: 'invited_member_first_last_name_required', memberEmail: unnamedInvitedMember.email })
      return res.status(400).json({ message: 'First name and last name are required for team members who do not have a GolfHomiez account.' })
    }
    normalizedMembers = normalizedMembers.map(({ _missingRequiredName, ...member }) => member)

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
    const unnamedInvitedMember = normalizedMembers.find((member) => member._missingRequiredName)
    if (unnamedInvitedMember) {
      logApi('team_update_validation_failed', { ...requestContext(req), teamId: id, teamName: trimmed, reason: 'invited_member_first_last_name_required', memberEmail: unnamedInvitedMember.email })
      return res.status(400).json({ message: 'First name and last name are required for team members who do not have a GolfHomiez account.' })
    }
    normalizedMembers = normalizedMembers.map(({ _missingRequiredName, ...member }) => member)

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
    if (rejectPasswordPolicy(req, res, password, 'admin', 'reset_password')) return

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
    if (rejectPasswordPolicy(req, res, password, 'admin', 'create_account')) return

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
    if (rejectPasswordPolicy(req, res, password, 'golf_course', 'reset_password')) return
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
