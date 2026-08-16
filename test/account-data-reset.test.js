import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { getAccountResetPlan, listAccountResetPlans } from '../server/lib/account-data-reset-plan.js'
import { assertSafeExecutionOptions, parseArgs } from '../server/scripts/reset-account-data.js'

const projectRoot = new URL('../', import.meta.url)

async function read(relativePath) {
  return readFile(new URL(relativePath, projectRoot), 'utf8')
}

test('manual account reset plans exist only for user, host, and organizer accounts', () => {
  const plans = listAccountResetPlans()
  assert.deepEqual(plans.map((plan) => plan.type), ['user', 'host', 'organizer'])

  for (const plan of plans) {
    assert.match(plan.scriptFile, /^migration_scripts\/manual_account_resets\/reset_(user|host|organizer)_accounts\.sql$/)
    assert.match(plan.npmScript, /^data:reset:(user|host|organizer)$/)
    assert.ok(plan.targetDescription.startsWith('all '))
    assert.ok(plan.accountTables.length > 0)
    assert.ok(plan.relatedTables.length > 0)
    assert.ok(plan.deletes.length > 0)
    assert.equal(Object.hasOwn(plan, 'environmentVariable'), false)
  }

  assert.equal(getAccountResetPlan('USER').type, 'user')
  assert.throws(() => getAccountResetPlan('admin'), /Unsupported account reset type/)
  assert.throws(() => getAccountResetPlan('unknown'), /Unsupported account reset type/)
})

test('manual account reset scripts are account-type-wide explicit commands and are not run by postinstall', async () => {
  const packageJson = JSON.parse(await read('package.json'))

  assert.equal(packageJson.scripts['data:reset:user'], 'node server/scripts/reset-account-data.js user --all')
  assert.equal(packageJson.scripts['data:reset:host'], 'node server/scripts/reset-account-data.js host --all')
  assert.equal(packageJson.scripts['data:reset:organizer'], 'node server/scripts/reset-account-data.js organizer --all')
  assert.equal(packageJson.scripts['data:reset:admin'], undefined)

  assert.doesNotMatch(packageJson.scripts.postinstall, /data:reset:/)
  assert.match(packageJson.scripts.postinstall, /db:migrate/)
  assert.match(packageJson.scripts.test, /test\/account-data-reset\.test\.js/)
})

