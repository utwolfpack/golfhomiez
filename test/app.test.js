import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { getTodayInTimeZone, isValidPastOrTodayDate } from '../server/lib/date-utils.js'
import { buildLockedLeadMember, isEmail, normalizeCreateTeamMembers, normalizeEmail } from '../server/lib/team-utils.js'

function addDays(isoDate, days) {
  const base = new Date(`${isoDate}T00:00:00Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

test('email helpers normalize and validate addresses', () => {
  assert.equal(normalizeEmail('  Player@One.COM '), 'player@one.com')
  assert.equal(isEmail('player@one.com'), true)
  assert.equal(isEmail('not-an-email'), false)
})

test('forgot password client points at the correct Better Auth endpoint', () => {
  const source = fs.readFileSync(new URL('../src/lib/auth-api.ts', import.meta.url), 'utf8')
  assert.match(source, /\$\{AUTH_BASE\}\/request-password-reset/)
  assert.doesNotMatch(source, /\$\{AUTH_BASE\}\/forget-password/)
})

test('API client attaches the user timezone header for server-side date validation', () => {
  const source = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8')
  assert.match(source, /X-User-Timezone/)
  assert.match(source, /resolvedOptions\(\)\.timeZone/)
})

test('create-team normalization always makes the signed-in user the first member', () => {
  const user = { id: 'user-1', email: 'captain@example.com', name: 'Casey Captain' }
  const members = [
    { name: 'Someone Else', email: 'other@example.com' },
    { name: 'Duplicate Captain', email: 'CAPTAIN@example.com' },
    { name: 'Third Golfer', email: 'third@example.com' },
  ]

  const normalized = normalizeCreateTeamMembers(members, user)
  assert.equal(normalized[0].email, 'captain@example.com')
  assert.equal(normalized[0].name, 'Casey Captain')
  assert.deepEqual(normalized.map((member) => member.email), [
    'captain@example.com',
    'other@example.com',
    'third@example.com',
  ])
})

test('locked lead member falls back to the email local-part when the user name is unavailable', () => {
  const lead = buildLockedLeadMember({ email: 'solo@example.com', name: '' })
  assert.equal(lead.email, 'solo@example.com')
  assert.equal(lead.name, 'solo')
})

test('team creation UI uses email lookup, prevents duplicates, shows pending invites, and hides the add input at four golfers', () => {
  const source = fs.readFileSync(new URL('../src/pages/GolfLogger.tsx', import.meta.url), 'utf8')
  assert.match(source, /Teammate email/)
  assert.match(source, /Lookup/)
  assert.match(source, /Member 1 is always the signed-in user and cannot be changed\./)
  assert.match(source, /That teammate is already on this team\. Pick a different golfer\./)
  assert.match(source, /Teams can have a maximum of 4 people\./)
  assert.match(source, /Registration invite sent/)
  assert.match(source, /maximum 4 golfers, so the add-teammate input is hidden/)
})

test('date helpers reject future dates in the supplied local timezone', () => {
  const timeZone = 'America/Denver'
  const today = getTodayInTimeZone(timeZone)
  const tomorrow = addDays(today, 1)
  const yesterday = addDays(today, -1)

  assert.equal(isValidPastOrTodayDate(yesterday, timeZone), true)
  assert.equal(isValidPastOrTodayDate(today, timeZone), true)
  assert.equal(isValidPastOrTodayDate(tomorrow, timeZone), false)
})

test('score logger pages use the user-local date helper for date picker limits', () => {
  const golfLogger = fs.readFileSync(new URL('../src/pages/GolfLogger.tsx', import.meta.url), 'utf8')
  const soloLogger = fs.readFileSync(new URL('../src/pages/SoloLogger.tsx', import.meta.url), 'utf8')

  assert.match(golfLogger, /getUserTodayISO\(\)/)
  assert.match(golfLogger, /type="date" max=\{today\}/)
  assert.match(soloLogger, /getUserTodayISO\(\)/)
  assert.match(soloLogger, /type="date" max=\{today\}/)
})

test('solo logger supports optional 18-hole entry like the team logger', () => {
  const soloLogger = fs.readFileSync(new URL('../src/pages/SoloLogger.tsx', import.meta.url), 'utf8')

  assert.match(soloLogger, /Enable 18-hole inputs \(optional\)/)
  assert.match(soloLogger, /const \[useHoles, setUseHoles\] = useState\(false\)/)
  assert.match(soloLogger, /const \[holes, setHoles\] = useState<number\[\]>\(Array\(NUM_HOLES\)\.fill\(0\)\)/)
  assert.match(soloLogger, /holes: useHoles \? holes : null/)
})

test('logged event rows remain clickable buttons for round detail access', () => {
  const home = fs.readFileSync(new URL('../src/pages/Home.tsx', import.meta.url), 'utf8')
  const scoresPage = fs.readFileSync(new URL('../src/pages/MyGolfScores.tsx', import.meta.url), 'utf8')

  assert.match(home, /function RoundRow\({ round, onClick }/)
  assert.match(home, /<button type="button" className=\{roundRowClass\(round\)\} onClick=\{onClick\}>/)
  assert.match(home, /Tap for details/)

  assert.match(scoresPage, /function ScoreButton\({ round, onClick }/)
  assert.match(scoresPage, /<button type="button" className=\{rowClass\(round\)\} onClick=\{onClick\}>/)
  assert.match(scoresPage, /<RoundDetailModal round=\{selectedRound\}/)
})

test('handicap UI is clickable, filter-relative, and shows a breakdown modal', () => {
  const home = fs.readFileSync(new URL('../src/pages/Home.tsx', import.meta.url), 'utf8')
  const scoresPage = fs.readFileSync(new URL('../src/pages/MyGolfScores.tsx', import.meta.url), 'utf8')
  const summaryCard = fs.readFileSync(new URL('../src/components/HandicapSummaryCard.tsx', import.meta.url), 'utf8')
  const modal = fs.readFileSync(new URL('../src/components/HandicapBreakdownModal.tsx', import.meta.url), 'utf8')
  const handicapLib = fs.readFileSync(new URL('../src/lib/handicap.ts', import.meta.url), 'utf8')

  assert.match(home, /calculateHandicapFromScores\(filteredScores\)/)
  assert.match(scoresPage, /calculateHandicapFromScores\(filteredScores\)/)
  assert.match(home, /<HandicapSummaryCard key="soloHandicap" stats=\{handicapStats\} onClick=\{\(\) => setShowHandicapModal\(true\)\} \/>/)
  assert.match(scoresPage, /<HandicapSummaryCard key="soloHandicap" stats=\{handicapStats\} onClick=\{\(\) => setShowHandicapModal\(true\)\} \/>/)
  assert.match(summaryCard, /aria-label="Open handicap breakdown"/)
  assert.match(summaryCard, /Tap to view formula and logged rounds used/)
  assert.match(modal, /How your handicap was calculated/)
  assert.match(modal, /Logged events used in the formula/)
  assert.match(handicapLib, /formulaText/)
  assert.match(handicapLib, /included: false/)
  assert.match(handicapLib, /differentialsUsed/)
})

test('validation warnings stay hidden until save is attempted', () => {
  const golfLogger = fs.readFileSync(new URL('../src/pages/GolfLogger.tsx', import.meta.url), 'utf8')
  const soloLogger = fs.readFileSync(new URL('../src/pages/SoloLogger.tsx', import.meta.url), 'utf8')

  assert.match(soloLogger, /const \[showValidation, setShowValidation\] = useState\(false\)/)
  assert.match(soloLogger, /setShowValidation\(true\)/)
  assert.match(soloLogger, /showValidation && missingFields.length/)

  assert.match(golfLogger, /const \[showRoundValidation, setShowRoundValidation\] = useState\(false\)/)
  assert.match(golfLogger, /const \[showCreateTeamValidation, setShowCreateTeamValidation\] = useState\(false\)/)
  assert.match(golfLogger, /setShowRoundValidation\(true\)/)
  assert.match(golfLogger, /setShowCreateTeamValidation\(true\)/)
  assert.match(golfLogger, /showRoundValidation && missingFields.length/)
  assert.match(golfLogger, /showCreateTeamValidation && createMissing.length/)
})

test('homepage shows guest sample scores when no user is logged in', () => {
  const home = fs.readFileSync(new URL('../src/pages/Home.tsx', import.meta.url), 'utf8')
  const sample = fs.readFileSync(new URL('../src/lib/dashboardSample.ts', import.meta.url), 'utf8')

  assert.match(home, /setScores\(GUEST_HOME_SCORES\)/)
  assert.match(home, /user\?\.email \|\| GUEST_HOME_EMAIL/)
  assert.match(home, /Showing homepage demo data\./)
  assert.match(sample, /Bonneville Golf Course/)
  assert.match(sample, /Homie Hustlers/)
})

test('logging writes to root access and error log files with request middleware support', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const logger = fs.readFileSync(new URL('../server/lib/logger.js', import.meta.url), 'utf8')
  const gitignore = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8')

  assert.match(server, /app\.use\(accessLogMiddleware\)/)
  assert.match(server, /logRouteError\('/)
  assert.match(logger, /path\.resolve\(process\.cwd\(\), 'logging'\)/)
  assert.match(logger, /path\.join\(LOG_DIR, 'access\.log'\)/)
  assert.match(logger, /path\.join\(LOG_DIR, 'error\.log'\)/)
  assert.match(logger, /res\.on\('finish'/)
  assert.match(gitignore, /logging\/\*\.log/)
  assert.match(gitignore, /!logging\/\.gitkeep/)
})

test('homepage demo seeder can populate the sample rounds locally', () => {
  const pkg = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  const seed = fs.readFileSync(new URL('../server/scripts/seed-homepage-demo.js', import.meta.url), 'utf8')

  assert.match(pkg, /"seed:homepage-demo"/)
  assert.match(seed, /const DEMO_EMAIL = 'thegolfhomie@example\.com'/)
  assert.match(seed, /Bonneville Golf Course/)
  assert.match(seed, /Homie Hustlers/)
  assert.match(seed, /Seeded homepage demo data/)
})

test('safe mobile diagnostics use pixel beacons instead of recursive preboot network logging', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const frontendLogger = fs.readFileSync(new URL('../src/lib/frontend-logger.ts', import.meta.url), 'utf8')
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const logger = fs.readFileSync(new URL('../server/lib/logger.js', import.meta.url), 'utf8')

  assert.match(html, /\/diag\/pixel\.gif\?cid=/)
  assert.doesNotMatch(html, /api\/client-logs/)
  assert.doesNotMatch(html, /sendBeacon/)
  assert.match(frontendLogger, /new Image\(1, 1\)/)
  assert.doesNotMatch(frontendLogger, /window\.fetch\s*=/)
  assert.match(server, /app\.get\('\/diag\/pixel\.gif'/)
  assert.match(logger, /path\.join\(LOG_DIR, 'frontend\.log'\)/)
})


test('register route stays lazy-loaded to avoid pulling mobile-only register code into the initial bundle', () => {
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /lazy\(\(\) => import\('\.\/pages\/Register'\)\)/)
  assert.match(app, /Suspense fallback=/)
})

test('location resources use backend endpoints and keep datasets off the client', () => {
  const locations = fs.readFileSync(new URL('../src/lib/locations.ts', import.meta.url), 'utf8')
  const input = fs.readFileSync(new URL('../src/components/LocationInput.tsx', import.meta.url), 'utf8')
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')

  assert.match(locations, /fetch\(`/)
  assert.match(locations, /\/api\/locations\/search/)
  assert.match(locations, /\/api\/locations\/nearest/)
  assert.doesNotMatch(locations, /country-state-city/)
  assert.match(input, /searchLocations\(query, 8\)\s*\.then/)
  assert.match(input, /await getNearestLocation\(position\.coords\.latitude, position\.coords\.longitude\)/)
  assert.match(server, /app\.get\('\/api\/locations\/search'/)
  assert.match(server, /app\.get\('\/api\/locations\/nearest'/)
})


test('mobile location lookup runs on the server and keeps browser datasets out of the client', () => {
  const locations = fs.readFileSync(new URL('../src/lib/locations.ts', import.meta.url), 'utf8')
  const locationInput = fs.readFileSync(new URL('../src/components/LocationInput.tsx', import.meta.url), 'utf8')
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')

  assert.match(locations, /fetch\(`?\/api\/locations\/search/)
  assert.match(locations, /fetch\(`?\/api\/locations\/nearest/)
  assert.doesNotMatch(locations, /country-state-city/)
  assert.match(server, /app\.get\('\/api\/locations\/search'/)
  assert.match(server, /app\.get\('\/api\/locations\/nearest'/)
  assert.match(locationInput, /use_my_location_lookup_completed/)
  assert.match(locationInput, /use_my_location_lookup_failed/)
})


test('the package test script targets the maintained test suite files', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts.test, 'node --test test/app.test.js test/schema-rollback.test.js')
})

test('auth session lifetime is set to 24 hours and registration signs the user out until verification', () => {
  const authServer = fs.readFileSync(new URL('../server/auth.js', import.meta.url), 'utf8')
  const authContext = fs.readFileSync(new URL('../src/context/AuthContext.tsx', import.meta.url), 'utf8')
  const registerPage = fs.readFileSync(new URL('../src/pages/Register.tsx', import.meta.url), 'utf8')

  assert.match(authServer, /session:\s*\{[\s\S]*expiresIn:\s*60 \* 60 \* 24/)
  assert.match(authServer, /requireEmailVerification:\s*true/)
  assert.match(authServer, /sendOnSignIn:\s*true/)
  assert.match(authServer, /autoSignInAfterVerification:\s*false/)
  assert.match(authContext, /await signOutAuth\(\)/)
  assert.match(authContext, /setUser\(null\)/)
  assert.match(registerPage, /navigate\(`\/verify-contact\?email=\$\{encodeURIComponent\(result\.email\)\}/)
})


test('legacy users are backfilled as verified while new sign-ins still require verification', () => {
  const migrations = fs.readFileSync(new URL('../server/migrations/index.js', import.meta.url), 'utf8')
  const sql = fs.readFileSync(new URL('../migration_scripts/20260402_004_backfill_legacy_users_as_verified.sql', import.meta.url), 'utf8')
  const authApi = fs.readFileSync(new URL('../src/lib/auth-api.ts', import.meta.url), 'utf8')

  assert.match(migrations, /20260402_004/)
  assert.match(migrations, /backfill_legacy_users_as_verified/)
  assert.match(sql, /UPDATE `user`/)
  assert.match(sql, /SET emailVerified = TRUE/)
  assert.match(sql, /WHERE COALESCE\(emailVerified, FALSE\) = FALSE/)
  assert.match(authApi, /EMAIL_NOT_VERIFIED/)
  assert.match(authApi, /Your account is not verified yet\./)
})

test('smtp logging has a dedicated smtp log with shared correlation ids', () => {
  const logger = fs.readFileSync(new URL('../server/lib/logger.js', import.meta.url), 'utf8')
  const mailer = fs.readFileSync(new URL('../server/mailer.js', import.meta.url), 'utf8')
  const pkg = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  const cleanupScript = fs.readFileSync(new URL('../server/scripts/cleanup-logs.js', import.meta.url), 'utf8')

  assert.match(logger, /path\.join\(LOG_DIR, 'smtp\.log'\)/)
  assert.match(logger, /export function logSmtp/)
  assert.match(logger, /export function getCorrelationId/)
  assert.match(logger, /requestStore\.run\(\{ correlationId \}/)
  assert.match(mailer, /logSmtp\('smtp_send_started'/)
  assert.match(mailer, /logSmtp\('smtp_send_succeeded'/)
  assert.match(mailer, /logSmtp\('smtp_send_failed'/)
  assert.match(pkg, /"prebuild": "node server\/scripts\/cleanup-logs\.js"/)
  assert.match(cleanupScript, /7 \* 24 \* 60 \* 60 \* 1000/)
})


test('verification flow prepopulates email and shows registration completion guidance', () => {
  const verifyPage = fs.readFileSync(new URL('../src/pages/VerifyContact.tsx', import.meta.url), 'utf8')
  assert.match(verifyPage, /const startingEmail = useMemo\(\(\) => params\.get\('email'\) \|\| ''/)
  assert.match(verifyPage, /value=\{email\}/)
  assert.match(verifyPage, /Check your email to finish registration/)
})

test('navigation keeps Home and My Golf Scores on the top nav and uses a styled collapsible menu', () => {
  const nav = fs.readFileSync(new URL('../src/components/NavBar.tsx', import.meta.url), 'utf8')
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.match(nav, /<A to="\/">Home<\/A>/)
  assert.match(nav, /<A to="\/my-golf-scores">My Golf Scores<\/A>/)
  assert.match(nav, /Invite Homie/)
  assert.match(css, /\.navDropdownItem/)
  assert.match(css, /color:#c2410c/)
})

test('teams page shows pending verification states, registration invites, and restored edit capability', () => {
  const teamsPage = fs.readFileSync(new URL('../src/pages/Teams.tsx', import.meta.url), 'utf8')
  assert.match(teamsPage, /Pending teammate verification/)
  assert.match(teamsPage, /Send Registration Invite/)
  assert.match(teamsPage, /Click to edit roster/)
  assert.match(teamsPage, /const \[editTeamId, setEditTeamId\] = useState/)
  assert.match(teamsPage, /setInterval\(load, 15000\)/)
})

test('registration invites target the client app route and preserve the email query', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  assert.match(server, /function getClientAppBaseUrl\(req\)/)
  assert.match(server, /new URL\('\/register', getClientAppBaseUrl\(req\)\)/)
  assert.match(server, /url\.searchParams\.set\('email', normalizeEmail\(email\)\)/)
  assert.match(server, /app\.get\(\['\/register', '\/login', '\/verify-contact'\]/)
})


test('local dev bootstrap seeds PORT before docker compose and keeps client/server ports separate', () => {
  const localDev = fs.readFileSync(new URL('../server/scripts/local-dev.js', import.meta.url), 'utf8')
  const compose = fs.readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8')
  const envExample = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8')

  assert.match(localDev, /const serverPort = process\.env\.PORT \|\| '5001'/)
  assert.match(localDev, /PORT: serverPort/)
  assert.match(localDev, /CLIENT_PORT: clientPort/)
  assert.match(localDev, /env: process\.env/)
  assert.match(compose, /PORT: \$\{PORT:-5001\}/)
  assert.match(compose, /- "\$\{PORT:-5001\}:\$\{PORT:-5001\}"/)
  assert.match(envExample, /^PORT=5001/m)
  assert.match(envExample, /^CLIENT_PORT=5174/m)
})
