import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const projectRoot = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, projectRoot), 'utf8')

test('password reset request hides debug reset URLs and uses enumeration-safe confirmation copy', async () => {
  const page = await read('src/pages/ForgotPassword.tsx')
  const authApi = await read('src/lib/auth-api.ts')

  assert.doesNotMatch(page, /getLatestResetLink|Local reset link|Request a password reset|Send reset link/)
  assert.match(page, /Check your email for the requested reset password email\./)
  assert.match(page, /Request Password Reset/)
  assert.doesNotMatch(authApi, /export async function getLatestResetLink/)
})

test('host portal shows host-admin account management outside the tournament builder and hides it while creating or editing tournaments', async () => {
  const portal = await read('src/pages/HostPortal.tsx')
  const hostApi = await read('src/lib/host-auth.ts')
  const server = await read('server/index.js')
  const hostAuth = await read('server/lib/host-auth.js')

  assert.match(portal, /Golf-course host accounts/)
  assert.match(portal, /Add host account/)
  assert.match(portal, /Transfer course admin/)
  assert.match(portal, /Delete my current admin account after the transfer/)
  assert.match(portal, /!createTournamentOpen && !editingId/)
  assert.match(portal, /data-testid="host-admin-section"/)
  assert.match(portal, /host_tournament_draft_filter_selected/)
  assert.match(portal, />\s*Draft\s*</)

  // Existing account-management APIs back the host-admin section.
  assert.match(hostApi, /createAdditionalHostAccount/)
  assert.match(hostApi, /transferHostAdmin/)
  assert.match(server, /app\.post\('\/api\/host\/accounts'/)
  assert.match(server, /app\.post\('\/api\/host\/accounts\/admin-transfer'/)
  assert.match(server, /app\.delete\('\/api\/host\/accounts\/:id'/)
  assert.match(server, /const tournaments = await listHostPortalTournaments\(db, req\.hostAccount, req\)/)
  assert.match(hostAuth, /is_course_admin/)
  assert.match(hostAuth, /created_by_host_account_id/)
  assert.match(hostAuth, /reassignSharedCoursePage/)
})

test('draft tournaments are excluded from year filters and completed tournaments require a start date', async () => {
  const portal = await read('src/pages/HostPortal.tsx')
  const frontendValidation = await read('src/lib/tournament-errors.ts')
  const rbac = await read('server/lib/rbac.js')
  const server = await read('server/index.js')

  assert.match(portal, /selectedTournamentPool\.filter\(\(tournament\) => String\(tournament\.status \|\| ''\)\.toLowerCase\(\) !== 'draft'\)/)
  assert.match(frontendValidation, /\['published', 'completed'\]\.includes\(status\)/)
  assert.match(rbac, /\['published', 'completed'\]\.includes\(status\)/)
  assert.match(server, /\['published', 'completed'\]\.includes\(status\) && !startDate/)
})

test('new host admin schema migration is production-installable and migrations remain in postinstall', async () => {
  const migration = await read('migration_scripts/20260819_073_host_course_account_admin.sql')
  const migrationIndex = await read('server/migrations/index.js')
  const packageJson = JSON.parse(await read('package.json'))

  assert.match(migration, /is_course_admin TINYINT\(1\)/)
  assert.match(migration, /created_by_host_account_id/)
  assert.match(migration, /idx_host_accounts_course_admin/)
  assert.match(migrationIndex, /version: '20260819_073'/)
  assert.match(packageJson.scripts.postinstall, /db:migrate/)
})

test('user-facing error sanitizer suppresses technical system details while correlation logging remains wired', async () => {
  const sanitizer = await read('src/lib/user-facing-errors.ts')
  const request = await read('src/lib/request.ts')
  const logger = await read('server/lib/logger.js')
  const server = await read('server/index.js')

  assert.match(sanitizer, /SQLSTATE/)
  assert.match(sanitizer, /missing values for required columns/)
  assert.match(sanitizer, /Correlation ID/)
  assert.match(request, /X-Correlation-Id/)
  assert.match(logger, /access\.log/)
  assert.match(logger, /api\.log/)
  assert.match(logger, /frontend\.log/)
  assert.match(server, /host_additional_account_created/)
  assert.match(server, /host_admin_transferred/)
  assert.match(server, /host_account_deleted/)
})
