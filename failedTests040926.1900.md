
> golf-scramble-app@1.0.0 test
> node --test test/app.test.js test/schema-rollback.test.js

TAP version 13
# Subtest: email helpers normalize and validate addresses
ok 1 - email helpers normalize and validate addresses
  ---
  duration_ms: 2.7524
  ...
# Subtest: forgot password client points at the correct Better Auth endpoint
ok 2 - forgot password client points at the correct Better Auth endpoint
  ---
  duration_ms: 0.9099
  ...
# Subtest: better auth client prefers same-origin in deployed environments and only allows loopback cross-origin locally
ok 3 - better auth client prefers same-origin in deployed environments and only allows loopback cross-origin locally
  ---
  duration_ms: 0.3994
  ...
# Subtest: API client attaches the user timezone header for server-side date validation
ok 4 - API client attaches the user timezone header for server-side date validation
  ---
  duration_ms: 0.3632
  ...
# Subtest: create-team normalization always makes the signed-in user the first member
ok 5 - create-team normalization always makes the signed-in user the first member
  ---
  duration_ms: 2.1832
  ...
# Subtest: locked lead member falls back to the email local-part when the user name is unavailable
ok 6 - locked lead member falls back to the email local-part when the user name is unavailable
  ---
  duration_ms: 0.2155
  ...
# Subtest: team creation UI uses email lookup, prevents duplicates, shows pending invites, and hides the add input at four golfers
ok 7 - team creation UI uses email lookup, prevents duplicates, shows pending invites, and hides the add input at four golfers
  ---
  duration_ms: 0.5571
  ...
# Subtest: date helpers reject future dates in the supplied local timezone
ok 8 - date helpers reject future dates in the supplied local timezone
  ---
  duration_ms: 24.8887
  ...
# Subtest: score logger pages use the user-local date helper for date picker limits
ok 9 - score logger pages use the user-local date helper for date picker limits
  ---
  duration_ms: 1.6408
  ...
# Subtest: solo logger supports optional 18-hole entry like the team logger
ok 10 - solo logger supports optional 18-hole entry like the team logger
  ---
  duration_ms: 0.5753
  ...
# Subtest: logged event rows remain clickable buttons for round detail access
ok 11 - logged event rows remain clickable buttons for round detail access
  ---
  duration_ms: 0.6024
  ...
# Subtest: handicap UI is clickable, filter-relative, and shows a breakdown modal
ok 12 - handicap UI is clickable, filter-relative, and shows a breakdown modal
  ---
  duration_ms: 0.9376
  ...
# Subtest: validation warnings stay hidden until save is attempted
ok 13 - validation warnings stay hidden until save is attempted
  ---
  duration_ms: 0.6157
  ...
# Subtest: homepage shows guest sample scores when no user is logged in
ok 14 - homepage shows guest sample scores when no user is logged in
  ---
  duration_ms: 0.5666
  ...
# Subtest: logging writes to root access and error log files with request middleware support
ok 15 - logging writes to root access and error log files with request middleware support
  ---
  duration_ms: 0.5955
  ...
# Subtest: homepage demo seeder can populate the sample rounds locally
ok 16 - homepage demo seeder can populate the sample rounds locally
  ---
  duration_ms: 0.4645
  ...
# Subtest: safe mobile diagnostics use pixel beacons instead of recursive preboot network logging
ok 17 - safe mobile diagnostics use pixel beacons instead of recursive preboot network logging
  ---
  duration_ms: 0.8255
  ...
# Subtest: register route stays lazy-loaded to avoid pulling mobile-only register code into the initial bundle
ok 18 - register route stays lazy-loaded to avoid pulling mobile-only register code into the initial bundle
  ---
  duration_ms: 0.763
  ...