test('manual SQL reset scripts are full-scope, safety-gated, and not registered in the automatic app migration runner', async () => {
  const migrationsIndex = await read('server/migrations/index.js')
  const plans = listAccountResetPlans()

  assert.equal(existsSync(new URL('migration_scripts/manual_account_resets/reset_admin_accounts.sql', projectRoot)), false)

  for (const plan of plans) {
    const sqlPath = new URL(plan.scriptFile, projectRoot)
    assert.equal(existsSync(sqlPath), true, `${plan.scriptFile} must exist`)
    const sql = await read(plan.scriptFile)
    assert.match(sql, /Manual data reset script/i)
    assert.match(sql, /all .*accounts/i)
    assert.match(sql, /NOT run by npm install/i)
    assert.match(sql, /@confirm_manual_account_reset := 'NO'/)
    assert.match(sql, /@confirm_reset_all_accounts := 'NO'/)
    assert.match(sql, /SIGNAL SQLSTATE ''45000''/)
    assert.match(sql, /START TRANSACTION/)
    assert.match(sql, /COMMIT/)
    assert.doesNotMatch(sql, /manual_reset_targets/)
    assert.doesNotMatch(sql, /replace-.*example\.com/)
    assert.match(sql, /DELETE/i)
    assert.doesNotMatch(migrationsIndex, new RegExp(plan.scriptFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('manual reset argument parsing defaults to full account-type scope and preserves confirmation safety', () => {
  const dryRun = parseArgs(['user', '--dry-run'], {})

  assert.equal(dryRun.accountType, 'user')
  assert.equal(dryRun.dryRun, true)
  assert.equal(dryRun.confirm, false)
  assert.equal(dryRun.all, true)
  assert.deepEqual(dryRun.identifiers, [])
  assert.doesNotThrow(() => assertSafeExecutionOptions(dryRun))

  const confirmed = parseArgs(['host', '--confirm', '--confirm-delete-all'], {})
  assert.equal(confirmed.confirm, true)
  assert.equal(confirmed.confirmDeleteAll, true)
  assert.equal(confirmed.all, true)
  assert.doesNotThrow(() => assertSafeExecutionOptions(confirmed))

  const envParsed = parseArgs(['organizer', '--dry-run'], {
    RESET_ORGANIZER_IDENTIFIERS: 'organizer@example.com',
  })
  assert.deepEqual(envParsed.identifiers, [])
  assert.doesNotThrow(() => assertSafeExecutionOptions(envParsed))

  assert.throws(
    () => parseArgs(['user', '--email', 'golfer@example.com'], {}),
    /no longer supported/,
  )
  assert.throws(
    () => parseArgs(['host', '--identifier', 'host-id'], {}),
    /no longer supported/,
  )
  assert.throws(
    () => parseArgs(['organizer', '--file', './targets.txt'], {}),
    /no longer supported/,
  )
  assert.throws(
    () => assertSafeExecutionOptions(parseArgs(['organizer', '--confirm'], {})),
    /confirm-delete-all/,
  )
  assert.throws(
    () => assertSafeExecutionOptions(parseArgs(['admin', '--dry-run'], {})),
    /Unsupported account reset type/,
  )
})

test('manual account reset documentation lives in docs and describes full-scope execution and logging', async () => {
  const docs = await read('docs/MANUAL_ACCOUNT_DATA_RESET_DIRECTIONS.md')

  assert.match(docs, /# Manual Account Data Reset Scripts/)
  assert.match(docs, /all accounts for one selected account type/)
  assert.match(docs, /Admin account reset scripts are intentionally excluded/)
  assert.match(docs, /not executed by `npm install` or `postinstall`/)
  assert.match(docs, /npm run data:reset:user -- --dry-run/)
  assert.match(docs, /npm run data:reset:host -- --confirm --confirm-delete-all/)
  assert.doesNotMatch(docs, /--email golfer@example.com/)
  assert.match(docs, /Targeted flags are intentionally unsupported/)
  assert.match(docs, /logging\/access\.log/)
  assert.match(docs, /logging\/api\.log/)
  assert.match(docs, /logging\/error\.log/)
})


test('manual reset runner avoids MySQL temporary table reopen failures', async () => {
  const runner = await read('server/scripts/reset-account-data.js')

  assert.doesNotMatch(runner, /CREATE\s+TEMPORARY\s+TABLE/i)
  assert.match(runner, /CREATE TABLE \$\{quoteIdentifier\(TEMP_AUTH_USERS\)\}/)
  assert.match(runner, /DROP TABLE IF EXISTS \$\{quoteIdentifier\(tableName\)\}/)
  assert.doesNotMatch(runner, /1 = 1'\s*:\s*'0 = 1'/)
  assert.doesNotMatch(runner, /1 = 1\s+OR\s+ura\.auth_user_id/)
  assert.match(runner, /await buildScope\(db, accountType, options\.all, options\.identifiers\)\s*\n\s*await db\.beginTransaction\(\)/)
})

test('manual SQL reset scripts avoid reopening the same scoped temporary table while finding tournaments', async () => {
  const hostSql = await read('migration_scripts/manual_account_resets/reset_host_accounts.sql')
  const organizerSql = await read('migration_scripts/manual_account_resets/reset_organizer_accounts.sql')

  assert.match(hostSql, /LEFT JOIN manual_reset_host_accounts target_host/)
  assert.match(hostSql, /LEFT JOIN manual_reset_host_role_accounts target_role_host/)
  assert.doesNotMatch(hostSql, /host_account_id IN \(SELECT id FROM manual_reset_host_accounts\)/)
  assert.doesNotMatch(hostSql, /created_by_auth_user_id IN \(SELECT auth_user_id FROM manual_reset_host_accounts/)

  assert.match(organizerSql, /JOIN manual_reset_organizer_accounts target_organizer/)
  assert.doesNotMatch(organizerSql, /organizer_account_id IN \(SELECT id FROM manual_reset_organizer_accounts\)/)
  assert.doesNotMatch(organizerSql, /created_by_auth_user_id IN \(SELECT auth_user_id FROM manual_reset_organizer_accounts/)
})


test('manual reset runner normalizes string comparisons to avoid mixed MySQL collations', async () => {
  const runner = await read('server/scripts/reset-account-data.js')

  assert.match(runner, /const RESET_COLLATION = 'utf8mb4_general_ci'/)
  assert.match(runner, /function stringExpr\(alias, column\)/)
  assert.match(runner, /CONVERT\(\$\{alias\}\.\$\{quoteIdentifier\(column\)\} USING utf8mb4\) COLLATE \$\{RESET_COLLATION\}/)
  assert.match(runner, /function inWorkColumn\(alias, column, tableName/)
  assert.match(runner, /DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci/)
  assert.doesNotMatch(runner, /t\.organizer_account_id IN \(SELECT id FROM \$\{quoteIdentifier\(TEMP_ORGANIZER_ACCOUNTS\)\}\)/)
})

test('manual SQL reset scripts normalize comparisons for mixed MySQL collations', async () => {
  const hostSql = await read('migration_scripts/manual_account_resets/reset_host_accounts.sql')
  const organizerSql = await read('migration_scripts/manual_account_resets/reset_organizer_accounts.sql')

  for (const sql of [hostSql, organizerSql]) {
    assert.match(sql, /DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci/)
    assert.match(sql, /CONVERT\([^)]* USING utf8mb4\) COLLATE utf8mb4_general_ci/)
    assert.match(sql, /Collation note/i)
  }
})
