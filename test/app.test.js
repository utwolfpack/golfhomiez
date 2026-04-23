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
  assert.match(hostRegister, /<label className=\"label\">Golf Course<\\/label>/)
  assert.match(hostRegister, /<label className=\"label\">Password<\\/label>/)
  assert.match(hostRegister, /<label className=\"label\">Confirm password<\\/label>/)
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
