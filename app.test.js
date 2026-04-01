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



test('registration location input no longer uses browser geolocation', () => {
  const locationInput = fs.readFileSync(new URL('../src/components/LocationInput.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(locationInput, /navigator\.geolocation/)
  assert.doesNotMatch(locationInput, /Use my location/)
  assert.match(locationInput, /Registration no longer detects your current location automatically\./)
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

test('team creation UI keeps the first member read-only and explains why', () => {
  const source = fs.readFileSync(new URL('../src/pages/GolfLogger.tsx', import.meta.url), 'utf8')
  assert.match(source, /readOnly=\{idx === 0\}/)
  assert.match(source, /Member 1 is always the signed-in user and cannot be changed\./)
  assert.match(source, /disabled=\{newMembers.length === 1 \|\| idx === 0\}/)
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


test('use my location emits detailed frontend diagnostics and ships them to the server log endpoint', () => {
  const locationInput = fs.readFileSync(new URL('../src/components/LocationInput.tsx', import.meta.url), 'utf8')
  const frontendLogger = fs.readFileSync(new URL('../src/lib/frontend-logger.ts', import.meta.url), 'utf8')
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const logger = fs.readFileSync(new URL('../server/lib/logger.js', import.meta.url), 'utf8')

  assert.match(locationInput, /use_my_location_clicked/)
  assert.match(locationInput, /use_my_location_geolocation_success/)
  assert.match(locationInput, /use_my_location_geolocation_failed/)
  assert.match(locationInput, /use_my_location_lookup_completed/)
  assert.match(locationInput, /accuracy: position\.coords\.accuracy/)
  assert.match(frontendLogger, /fetch\('\/api\/client-logs'/)
  assert.match(frontendLogger, /'X-Log-Source': 'frontend-logger'/)
  assert.match(server, /app\.post\('\/api\/client-logs'/)
  assert.match(logger, /path\.join\(LOG_DIR, 'api\.log'\)/)
  assert.match(logger, /correlationId: getRequestCorrelationId\(req\)/)
})
