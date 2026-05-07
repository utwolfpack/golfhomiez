import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { readFile } from 'node:fs/promises'
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

test('better auth client prefers same-origin in deployed environments and only allows loopback cross-origin locally', () => {
  const source = fs.readFileSync(new URL('../src/lib/auth-client.ts', import.meta.url), 'utf8')
  assert.match(source, /const sameOriginDefault = '\/api\/auth'/)
  assert.match(source, /pageUrl\.origin !== targetUrl\.origin/)
  assert.match(source, /return normalizeUrl\(new URL\(sameOriginDefault, pageUrl\)\.toString\(\)\)/)
  assert.match(source, /pageIsLoopback && targetIsLoopback/)
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



test('profile page removes state code, uses smiley selection, and redirects home after save', () => {
  const profile = fs.readFileSync(new URL('../src/pages/Profile.tsx', import.meta.url), 'utf8')
  const profileLib = fs.readFileSync(new URL('../src/lib/profile.ts', import.meta.url), 'utf8')
  const locationButton = fs.readFileSync(new URL('../src/components/UseMyLocationButton.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(profile, /Primary location/)
  assert.doesNotMatch(profile, /Edit profile/)
  assert.doesNotMatch(profile, /Update where you play and what kind of golf company you are looking for\./)
  assert.doesNotMatch(profile, /State code/)
  assert.match(profile, /saving \? 'Saving…' : 'Save'/)
  assert.match(profile, /You are alcohol freindly/)
  assert.match(profile, /You are 420 freindly/)
  assert.match(profile, /Prefer to golf with other sober golfers/)
  assert.match(profile, /Selected preference/)
  assert.match(profile, /navigate\('\/', \{ replace: true \}\)/)
  assert.match(profile, /if \(prev\.sobrietyPreference === 'sober_only'\) return prev/)
  assert.match(profile, /if \(prev\.alcoholPreference === 'alcohol_friendly' \|\| prev\.cannabisPreference === 'weed_friendly'\) return prev/)
  assert.doesNotMatch(profileLib, /primaryStateCode/)
  assert.doesNotMatch(locationButton, /Location set to/)
})

test('profile server schema and migration remove primary_state_code and reject conflicting preferences', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const migrations = fs.readFileSync(new URL('../server/migrations/index.js', import.meta.url), 'utf8')
  const migrationSql = fs.readFileSync(new URL('../migration_scripts/20260413_011_remove_profile_state_code.sql', import.meta.url), 'utf8')
  const initialSql = fs.readFileSync(new URL('../migration_scripts/20260411_010_app_user_profiles.sql', import.meta.url), 'utf8')

  assert.doesNotMatch(server, /primary_state_code/)
  assert.match(server, /City, state, and zip code are required\./)
  assert.match(server, /Sober golf cannot be combined with alcohol or 420 preferences\./)
  assert.match(server, /profile_save_started/)
  assert.match(migrations, /20260413_011/)
  assert.match(migrations, /remove_profile_state_code/)
  assert.match(migrationSql, /DROP COLUMN primary_state_code/)
  assert.doesNotMatch(initialSql, /primary_state_code/)
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

test('location resources use backend endpoints and keep datasets off the client', async () => {
  const source = await readFile(new URL('../src/lib/locations.ts', import.meta.url), 'utf8')
  assert.match(source, /(fetchJson|fetch)\s*(<[^>]+>)?\s*\(/)
  assert.match(source, /\/api\/locations\/search/)
  assert.match(source, /\/api\/locations\/nearest/)
  assert.doesNotMatch(source, /from ['"].*locations.*dataset/i)
  assert.doesNotMatch(source, /allUsCities|zipcodes|geonames/i)
})

test('mobile location lookup runs on the server and keeps browser datasets out of the client', async () => {
  const source = await readFile(new URL('../src/lib/locations.ts', import.meta.url), 'utf8')
  assert.match(source, /(fetchJson|fetch)\s*(<[^>]+>)?\s*\(\s*`?\/api\/locations\/search/)
  assert.match(source, /(fetchJson|fetch)\s*(<[^>]+>)?\s*\(\s*`?\/api\/locations\/nearest/)
  assert.match(source, /navigator\.geolocation/)
  assert.doesNotMatch(source, /allUsCities|zipcodes|geonames/i)
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

test('navigation uses the styled dropdown menu items and keeps invite access available', () => {
  const nav = fs.readFileSync(new URL('../src/components/NavBar.tsx', import.meta.url), 'utf8')
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.match(nav, /Invite Homie/)
  assert.match(css, /\.navDropdownItem/)
  assert.match(css, /background:#f0fdf4/)
  assert.match(css, /color:#15803d/)
})

test('teams page shows pending verification states, registration invites, and restored edit capability', () => {
  const teamsPage = fs.readFileSync(new URL('../src/pages/Teams.tsx', import.meta.url), 'utf8')
  assert.match(teamsPage, /Pending teammate verification/)
  assert.match(teamsPage, /Send Registration Invite/)
  assert.match(teamsPage, /Click to edit roster/)
  assert.match(teamsPage, /const \[editTeamId, setEditTeamId\] = useState/)
  assert.match(teamsPage, /setInterval\(load, 15000\)/)
})

test('registration routes stay same-origin and client log ingestion supports both legacy and current endpoints', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const authClient = fs.readFileSync(new URL('../src/lib/auth-client.ts', import.meta.url), 'utf8')
  assert.match(server, /app\.(post|all)\(\['\/api\/client-logs', '\/api\/client-log'/)
  assert.match(server, /return process\.env\.BETTER_AUTH_URL \|\| `\$\{req\.protocol\}:\/\/\$\{req\.get\('host'\)\}`/)
  assert.match(authClient, /const sameOriginDefault = '\/api\/auth'/)
})


test('client log ingestion endpoints support singular and plural routes', async () => {
  const source = await readFile(new URL('../server/index.js', import.meta.url), 'utf8')
  assert.match(source, /app\.post\(\s*\[\s*['"]\/api\/client-logs['"]\s*,\s*['"]\/api\/client-log['"]\s*\]/)
  assert.match(source, /status\(204\)\.end\(\)/)
})

test('auth API defaults to same-origin auth in deployed environments when override origin mismatches', async () => {
  const authApi = fs.readFileSync(new URL('../src/lib/auth-api.ts', import.meta.url), 'utf8')
  assert.match(authApi, /pageUrl\.origin !== targetUrl\.origin/)
  assert.match(authApi, /new URL\(sameOriginDefault, pageUrl\)\.toString\(\)/)
})


test('app startup resets session log files so logs only reflect the current session', () => {
  const pkg = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  const localDev = fs.readFileSync(new URL('../server/scripts/local-dev.js', import.meta.url), 'utf8')
  const resetScript = fs.readFileSync(new URL('../server/scripts/reset-session-logs.js', import.meta.url), 'utf8')

  assert.match(pkg, /"start": "node server\/scripts\/reset-session-logs\.js && node server\/index\.js"/)
  assert.match(pkg, /"dev:server": "node server\/scripts\/reset-session-logs\.js && nodemon server\/index\.js"/)
  assert.match(localDev, /server\/scripts\/reset-session-logs\.js/)
  assert.match(resetScript, /SESSION_LOGS = \['access\.log', 'api\.log', 'error\.log', 'frontend\.log', 'smtp\.log'\]/)
  assert.match(resetScript, /RESET_APP_LOGS_ON_START/)
  assert.match(resetScript, /fs\.writeFileSync\(filePath, ''\)/)
})


test('profile enrichment runs on first sign-in and adds editable profile fields with location prefill', () => {
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const authContext = fs.readFileSync(new URL('../src/context/AuthContext.tsx', import.meta.url), 'utf8')
  const profilePage = fs.readFileSync(new URL('../src/pages/Profile.tsx', import.meta.url), 'utf8')
  const nav = fs.readFileSync(new URL('../src/components/NavBar.tsx', import.meta.url), 'utf8')

  assert.match(app, /ProfileEnrichmentGate/)
  assert.match(app, /navigate\('\/profile\?enrich=1'/)
  assert.match(app, /path="\/profile"/)
  assert.match(authContext, /needsProfileEnrichment/)
  assert.match(profilePage, /UseMyLocationButton/)
  assert.match(profilePage, /We only ask this once on your first sign-in/)
  assert.match(profilePage, /Alcohol-friendly/)
  assert.match(profilePage, /420 friendly/)
  assert.match(profilePage, /Prefer to golf with other sober golfers/)
  assert.match(profilePage, /🙂/)
  assert.match(nav, /to="\/profile"/)
})

test('profile API and migration support one-time enrichment and stored location preferences', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const migrations = fs.readFileSync(new URL('../server/migrations/index.js', import.meta.url), 'utf8')
  const sql = fs.readFileSync(new URL('../migration_scripts/20260411_010_app_user_profiles.sql', import.meta.url), 'utf8')
  const locationService = fs.readFileSync(new URL('../server/lib/location-service.js', import.meta.url), 'utf8')

  assert.match(server, /app\.get\('\/api\/profile'/)
  assert.match(server, /app\.put\('\/api\/profile'/)
  assert.match(server, /profile_enriched_at = COALESCE\(profile_enriched_at, NOW\(\)\)/)
  assert.match(server, /primary_zip_code/)
  assert.match(migrations, /20260411_010/)
  assert.match(migrations, /app_user_profiles/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS app_users/)
  assert.match(sql, /primary_zip_code/)
  assert.match(sql, /profile_enriched_at/)
  assert.match(locationService, /postcode/)
})

test('host auth flow adds direct host routes, public account requests, invite redemption, and reset endpoints', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const hostAuth = fs.readFileSync(new URL('../server/lib/host-auth.js', import.meta.url), 'utf8')
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const hostRegister = fs.readFileSync(new URL('../src/pages/CreateHostAccount.tsx', import.meta.url), 'utf8')
  const hostRedeem = fs.readFileSync(new URL('../src/pages/RedeemHostInvite.tsx', import.meta.url), 'utf8')
  const hostLogin = fs.readFileSync(new URL('../src/pages/HostLogin.tsx', import.meta.url), 'utf8')
  const hostReset = fs.readFileSync(new URL('../src/pages/HostResetPassword.tsx', import.meta.url), 'utf8')
  const hostClient = fs.readFileSync(new URL('../src/lib/host-auth.ts', import.meta.url), 'utf8')
  const migration = fs.readFileSync(new URL('../migration_scripts/20260417_012_host_auth_portal.sql', import.meta.url), 'utf8')

  assert.match(server, /app\.post\('\/api\/host\/account-requests'/)
  assert.match(server, /app\.post\('\/api\/host\/register'/)
  assert.match(server, /app\.post\('\/api\/host\/login'/)
  assert.match(server, /app\.post\('\/api\/host\/request-password-reset'/)
  assert.match(server, /app\.post\('\/api\/host\/reset-password'/)
  assert.match(server, /app\.get\('\/api\/host\/portal'/)
  assert.match(server, /'\/host\/redeem'/)
  assert.match(server, /serializeHostSessionCookie/)
  assert.match(hostAuth, /CREATE TABLE IF NOT EXISTS host_accounts/)
  assert.match(hostAuth, /CREATE TABLE IF NOT EXISTS host_sessions/)
  assert.match(hostAuth, /CREATE TABLE IF NOT EXISTS host_password_reset_tokens/)
  assert.match(hostAuth, /is_validated = 1/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS host_accounts/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS host_sessions/)
  assert.match(app, /path="\/host\/login"/)
  assert.match(app, /path="\/host\/portal"/)
  assert.match(app, /path="\/host\/register"/)
  assert.match(app, /path="\/host\/redeem"/)
  assert.match(hostClient, /\/api\/host\/account-requests/)
  assert.match(hostRegister, /Request your golf-course account/)
  assert.match(hostRegister, /<label className="label">State<\/label>/)
  assert.match(hostRegister, /<label className="label">Golf Course<\/label>/)
  assert.match(hostRegister, /<label className="label">Password<\/label>/)
  assert.match(hostRegister, /<label className="label">Confirm password<\/label>/)
  assert.match(hostRegister, /thank you for your Golf Homiez golf-course account request/i)
  assert.doesNotMatch(hostRegister, /Have an invite\?/) 
  assert.doesNotMatch(hostRegister, /UseMyLocationButton/)
  assert.doesNotMatch(hostRegister, /Public sign-up for golf-course admins\./)
  assert.match(hostRedeem, /Create your golf-course account/)
  assert.match(hostRedeem, /Security key/)
  assert.match(hostRedeem, /Create golf-course account/)
  assert.match(hostLogin, /Sign in to your host portal/)
  assert.match(hostLogin, /to="\/host\/redeem"/)
  assert.match(hostLogin, /Forgot host password\?/) 
  assert.match(hostReset, /Finish your golf-course password reset/)
})


test('admin portal can approve or delete golf-course account requests and sends host approval email guidance', () => {
  const adminPortal = fs.readFileSync(new URL('../src/pages/AdminPortal.tsx', import.meta.url), 'utf8')
  const adminClient = fs.readFileSync(new URL('../src/lib/admin.ts', import.meta.url), 'utf8')
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const adminLib = fs.readFileSync(new URL('../server/lib/admin-portal.js', import.meta.url), 'utf8')
  const migrationIndex = fs.readFileSync(new URL('../server/migrations/index.js', import.meta.url), 'utf8')
  const migrationSql = fs.readFileSync(new URL('../migration_scripts/20260422_017_host_account_requests.sql', import.meta.url), 'utf8')
  const migrationSqlPassword = fs.readFileSync(new URL('../migration_scripts/20260422_018_host_account_request_password_hash.sql', import.meta.url), 'utf8')

  assert.match(adminPortal, /Pending requests/)
  assert.match(adminPortal, /Golf-course account requests/)
  assert.match(adminPortal, /Approve request/)
  assert.match(adminPortal, /Delete request/)
  assert.match(adminClient, /approveHostAccountRequest/)
  assert.match(adminClient, /deleteHostAccountRequest/)
  assert.match(server, /app\.post\('\/api\/admin\/host-account-requests\/:id\/approve'/)
  assert.match(server, /app\.delete\('\/api\/admin\/host-account-requests\/:id'/)
  assert.match(server, /host_account_request_created/)
  assert.match(server, /host_account_request_approved/)
  assert.match(server, /host_account_request_deleted/)
  assert.match(adminLib, /CREATE TABLE IF NOT EXISTS host_account_requests/)
  assert.match(adminLib, /sendHostAccountRequestNotification/)
  assert.match(adminLib, /sendHostAccountApprovalEmail/)
  assert.match(adminLib, /deleteHostAccountRequest/)
  assert.match(adminLib, /Only pending golf-course account requests can be deleted\./)
  assert.match(adminLib, /Your Golf Homiez golf-course account has been approved\./)
  assert.match(adminLib, /You can login to your account <a href=.*>here<\/a>/)
  assert.match(adminLib, /requested_password_hash/)
  assert.match(adminLib, /passwordHash: request\.requested_password_hash/)
  assert.match(migrationIndex, /20260422_017/)
  assert.match(migrationIndex, /20260422_018/)
  assert.match(migrationIndex, /host_account_requests/)
  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS host_account_requests/)
  assert.match(migrationSql, /representative_details/)
  assert.match(migrationSqlPassword, /requested_password_hash/)
})

test('mysql score storage remains compatible before and after golf-course score columns exist', async () => {
  const mysqlStorage = await readFile(new URL('../server/storage/mysql.js', import.meta.url), 'utf8')
  const migrations = await readFile(new URL('../server/migrations/index.js', import.meta.url), 'utf8')
  const migrationSql = await readFile(new URL('../migration_scripts/20260421_016_scores_golf_course_catalog_columns.sql', import.meta.url), 'utf8')

  assert.match(mysqlStorage, /information_schema\.columns/)
  assert.match(mysqlStorage, /table_name = 'scores'/)
  assert.match(mysqlStorage, /optionalColumnEntries/)
  assert.match(mysqlStorage, /golf_course_id/)
  assert.match(mysqlStorage, /course_rating/)
  assert.match(mysqlStorage, /slope_rating/)
  assert.match(mysqlStorage, /course_par/)
  assert.match(migrations, /20260421_016/)
  assert.match(migrations, /scores_golf_course_catalog_columns/)
  assert.match(migrationSql, /ADD COLUMN golf_course_id/)
  assert.match(migrationSql, /ADD INDEX idx_scores_golf_course_id/)
})

test('auth TTL is 24 hours and refreshed on authenticated activity for user, admin, and host sessions', () => {
  const betterAuth = fs.readFileSync(new URL('../server/auth.js', import.meta.url), 'utf8')
  const adminPortal = fs.readFileSync(new URL('../server/lib/admin-portal.js', import.meta.url), 'utf8')
  const hostAuth = fs.readFileSync(new URL('../server/lib/host-auth.js', import.meta.url), 'utf8')
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const authContext = fs.readFileSync(new URL('../src/context/AuthContext.tsx', import.meta.url), 'utf8')
  const hostContext = fs.readFileSync(new URL('../src/context/HostAuthContext.tsx', import.meta.url), 'utf8')

  assert.match(betterAuth, /expiresIn: 60 \* 60 \* 24/)
  assert.match(betterAuth, /updateAge: 0/)
  assert.match(adminPortal, /ADMIN_SESSION_TTL_MS = 1000 \* 60 \* 60 \* 24/)
  assert.match(adminPortal, /refreshAdminSessionCookie/)
  assert.match(hostAuth, /HOST_SESSION_TTL_MS = 1000 \* 60 \* 60 \* 24/)
  assert.match(hostAuth, /refreshHostSessionExpiry/)
  assert.match(hostAuth, /UPDATE host_sessions SET expires_at = \?, updated_at = NOW\(\)/)
  assert.match(server, /admin_session_ttl_refreshed/)
  assert.match(server, /host_session_ttl_refreshed/)
  assert.match(authContext, /activity_ttl_refresh_started/)
  assert.match(hostContext, /activity_ttl_refresh_started/)
})

test('expired authenticated sessions redirect to the correct login page and log frontend event data', () => {
  const sessionExpiration = fs.readFileSync(new URL('../src/lib/session-expiration.ts', import.meta.url), 'utf8')
  const api = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8')
  const authApi = fs.readFileSync(new URL('../src/lib/auth-api.ts', import.meta.url), 'utf8')
  const request = fs.readFileSync(new URL('../src/lib/request.ts', import.meta.url), 'utf8')

  assert.match(sessionExpiration, /session_ttl_exhausted_redirect/)
  assert.match(sessionExpiration, /path\.startsWith\('\/host'\)/)
  assert.match(sessionExpiration, /HOST_LOGIN_ROUTE = '\/host\/login'/)
  assert.match(sessionExpiration, /ADMIN_LOGIN_ROUTE = '\/golfadmin'/)
  assert.match(sessionExpiration, /USER_LOGIN_ROUTE = '\/login'/)
  assert.match(api, /handleExpiredSession\('api', res\.status\)/)
  assert.match(authApi, /handleExpiredSession\('auth', res\.status\)/)
  assert.match(request, /handleExpiredSession\('requestJson', response\.status\)/)
})

test('auth TTL migration and port configuration are deployable without hardcoded server ports', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const migration = fs.readFileSync(new URL('../migration_scripts/20260501_023_auth_ttl_and_logging_support.sql', import.meta.url), 'utf8')
  const directions = fs.readFileSync(new URL('../AUTH_TTL_LOGGING_DIRECTIONS.md', import.meta.url), 'utf8')

  assert.match(server, /const PORT = Number\(process\.env\.PORT\)/)
  assert.match(server, /PORT must be set to a valid positive number/)
  assert.doesNotMatch(server, /const PORT = Number\(process\.env\.PORT \|\| 5001\)/)
  assert.match(migration, /idx_host_sessions_expires/)
  assert.match(migration, /idx_host_sessions_updated_at/)
  assert.match(migration, /DELETE FROM host_sessions WHERE expires_at IS NOT NULL AND expires_at <= NOW\(\)/)
  assert.match(directions, /20260501_023_auth_ttl_and_logging_support\.sql/)
})


test('host portal exposes tournament creation, portal listing, and organizer invite routes', () => {
  const source = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  assert.match(source, /app\.get\('\/api\/host\/portal', hostAuthMiddleware/)
  assert.match(source, /listHostPortalTournaments\(db, account\)/)
  assert.match(source, /app\.post\('\/api\/host\/tournaments', hostAuthMiddleware/)
  assert.match(source, /createHostManagedTournament\(db, req\.hostAccount\.id, req\.body \|\| \{\}\)/)
  assert.match(source, /app\.post\('\/api\/host\/tournaments\/:id\/invite', hostAuthMiddleware/)
  assert.match(source, /createTournamentOrganizerInvite\(db, \{ tournamentId, hostAccountId: req\.hostAccount\.id, organizerEmail: payload\.organizerEmail, inviteUrl: organizerUrl \}\)/)
})

test('organizer invite flow exposes direct auth, portal, eligibility, and public tournament portal endpoints', () => {
  const source = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  assert.match(source, /app\.get\('\/api\/organizer\/session'/)
  assert.match(source, /app\.post\('\/api\/organizer\/register'/)
  assert.match(source, /app\.post\('\/api\/organizer\/login'/)
  assert.match(source, /app\.get\('\/api\/organizer\/portal', requireStorage, organizerAuthMiddleware/)
  assert.match(source, /app\.get\('\/api\/organizer\/invite-eligibility'/)
  assert.match(source, /app\.get\('\/api\/tournament-portals\/:id'/)
})

test('organizer sessions use the same 24-hour sliding TTL pattern as host sessions', () => {
  const source = fs.readFileSync(new URL('../server/lib/organizer-auth.js', import.meta.url), 'utf8')
  assert.match(source, /ORGANIZER_SESSION_TTL_MS = 1000 \* 60 \* 60 \* 24(?! \*)/)
  assert.match(source, /refreshOrganizerSessionExpiry/)
  assert.match(source, /expires_at = \? WHERE token_hash = \?/)
  assert.match(source, /res\.setHeader\('Set-Cookie', serializeOrganizerSessionCookie\(sessionId\)\)/)
})

test('organizer portal only edits host-invited tournaments and does not create tournaments', () => {
  const organizerPage = fs.readFileSync(new URL('../src/pages/OrganizerTournaments.tsx', import.meta.url), 'utf8')
  const accounts = fs.readFileSync(new URL('../src/lib/accounts.ts', import.meta.url), 'utf8')
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')

  assert.match(organizerPage, /Manage invited tournaments/)
  assert.match(organizerPage, /Modify tournament/)
  assert.match(organizerPage, /updateOrganizerTournamentRecord/)
  assert.doesNotMatch(organizerPage, /Create tournament/)
  assert.doesNotMatch(organizerPage, /fetchGolfCourses/)
  assert.match(accounts, /\/api\/organizer\/tournaments\/\$\{encodeURIComponent\(tournamentId\)\}/)
  assert.match(server, /organizer_tournament_create_blocked/)
  assert.match(server, /app\.put\('\/api\/organizer\/tournaments\/:id'/)
  assert.match(server, /updateOrganizerInvitedTournament/)
})

test('tournament portal lookup accepts host-generated public identifiers as well as ids', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  assert.match(server, /WHERE t\.id = \? OR t\.tournament_identifier = \?/)
  assert.match(server, /tournamentIdentifier: row\.tournament_identifier \|\| null/)
})



test('host portal queries support stage schemas without host role assignment ids', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')

  assert.match(server, /hostRoleColumns\.has\('role_assignment_id'\)/)
  assert.match(server, /hostRoleAssignmentJoinConditions/)
  assert.match(server, /LEFT JOIN user_role_assignments host_ura ON \$\{hostRoleAssignmentJoinConditions\}/)
  assert.match(server, /\|\| '1 = 0'/)
  assert.doesNotMatch(server, new RegExp("LEFT JOIN user_role_assignments host_ura ON host_ura\\.id = hra\\.role_assignment_id\\n       LEFT JOIN host_accounts"))
})

test('host portal lets hosts modify every golf-course tournament and exposes published registration URLs', () => {
  const hostPage = fs.readFileSync(new URL('../src/pages/HostPortal.tsx', import.meta.url), 'utf8')
  const accounts = fs.readFileSync(new URL('../src/lib/accounts.ts', import.meta.url), 'utf8')
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const organizerPage = fs.readFileSync(new URL('../src/pages/OrganizerTournaments.tsx', import.meta.url), 'utf8')

  assert.match(hostPage, /updateHostTournamentRecord/)
  assert.match(hostPage, /Click a tile to modify the tournament/)
  assert.match(hostPage, /Golfer registration URL/)
  assert.match(hostPage, /host_tournament_updated/)
  assert.match(accounts, /export function updateHostTournamentRecord/)
  assert.match(accounts, /\/api\/host\/tournaments\/\$\{encodeURIComponent\(tournamentId\)\}/)
  assert.match(accounts, /registrationUrl\?: string \| null/)
  assert.match(server, /app\.put\('\/api\/host\/tournaments\/:id', hostAuthMiddleware/)
  assert.match(server, /updateHostOwnedTournament\(getPool\(\), req\.hostAccount, tournamentId, input, req\)/)
  assert.match(server, /getHostEditableTournament/)
  assert.match(server, /registrationUrl: String\(row\.status \|\| ''\) === 'published'/)
  assert.match(organizerPage, /Golfer registration URL/)
})

test('published tournament registration uses resolved tournament id for foreign key inserts', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')

  assert.match(server, /const resolvedTournamentId = portal\.tournament\.id/)
  assert.match(server, /\[registrationId, resolvedTournamentId, req\.user\.id/)
  assert.match(server, /requestedTournamentId: tournamentId/)
  assert.doesNotMatch(server, /normalizeEmail\(req\.organizerUser\.email\)/)
})

test('host and organizer tournament tiles expose registered golfer counts and details', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const accounts = fs.readFileSync(new URL('../src/lib/accounts.ts', import.meta.url), 'utf8')
  const hostPage = fs.readFileSync(new URL('../src/pages/HostPortal.tsx', import.meta.url), 'utf8')
  const organizerPage = fs.readFileSync(new URL('../src/pages/OrganizerTournaments.tsx', import.meta.url), 'utf8')

  assert.match(server, /async function listTournamentRegistrations/)
  assert.match(server, /attachTournamentRegistrations\(pool, tournaments\)/)
  assert.match(accounts, /export type TournamentRegistration/)
  assert.match(hostPage, /Registered golfers/)
  assert.match(hostPage, /registration\.email/)
  assert.match(organizerPage, /Registered golfers/)
  assert.match(organizerPage, /registration\.registeredAt/)
})

test('tournament registration sends confirmation email with tournament link', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  assert.match(server, /tournament_registration_confirmation_email_sent/)
  assert.match(server, /Registration confirmed:/)
  assert.match(server, /View tournament details/)
  assert.match(server, /const registrationUrl = portal\.tournament\.portalUrl/)
})

test('signed-in golfers have a registered tournaments page and API route', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const navSource = fs.readFileSync(new URL('../src/components/NavBar.tsx', import.meta.url), 'utf8')
  const accountSource = fs.readFileSync(new URL('../src/lib/accounts.ts', import.meta.url), 'utf8')
  const serverSource = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')

  assert.match(appSource, /path="\/my-tournaments"/)
  assert.match(navSource, /to="\/my-tournaments"/)
  assert.match(accountSource, /fetchUserTournaments/)
  assert.match(accountSource, /\/api\/users\/tournaments/)
  assert.match(serverSource, /app\.get\('\/api\/users\/tournaments'/)
  assert.match(serverSource, /JOIN tournaments t ON t\.id = tr\.tournament_id/)
  assert.match(serverSource, /tr\.auth_user_id = \?/)
})

test('tournament portal marks already registered golfers and replaces register button with a label', () => {
  const portalPage = fs.readFileSync(new URL('../src/pages/TournamentPortal.tsx', import.meta.url), 'utf8')
  const accountLib = fs.readFileSync(new URL('../src/lib/accounts.ts', import.meta.url), 'utf8')

  assert.match(portalPage, /setRegistered\(Boolean\(result\.isViewerRegistered\)\)/)
  assert.match(portalPage, /You are already registered for this tournament\./)
  assert.match(portalPage, /registered \? \(/)
  assert.match(portalPage, /Register for tournament/)
  assert.doesNotMatch(portalPage, /disabled=\{registering \|\| registered \|\| registrationClosed \|\| authLoading\}/)
  assert.match(accountLib, /isViewerRegistered\?: boolean/)
  assert.match(accountLib, /viewerRegistration\?: TournamentRegistration \| null/)
})

test('server blocks duplicate tournament registration instead of upserting existing rows', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')

  assert.match(server, /tournament_registration_duplicate_blocked/)
  assert.match(server, /alreadyRegistered: true/)
  assert.match(server, /You are already registered for this tournament\./)
  assert.doesNotMatch(server, /ON DUPLICATE KEY UPDATE[\s\S]*tournament_registration_completed/)
})

test('tournament registrations migration keeps tournament_id compatible with tournaments id and runs during npm install', () => {
  const migrationSql = fs.readFileSync(new URL('../migration_scripts/20260427_020_tournament_portals_registrations.sql', import.meta.url), 'utf8')
  const migrations = fs.readFileSync(new URL('../server/migrations/index.js', import.meta.url), 'utf8')
  const pkg = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')

  assert.match(migrationSql, /tournament_id VARCHAR\(191\) NOT NULL/)
  assert.doesNotMatch(migrationSql, /tournament_id VARCHAR\(64\) NOT NULL/)
  assert.match(migrationSql, /FOREIGN KEY \(tournament_id\) REFERENCES tournaments\(id\)/)
  assert.match(migrations, /MODIFY COLUMN tournament_id \$\{tournamentIdDefinition\}/)
  assert.match(migrations, /character_set_name/)
  assert.match(migrations, /collation_name/)
  assert.match(pkg, /"postinstall": "npm run db:migrate && npm run build"/)
})

test('tournament registration requires two-person or four-person teams and stores team details', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const accounts = fs.readFileSync(new URL('../src/lib/accounts.ts', import.meta.url), 'utf8')
  const portalPage = fs.readFileSync(new URL('../src/pages/TournamentPortal.tsx', import.meta.url), 'utf8')
  const migrationSql = fs.readFileSync(new URL('../migration_scripts/20260507_024_tournament_registration_teams.sql', import.meta.url), 'utf8')
  const migrations = fs.readFileSync(new URL('../server/migrations/index.js', import.meta.url), 'utf8')

  assert.match(server, /resolveRegistrationTeam/)
  assert.match(server, /Tournament teams must have exactly 2 or 4 players\./)
  assert.match(server, /You must be a member of an existing team/)
  assert.match(server, /team_id, team_name, team_members_json/)
  assert.match(accounts, /fetchMyTeams/)
  assert.match(accounts, /teamMembers\?: Array/)
  assert.match(portalPage, /Register for tournament team/)
  assert.match(portalPage, /Teams signed up/)
  assert.match(migrationSql, /team_members_json JSON/)
  assert.match(migrations, /20260507_024/)
})

test('published status controls public tournament visibility and visibility checkbox is removed', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const hostPage = fs.readFileSync(new URL('../src/pages/HostPortal.tsx', import.meta.url), 'utf8')
  const organizerPage = fs.readFileSync(new URL('../src/pages/OrganizerTournaments.tsx', import.meta.url), 'utf8')
  const rbac = fs.readFileSync(new URL('../server/lib/rbac.js', import.meta.url), 'utf8')

  assert.match(server, /portal\.tournament\.status !== 'published'/)
  assert.match(server, /isPublic: status === 'published'/)
  assert.match(rbac, /const isPublic = status === 'published'/)
  assert.doesNotMatch(hostPage, /Make this tournament publicly visible/)
  assert.doesNotMatch(organizerPage, /Make this tournament publicly visible/)
})

test('front-end tournament times are formatted without milliseconds and profile enrichment clears enrich query parameter', () => {
  const timeFormat = fs.readFileSync(new URL('../src/lib/time-format.ts', import.meta.url), 'utf8')
  const hostPage = fs.readFileSync(new URL('../src/pages/HostPortal.tsx', import.meta.url), 'utf8')
  const organizerPage = fs.readFileSync(new URL('../src/pages/OrganizerTournaments.tsx', import.meta.url), 'utf8')
  const profilePage = fs.readFileSync(new URL('../src/pages/Profile.tsx', import.meta.url), 'utf8')

  assert.match(timeFormat, /formatDateTimeNoMilliseconds/)
  assert.doesNotMatch(timeFormat, /fractionalSecondDigits/)
  assert.match(hostPage, /formatFriendlyDateTime/)
  assert.match(organizerPage, /formatFriendlyDateTime/)
  assert.match(profilePage, /refreshProfileStatus/)
  assert.match(profilePage, /\/\?profileEnriched=1/)
})

test('tournament UI supports a single tournament date and clears end date on updates', () => {
  const hostPage = fs.readFileSync(new URL('../src/pages/HostPortal.tsx', import.meta.url), 'utf8')
  const organizerPage = fs.readFileSync(new URL('../src/pages/OrganizerTournaments.tsx', import.meta.url), 'utf8')
  const tournamentPortal = fs.readFileSync(new URL('../src/pages/TournamentPortal.tsx', import.meta.url), 'utf8')
  const myTournaments = fs.readFileSync(new URL('../src/pages/MyTournaments.tsx', import.meta.url), 'utf8')
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const rbac = fs.readFileSync(new URL('../server/lib/rbac.js', import.meta.url), 'utf8')

  assert.match(hostPage, /Tournament date/)
  assert.match(organizerPage, /Tournament date/)
  assert.doesNotMatch(hostPage, /End date/)
  assert.doesNotMatch(organizerPage, /End date/)
  assert.match(hostPage, /endDate: null/)
  assert.match(organizerPage, /endDate: null/)
  assert.match(tournamentPortal, /<strong>Date:<\/strong>/)
  assert.match(myTournaments, /<strong>Date:<\/strong>/)
  assert.doesNotMatch(tournamentPortal, /tournament\.endDate/)
  assert.doesNotMatch(myTournaments, /tournament\.endDate/)
  assert.match(server, /endDate: null/)
  assert.match(rbac, /endDate: null/)
})


test('front-end dates use friendly user-local month day year time formatting', () => {
  const timeFormat = fs.readFileSync(new URL('../src/lib/time-format.ts', import.meta.url), 'utf8')
  const tournamentPortal = fs.readFileSync(new URL('../src/pages/TournamentPortal.tsx', import.meta.url), 'utf8')
  const myTournaments = fs.readFileSync(new URL('../src/pages/MyTournaments.tsx', import.meta.url), 'utf8')
  const roundDetail = fs.readFileSync(new URL('../src/components/RoundDetailModal.tsx', import.meta.url), 'utf8')
  const adminPortal = fs.readFileSync(new URL('../src/pages/AdminPortal.tsx', import.meta.url), 'utf8')

  assert.match(timeFormat, /formatFriendlyDateTime/)
  assert.match(timeFormat, /resolvedOptions\(\)\.timeZone/)
  assert.match(timeFormat, /month: 'short'/)
  assert.match(timeFormat, /hour12: true/)
  assert.match(timeFormat, / – /)
  assert.doesNotMatch(timeFormat, /second:/)
  assert.doesNotMatch(timeFormat, /fractionalSecondDigits/)
  assert.match(tournamentPortal, /formatFriendlyDateTime\(tournament\.startDate\)/)
  assert.match(myTournaments, /formatFriendlyDateTime\(value\)/)
  assert.match(roundDetail, /formatFriendlyDateTime\(round\.date\)/)
  assert.match(adminPortal, /formatValue\(row\[column\.key\], column\.key\)/)
})

test('tournament portal includes a close button back to my tournaments', () => {
  const tournamentPortal = fs.readFileSync(new URL('../src/pages/TournamentPortal.tsx', import.meta.url), 'utf8')

  assert.match(tournamentPortal, /to="\/my-tournaments"/)
  assert.match(tournamentPortal, /Close/)
  assert.match(tournamentPortal, /aria-label="Close tournament portal and return to my tournaments"/)
})

test('tournament flyer template is persisted, editable, and supports organizer-provided imagery and fields', () => {
  const templateLib = fs.readFileSync(new URL('../src/lib/tournament-templates.ts', import.meta.url), 'utf8')
  const templateFields = fs.readFileSync(new URL('../src/components/TournamentTemplateFields.tsx', import.meta.url), 'utf8')
  const hostPage = fs.readFileSync(new URL('../src/pages/HostPortal.tsx', import.meta.url), 'utf8')
  const organizerPage = fs.readFileSync(new URL('../src/pages/OrganizerTournaments.tsx', import.meta.url), 'utf8')
  const tournamentPortal = fs.readFileSync(new URL('../src/pages/TournamentPortal.tsx', import.meta.url), 'utf8')
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const rbac = fs.readFileSync(new URL('../server/lib/rbac.js', import.meta.url), 'utf8')
  const migrations = fs.readFileSync(new URL('../server/migrations/index.js', import.meta.url), 'utf8')

  assert.match(templateLib, /classic-flyer/)
  assert.match(templateLib, /TournamentTemplateData/)
  assert.match(templateLib, /logoFiles/)
  assert.match(templateLib, /supportingPhotoUrl/)
  assert.match(templateLib, /attributeIcons/)
  assert.match(templateLib, /date\.jpg/)
  assert.match(templateLib, /tee-time\.jpg/)
  assert.match(templateLib, /golf-course\.jpg/)
  assert.match(templateLib, /location\.png/)
  assert.match(templateLib, /format\.jpg/)
  assert.match(templateLib, /registration-fee\.jpg/)
  assert.doesNotMatch(templateLib, /eventDate|detailLinesImageUrl|tournament-flyer-background\.png|tournament-detail-lines\.png/)
  assert.doesNotMatch(templateLib, /classic-green|bold-contrast|blue-impact|community-care|nature-classic/)
  assert.match(templateFields, /ImageUploadField/)
  assert.match(templateFields, /Flyer background image/)
  assert.match(templateFields, /compressImageFile/)
  assert.match(templateFields, /maxBytes: 420 \* 1024/)
  assert.match(templateFields, /maxBytes: 320 \* 1024/)
  assert.match(templateFields, /type="file" accept="image\/\*"/)
  assert.match(templateFields, /multiple/)
  assert.match(templateFields, /18 - existing\.length/)
  assert.match(templateFields, /Tournament Name/)
  assert.match(templateFields, /Host organization/)
  assert.match(templateFields, /Beneficiary\/charity/)
  assert.match(templateFields, /Shotgun Start or tee times/)
  assert.match(templateFields, /Misc Notes/)
  assert.doesNotMatch(templateFields, /Event date|eventDate|readAsDataURL/)
  assert.match(templateFields, /template\.attributeIcons/)
  assert.doesNotMatch(templateFields, /template\.detailLinesImageUrl|Use template background/)
  assert.match(hostPage, /<TournamentTemplateFields value=\{form\}/)
  assert.match(hostPage, /<TournamentTemplateFields value=\{editForm\}/)
  assert.match(organizerPage, /<TournamentTemplateFields value=\{form\}/)
  assert.match(tournamentPortal, /TournamentFlyer/)
  assert.match(tournamentPortal, /attributeIcons=\{attributeIcons\}/)
  assert.match(tournamentPortal, /Tournament flyer attribute rows/)
  assert.match(tournamentPortal, /ATTRIBUTE_ROWS/)
  assert.match(tournamentPortal, /Course \/ Venue/)
  assert.match(tournamentPortal, /gridTemplateColumns: '96px 28px minmax\(145px, 260px\) 1fr'/)
  assert.match(tournamentPortal, /Sponsors/)
  assert.match(tournamentPortal, /Tournament Information:/)
  assert.match(tournamentPortal, /window\.print\(\)/)
  assert.match(tournamentPortal, /@media print/)
  assert.match(tournamentPortal, /@page \{ size: letter portrait; margin: 0\.15in; \}/)
  assert.match(tournamentPortal, /tournament-flyer-print-content/)
  assert.match(tournamentPortal, /transform: scale\(0\.58\)/)
  assert.match(tournamentPortal, /max-height: 10\.7in/)
  assert.match(tournamentPortal, /<a href=\{flyerPageUrl \|\| undefined\}/)
  assert.doesNotMatch(tournamentPortal, /Sponsor Logos|Misc Notes:/)
  assert.doesNotMatch(tournamentPortal, /Tournament portal|Tournament details and Golf Homiez account registration\.|<PageHero/)
  assert.match(tournamentPortal, /templateBackgroundImageUrl/)
  assert.match(tournamentPortal, /Tournament flyer background banner/)
  assert.match(tournamentPortal, /Tournament flyer banner/)
  assert.match(tournamentPortal, /description = String\(tournament\.description/)
  assert.match(tournamentPortal, /flyerPageUrl/)
  assert.match(organizerPage, /Tournament status counts/)
  assert.match(organizerPage, /statusCounts/)
  assert.doesNotMatch(organizerPage, /Tournament workspace|publishedCount|Organizers can modify tournaments only after a host invitation/)
  assert.match(tournamentPortal, /overflowWrap: 'anywhere'/)
  assert.match(tournamentPortal, /hostGolfCourseAddress/)
  assert.doesNotMatch(tournamentPortal, /detailLinesImageUrl|Tournament flyer detail lines|aspectRatio: '626 \/ 292'|left: '60\.5%'/)
  assert.match(server, /template_data = \?/) 
  assert.match(server, /sanitizeTournamentTemplateData/) 
  assert.doesNotMatch(server, /eventDate: cleanString/)
  assert.match(server, /getGolfCourseByName\(courseName, courseState\)/)
  assert.match(server, /host_golf_course_state/)
  assert.match(rbac, /template_key, template_background_image_url, template_data/) 
  assert.match(migrations, /20260507_026/) 
  assert.match(migrations, /20260507_027/)
  assert.match(migrations, /golf_course_address_fields/)
})

test('reusable image upload support compresses uploads and logs correlated front-end transactions', () => {
  const imageUpload = fs.readFileSync(new URL('../src/lib/image-upload.ts', import.meta.url), 'utf8')
  const imageUploadField = fs.readFileSync(new URL('../src/components/ImageUploadField.tsx', import.meta.url), 'utf8')
  const frontendLogger = fs.readFileSync(new URL('../src/lib/frontend-logger.ts', import.meta.url), 'utf8')
  const request = fs.readFileSync(new URL('../src/lib/request.ts', import.meta.url), 'utf8')
  const serverLogger = fs.readFileSync(new URL('../server/lib/logger.js', import.meta.url), 'utf8')
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')

  assert.match(imageUpload, /canvas\.toDataURL/)
  assert.match(imageUpload, /DEFAULT_QUALITY/)
  assert.match(imageUpload, /DEFAULT_MAX_BYTES/)
  assert.match(imageUpload, /estimateDataUrlBytes/)
  assert.match(imageUpload, /while \(compressedSize > maxBytes/)
  assert.match(imageUpload, /The selected image is still too large after compression/)
  assert.match(imageUpload, /image_compressed/)
  assert.match(imageUploadField, /image_upload_started/)
  assert.match(imageUploadField, /image_upload_completed/)
  assert.match(imageUploadField, /image_upload_failed/)
  assert.match(imageUploadField, /role="alert"/)
  assert.match(frontendLogger, /FRONTEND_LOG_ENDPOINT = '\/api\/client-logs'/)
  assert.match(request, /X-Correlation-Id/)
  assert.match(serverLogger, /ACCESS_LOG_PATH/)
  assert.match(serverLogger, /API_LOG_PATH/)
  assert.match(serverLogger, /FRONTEND_LOG_PATH/)
  assert.match(server, /API_JSON_BODY_LIMIT/)
  assert.match(server, /entity\.too\.large/)
})