# Subtest: location resources use backend endpoints and keep datasets off the client
not ok 19 - location resources use backend endpoints and keep datasets off the client
  ---
  duration_ms: 0.9483
  location: 'file:///C:/SeanCode/GolfHomiez/golfhomiez/test/app.test.js:213:1'
  failureType: 'testCodeFailure'
  error: 'readFile is not defined'
  code: 'ERR_TEST_FAILURE'
  name: 'ReferenceError'
  stack: |-
    TestContext.<anonymous> (file:///C:/SeanCode/GolfHomiez/golfhomiez/test/app.test.js:214:18)
    Test.runInAsyncScope (node:async_hooks:206:9)
    Test.run (node:internal/test_runner/test:631:25)
    Test.processPendingSubtests (node:internal/test_runner/test:374:18)
    Test.postRun (node:internal/test_runner/test:715:19)
    Test.run (node:internal/test_runner/test:673:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:374:7)
  ...
# Subtest: mobile location lookup runs on the server and keeps browser datasets out of the client
not ok 20 - mobile location lookup runs on the server and keeps browser datasets out of the client
  ---
  duration_ms: 0.432
  location: 'file:///C:/SeanCode/GolfHomiez/golfhomiez/test/app.test.js:222:1'
  failureType: 'testCodeFailure'
  error: 'readFile is not defined'
  code: 'ERR_TEST_FAILURE'
  name: 'ReferenceError'
  stack: |-
    TestContext.<anonymous> (file:///C:/SeanCode/GolfHomiez/golfhomiez/test/app.test.js:223:18)
    Test.runInAsyncScope (node:async_hooks:206:9)
    Test.run (node:internal/test_runner/test:631:25)
    Test.processPendingSubtests (node:internal/test_runner/test:374:18)
    Test.postRun (node:internal/test_runner/test:715:19)
    Test.run (node:internal/test_runner/test:673:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:374:7)
  ...
# Subtest: the package test script targets the maintained test suite files
ok 21 - the package test script targets the maintained test suite files
  ---
  duration_ms: 0.3842
  ...
# Subtest: auth session lifetime is set to 24 hours and registration signs the user out until verification
ok 22 - auth session lifetime is set to 24 hours and registration signs the user out until verification
  ---
  duration_ms: 0.8318
  ...
# Subtest: legacy users are backfilled as verified while new sign-ins still require verification
ok 23 - legacy users are backfilled as verified while new sign-ins still require verification
  ---
  duration_ms: 0.684
  ...
# Subtest: smtp logging has a dedicated smtp log with shared correlation ids
ok 24 - smtp logging has a dedicated smtp log with shared correlation ids
  ---
  duration_ms: 0.8661
  ...
# Subtest: verification flow prepopulates email and shows registration completion guidance
ok 25 - verification flow prepopulates email and shows registration completion guidance
  ---
  duration_ms: 0.2797
  ...
# Subtest: navigation uses the styled dropdown menu items and keeps invite access available
ok 26 - navigation uses the styled dropdown menu items and keeps invite access available
  ---
  duration_ms: 0.5144
  ...
# Subtest: teams page shows pending verification states, registration invites, and restored edit capability
ok 27 - teams page shows pending verification states, registration invites, and restored edit capability
  ---
  duration_ms: 0.4308
  ...
# Subtest: registration routes stay same-origin and client log ingestion supports both legacy and current endpoints
ok 28 - registration routes stay same-origin and client log ingestion supports both legacy and current endpoints
  ---
  duration_ms: 0.5103
  ...
# Subtest: client log ingestion endpoints support singular and plural routes
not ok 29 - client log ingestion endpoints support singular and plural routes
  ---
  duration_ms: 3.3507
  location: 'file:///C:/SeanCode/GolfHomiez/golfhomiez/test/app.test.js:317:1'
  failureType: 'testCodeFailure'
  error: |-
    The input did not match the regular expression /status\(202\)\.end\(\)/. Input:
    
    "import 'dotenv/config'\n" +
      "import express from 'express'\n" +
      "import cors from 'cors'\n" +
      "import fs from 'fs'\n" +
      "import path from 'path'\n" +
      "import { fileURLToPath } from 'url'\n" +
      "import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'\n" +
      "import { auth } from './auth.js'\n" +
      "import { getLatestPasswordReset, getLatestVerificationLink } from './auth-debug.js'\n" +
      "import storage from './storage/index.js'\n" +
      "import { getPool } from './db.js'\n" +
      "import { isValidPastOrTodayDate } from './lib/date-utils.js'\n" +
      "import { normalizeCreateTeamMembers, normalizeEmail, isEmail } from './lib/team-utils.js'\n" +
      "import { accessLogMiddleware, getLogPaths, logApi, logError, logFrontend, logInfo, requestContext, requestCorrelationMiddleware } from './lib/logger.js'\n" +
      "import { getNearestLocation as getNearestServerLocation, searchLocations as searchServerLocations } from './lib/location-service.js'\n" +
      "import { sendMail } from './mailer.js'\n" +
      "import { v4 as uuidv4 } from 'uuid'\n" +
      '\n' +
      'const __filename = fileURLToPath(import.meta.url)\n' +
      'const __dirname = path.dirname(__filename)\n' +
      '\n' +
      'const app = express()\n' +
      "app.set('trust proxy', 1)\n" +
      'const PORT = Number(process.env.PORT || 5001)\n' +
      'let storageReady = false\n' +
      "const clientOrigin = String(process.env.CLIENT_ORIGIN || '').trim()\n" +
      "const publicServerOrigin = String(process.env.BETTER_AUTH_URL || '').trim()\n" +
      'const allowedOrigins = new Set([\n' +
      '  clientOrigin,\n' +
      '  publicServerOrigin,\n' +
      "  'http://127.0.0.1:5174',\n" +
      "  'http://localhost:5174',\n" +
      "  'http://127.0.0.1:5001',\n" +
      "  'http://localhost:5001',\n" +
      '].filter(Boolean))\n' +
      '\n' +
      'app.use(cors({\n' +
      '  origin(origin, callback) {\n' +
      '    if (!origin || allowedOrigins.has(origin)) return callback(null, true)\n' +
      '    return callback(new Error(`CORS blocked for origin: ${origin}`))\n' +
      '  },\n' +
      '  credentials: true,\n' +
      "  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],\n" +
      "  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Timezone', 'X-Correlation-Id', 'X-Request-Id'],\n" +
      '}))\n' +
      "app.options('*', cors())\n" +
      'app.use(requestCorrelationMiddleware)\n' +
      'app.use(accessLogMiddleware)\n' +
      '\n' +
      "const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')\n" +
      '\n' +
      "app.get('/diag/pixel.gif', (req, res) => {\n" +
      "  logFrontend('frontend_stage', {\n" +
      '\n' +
      "    correlationId: String(req.query.cid || '').trim() || null,\n" +
      "    stage: String(req.query.stage || '').trim() || 'unknown',\n" +
      "    detail: String(req.query.detail || '').trim() || null,\n" +
      "    path: String(req.query.path || req.path || '').trim() || null,\n" +
      '    ip: req.ip,\n' +
      "    userAgent: req.headers['user-agent'] || null,\n" +
      '    referer: req.headers.referer || null,\n' +
      '  })\n' +
      '\n' +
      "  logApi('frontend_stage_pixel', { correlationId: req.correlationId || String(req.query.cid || '').trim() || null, path: String(req.query.path || req.path || '').trim() || null, detail: String(req.query.detail || '').trim() || null, stage: String(req.query.stage || '').trim() || 'unknown', ip: req.ip, userAgent: req.headers['user-agent'] || null })\n" +
      '\n' +
      "  res.setHeader('Content-Type', 'image/gif')\n" +
      "  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')\n" +
      "  res.setHeader('Pragma', 'no-cache')\n" +
      "  res.setHeader('Expires', '0')\n" +
      '  res.send(TRANSPARENT_GIF)\n' +
      '})\n' +
      '\n' +
      "app.get('/api/locations/search', (req, res) => {\n" +
      '  try {\n' +
      "    const query = String(req.query.q || '').trim()\n" +
      '    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 20)\n' +
      '    const results = searchServerLocations(query, limit)\n' +
      "    logApi('location_search_completed', {\n" +
      '      ...requestContext(req),\n' +
      '      query,\n' +
      '      limit,\n' +
      '      resultCount: results.length,\n' +
      '    })\n' +
      '    res.json(results)\n' +
      '  } catch (error) {\n' +
      "    logRouteError('Location search error', req, error)\n" +
      "    res.status(500).json({ message: 'Location suggestions are temporarily unavailable.' })\n" +
      '  }\n' +
      '})\n' +
      '\n' +
      "app.get('/api/locations/nearest', (req, res) => {\n" +
      '  try {\n' +
      '    const latitude = Number(req.query.lat)\n' +
      '    const longitude = Number(req.query.lng)\n' +
      '    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {\n' +
      "      return res.status(400).json({ message: 'lat and lng query parameters are required' })\n" +
      '    }\n' +
      '\n' +
      '    const nearest = getNearestServerLocation(latitude, longitude)\n' +
      "    logApi('location_nearest_completed', {\n" +
      '      ...requestContext(req),\n' +
      '      latitude,\n' +
      '      longitude,\n' +
      '      found: Boolean(nearest),\n' +
      '      selectedLabel: nearest?.label || null,\n' +
      '    })\n' +
      '    res.json(nearest || null)\n' +
      '  } catch (error) {\n' +
      "    logRouteError('Nearest location error', req, error)\n" +
      "    res.status(500).json({ message: 'Location lookup failed.' })\n" +
      '  }\n' +
      '})\n' +
      '\n' +
      "app.all('/api/auth/*', toNodeHandler(auth))\n" +
      'app.use(express.json())\n' +
      '\n' +
      "app.post(['/api/client-logs', '/api/client-log'], express.json({ limit: '64kb' }), (req, res) => {\n" +
      '  try {\n' +
      "    const body = req.body && typeof req.body === 'object' ? req.body : {}\n" +
      "    const correlationId = String(body.correlationId || req.correlationId || '').trim() || req.correlationId || null\n" +
      '    const entry = {\n' +
      '      correlationId,\n' +
      "      level: String(body.level || 'info').trim() || 'info',\n" +
      "      type: String(body.type || 'frontend_event').trim() || 'frontend_event',\n" +
      "      message: String(body.message || 'frontend_event').trim() || 'frontend_event',\n" +
      '      action: body.action == null ? null : String(body.action),\n' +
      '      status: body.status == null ? null : String(body.status),\n' +
      '      route: body.route == null ? (req.headers.referer || null) : String(body.route),\n' +
      "      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : null,\n" +
      "      userAgent: body.userAgent == null ? (req.headers['user-agent'] || null) : String(body.userAgent),\n" +
      "      source: req.headers['x-log-source'] || 'client',\n" +
      '      ip: req.ip,\n' +
      '    }\n' +
      '\n' +
      '    logFrontend(entry.message, entry)\n' +
      "    logApi('client_log_ingested', {\n" +
      '      correlationId: entry.correlationId,\n' +
      '      type: entry.type,\n' +
      '      level: entry.level,\n' +
      '      route: entry.route,\n' +
      '      source: entry.source,\n' +
      '      path: req.originalUrl || req.url,\n' +
      '      ip: req.ip,\n' +
      '      userAgent: entry.userAgent,\n' +
      '    })\n' +
      '\n' +
      '    return res.status(204).end()\n' +
      '  } catch (error) {\n' +
      "    logRouteError('Client log ingestion error', req, error, { body: req.body })\n" +
      '    return res.status(204).end()\n' +
      '  }\n' +
      '})\n' +
      '\n' +
      'function logRouteError(message, req, error, extra = {}) {\n' +
      '  logError(message, {\n' +
      '    ...requestContext(req),\n' +
      '    ...extra,\n' +
      '    error,\n' +
      '  })\n' +
      '}\n' +
      '\n' +
      'async function authMiddleware(req, res, next) {\n' +
      '  try {\n' +
      '    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })\n' +
      "    if (!session?.user) return res.status(401).json({ message: 'Unauthorized' })\n" +
      '    req.user = {\n' +
      '      id: session.user.id,\n' +
      '      email: session.user.email,\n' +
      '      name: session.user.name,\n' +
      '    }\n' +
      '    next()\n' +
      '  } catch (error) {\n' +
      "    logRouteError('Auth middleware error', req, error)\n" +
      "    res.status(500).json({ message: 'Authentication failed' })\n" +
      '  }\n' +
      '}\n' +
      '\n' +
      '\n' +
      '\n' +
      'function getApiBaseUrl(req) {\n' +
      "  return process.env.BETTER_AUTH_URL || `${req.protocol}://${req.get('host')}`\n" +
      '}\n' +
      '\n' +
      'function getClientAppBaseUrl(req) {\n' +
      "  const requestOrigin = String(req.headers.origin || '').trim()\n" +
      '  if (requestOrigin && allowedOrigins.has(requestOrigin) && !/:(5001)$/.test(requestOrigin)) return requestOrigin\n' +
      '  return clientOrigin || getApiBaseUrl(req)\n' +
      '}\n' +
      '\n' +
      'function buildRegisterInviteUrl(req, email) {\n' +
      "  const url = new URL('/register', getClientAppBaseUrl(req))\n" +
      "  url.searchParams.set('email', normalizeEmail(email))\n" +
      '  return url.toString()\n' +
      '}\n' +
      '\n' +
      "function splitName(name = '', email = '') {\n" +
      "  const trimmed = String(name || '').trim()\n" +
      "  if (!trimmed) return { firstName: String(email || '').split('@')[0] || '', lastName: '' }\n" +
      "  const [firstName = '', ...rest] = trimmed.split(/\\s+/)\n" +
      "  return { firstName, lastName: rest.join(' ') }\n" +
      '}\n' +
      '\n' +
      "async function sendRegistrationInviteEmail(req, { toEmail, customMessage, invitedBy, teamId = null, purpose = 'registration_invite' }) {\n" +
      '  const inviteUrl = buildRegisterInviteUrl(req, toEmail)\n' +
      "  const inviterLabel = invitedBy?.name || invitedBy?.email || 'Your Golf Homie'\n" +
      "  const messageText = String(customMessage || '').trim()\n" +
      "  const subject = 'You are invited to join Golf Homiez'\n" +
      '  const text = [\n' +
      '    messageText,\n' +
      "    '',\n" +
      '    `${inviterLabel} invited you to join Golf Homiez.`,\n' +
      "    'Track rounds, build teams, log scores, and keep your golf crew together in one place.',\n" +
      '    `Register here: ${inviteUrl}`,\n' +
      "  ].filter(Boolean).join('\\n')\n" +
      '  const html = `\n' +
      '    <p>${messageText || `${inviterLabel} wants you on Golf Homiez.`}</p>\n' +
      '    <p><strong>${inviterLabel}</strong> invited you to join Golf Homiez.</p>\n' +
      '    <p>Keep your rounds, teams, and golf score history together in one place.</p>\n' +
      '    <p><a href="${inviteUrl}">Create your Golf Homiez account</a></p>\n' +
      '  `\n' +
      '\n' +
      '  await sendMail({ to: toEmail, subject, text, html })\n' +
      '\n' +
      '  try {\n' +
      '    const pool = getPool()\n' +
      '    await pool.execute(\n' +
      "      'INSERT INTO invitations (id, email, invited_by_user_id, invited_by_email, team_id, purpose, custom_message, invite_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',\n" +
      '      [uuidv4(), normalizeEmail(toEmail), invitedBy?.id || null, invitedBy?.email || null, teamId, purpose, messageText || null, inviteUrl],\n' +
      '    )\n' +
      '  } catch (error) {\n' +
      "    logError('Invitation persistence failed', { error, email: toEmail, invitedByEmail: invitedBy?.email || null, teamId, purpose })\n" +
      '  }\n' +
      '\n' +
      "  logApi('registration_invite_sent', { ...requestContext(req), email: normalizeEmail(toEmail), invitedByEmail: invitedBy?.email || null, teamId, purpose, inviteUrl })\n" +
      '  return { ok: true, inviteUrl }\n' +
      '}\n' +
      '\n' +
      '\n' +
      'function redirectToClientApp(req, res) {\n' +
      "  const target = new URL(req.originalUrl || req.url || '/', getClientAppBaseUrl(req))\n" +
      '  return res.redirect(302, target.toString())\n' +
      '}\n' +
      '\n' +
      "app.get(['/register', '/login', '/verify-contact'], (req, res, next) => {\n" +
      "  const host = String(req.get('host') || '')\n" +
      '  const shouldRedirectToClient = clientOrigin && !host.includes(new URL(clientOrigin).host)\n' +
      '  if (shouldRedirectToClient) return redirectToClientApp(req, res)\n' +
      "  const distDir = path.join(__dirname, '..', 'dist')\n" +
      '  if (fs.existsSync(distDir)) return next()\n' +
      '  return redirectToClientApp(req, res)\n' +
      '})\n' +
      '\n' +
      'async function findTeamByName(name) {\n' +
      '  return storage.getTeamByName(name)\n' +
      '}\n' +
      '\n' +
      'async function isUserOnTeam(teamName, userE'... 12978 more characters
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual: |-
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
    import { sendMail } from './mailer.js'
    import { v4 as uuidv4 } from 'uuid'
    
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
    
    app.get('/api/locations/nearest', (req, res) => {
      try {
        const latitude = Number(req.query.lat)
        const longitude = Number(req.query.lng)
        if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
          return res.status(400).json({ message: 'lat and lng query parameters are required' })
        }
    
        const nearest = getNearestServerLocation(latitude, longitude)
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
    
    app.get(['/register', '/login', '/verify-contact'], (req, res, next) => {
      const host = String(req.get('host') || '')
      const shouldRedirectToClient = clientOrigin && !host.includes(new URL(clientOrigin).host)
      if (shouldRedirectToClient) return redirectToClientApp(req, res)
      const distDir = path.join(__dirname, '..', 'dist')
      if (fs.existsSync(distDir)) return next()
      return redirectToClientApp(req, res)
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
    
          const entry = await storage.createScore({
            mode: 'solo',
            date,
            state: String(state).toUpperCase(),
            course,
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
          course,
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
    
  operator: 'match'
  stack: |-
    TestContext.<anonymous> (file:///C:/SeanCode/GolfHomiez/golfhomiez/test/app.test.js:321:10)
    Test.runInAsyncScope (node:async_hooks:206:9)
    Test.run (node:internal/test_runner/test:631:25)
    Test.processPendingSubtests (node:internal/test_runner/test:374:18)
    Test.postRun (node:internal/test_runner/test:715:19)
    Test.run (node:internal/test_runner/test:673:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:374:7)
  ...
# Subtest: auth API defaults to same-origin auth in deployed environments when override origin mismatches
ok 30 - auth API defaults to same-origin auth in deployed environments when override origin mismatches
  ---
  duration_ms: 0.3744
  ...
# Subtest: app startup resets session log files so logs only reflect the current session
ok 31 - app startup resets session log files so logs only reflect the current session
  ---
  duration_ms: 0.6766
  ...
# Subtest: one-time schema rollback is wired into postinstall and removes itself afterward
ok 32 - one-time schema rollback is wired into postinstall and removes itself afterward
  ---
  duration_ms: 3.0549
  ...
# Subtest: rollback migration removes chat-added schema tables and migration records
ok 33 - rollback migration removes chat-added schema tables and migration records
  ---
  duration_ms: 0.6243
  ...
1..33
# tests 33
# suites 0
# pass 30
# fail 3
# cancelled 0
# skipped 0
# todo 0
# duration_ms 236.294
