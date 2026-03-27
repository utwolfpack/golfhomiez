import test from 'node:test'
import assert from 'node:assert/strict'
// import fs from 'node:fs'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

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

test('seed script provides rated solo rounds on real courses for handicap displays', async () => {
  const seedScript = await fsp.readFile(
    path.join(process.cwd(), 'server', 'scripts', 'seed-use-info-record.js'),
    'utf8'
  )

  assert.match(seedScript, /const soloCourse(?:Pool|s) = \[/)
  assert.match(seedScript, /Blue Mesa Golf Club/)
  assert.match(seedScript, /Wasatch Greens/)
})

test('auth requests sync the app user record before protected writes', () => {
  const serverIndex = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')

  assert.match(serverIndex, /typeof storage\.ensureUserRecord === 'function'/)
  assert.match(serverIndex, /const appUser = await storage\.ensureUserRecord\(req\.user\)/)
  assert.match(serverIndex, /req\.user\.dbUserId = appUser\.id/)
  assert.match(serverIndex, /createdByUserId: req\.user\.dbUserId/)
})

test('mysql storage resolves an app user record before inserting scores', () => {
  const mysqlStorage = fs.readFileSync(new URL('../server/storage/mysql.js', import.meta.url), 'utf8')

  assert.match(mysqlStorage, /export async function ensureUserRecord\(user\)/)
  assert.match(mysqlStorage, /const appUser = await ensureAppUserRecord\(/)
  assert.match(mysqlStorage, /resolvedUserId = appUser\.id/)
  assert.match(mysqlStorage, /resolvedEmail = appUser\.email/)
})

test('user sync migration assets are present for production backfill', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const helper = fs.readFileSync(new URL('../server/lib/app-user-sync.js', import.meta.url), 'utf8')
  const migration = fs.readFileSync(new URL('../migration_scripts/20260327_001_app_users_auth_sync.sql', import.meta.url), 'utf8')
  const backfill = fs.readFileSync(new URL('../server/scripts/backfill-app-users.js', import.meta.url), 'utf8')

  assert.equal(pkg.scripts['migrate:user-sync'], 'node server/scripts/apply-user-sync-migration.js')
  assert.equal(pkg.scripts['backfill:app-users'], 'node server/scripts/backfill-app-users.js')
  assert.match(helper, /auth_user_id/)
  assert.match(helper, /UPDATE scores/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS users/)
  assert.match(backfill, /backfillAppUsers/)
})


test('client-side diagnostic logging is wired for mobile blank-screen debugging', () => {
  const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
  const clientLogger = fs.readFileSync(new URL('../src/lib/clientLogger.ts', import.meta.url), 'utf8')
  const boundary = fs.readFileSync(new URL('../src/components/AppErrorBoundary.tsx', import.meta.url), 'utf8')
  const apiClient = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8')

  assert.match(indexHtml, /bootstrap_blank_screen_probe/)
  assert.match(indexHtml, /navigator\.sendBeacon/)
  assert.match(main, /initClientLogging\(\)/)
  assert.match(main, /client_bootstrap_start/)
  assert.match(clientLogger, /window\.addEventListener\('error'/)
  assert.match(clientLogger, /blank_screen_probe/)
  assert.match(apiClient, /api_network_error/)
  assert.match(boundary, /react_render_error/)
})

test('server accepts client diagnostic logs and writes to dedicated logging files', () => {
  const serverIndex = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  const logger = fs.readFileSync(new URL('../server/lib/logger.js', import.meta.url), 'utf8')
  const gitignore = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8')

  assert.match(serverIndex, /app\.post\('\/api\/client-log'/)
  assert.match(serverIndex, /logClientDiagnostic\(/)
  assert.match(logger, /ACCESS_LOG_PATH/)
  assert.match(logger, /ERROR_LOG_PATH/)
  assert.match(logger, /accessLogMiddleware/)
  assert.match(gitignore, /logging\/\*\.log/)
})
