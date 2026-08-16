/* global process */
import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { getPool, closeDb } from '../db.js'
import { logApi, logError, logInfo, logWarn } from '../lib/logger.js'
import { getAccountResetPlan, listAccountResetPlans, normalizeAccountResetType } from '../lib/account-data-reset-plan.js'

const TEMP_TARGETS = 'manual_reset_target_identifiers'
const TEMP_AUTH_USERS = 'manual_reset_auth_users'
const TEMP_HOST_ACCOUNTS = 'manual_reset_host_accounts'
const TEMP_HOST_ROLE_ACCOUNTS = 'manual_reset_host_role_accounts'
const TEMP_ORGANIZER_ACCOUNTS = 'manual_reset_organizer_accounts'
const TEMP_ROLE_ASSIGNMENTS = 'manual_reset_role_assignments'
const TEMP_TOURNAMENTS = 'manual_reset_tournaments'
const TEMP_TEAMS = 'manual_reset_teams'

const WORK_TABLES = [
  TEMP_TARGETS,
  TEMP_AUTH_USERS,
  TEMP_HOST_ACCOUNTS,
  TEMP_HOST_ROLE_ACCOUNTS,
  TEMP_ORGANIZER_ACCOUNTS,
  TEMP_ROLE_ASSIGNMENTS,
  TEMP_TOURNAMENTS,
  TEMP_TEAMS,
]

function printUsage() {
  const plans = listAccountResetPlans()
  console.log(`Manual GolfHomiez account data reset

Usage:
  npm run data:reset:<type> -- --dry-run
  npm run data:reset:<type> -- --confirm --confirm-delete-all
  node server/scripts/reset-account-data.js <type> --dry-run
  node server/scripts/reset-account-data.js <type> --confirm --confirm-delete-all

Types:
${plans.map((plan) => `  ${plan.type.padEnd(10)} ${plan.targetDescription}`).join(String.fromCharCode(10))}

Options:
  --dry-run             Show matched/deletable row counts and roll back without deleting.
  --confirm             Required before any delete is committed.
  --confirm-delete-all  Second confirmation required because each reset covers every account of the selected type.
  --all                 Optional compatibility flag. All resets are account-type-wide by default.
  --help                Show this help text.

Targeted options such as --email, --identifier, --file, and RESET_*_IDENTIFIERS are intentionally unsupported.
`)
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const args = [...argv]
  const options = {
    accountType: '',
    identifiers: [],
    dryRun: false,
    confirm: false,
    all: true,
    confirmDeleteAll: false,
    help: false,
  }

  if (args[0] && !args[0].startsWith('--')) options.accountType = args.shift()

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--confirm') options.confirm = true
    else if (arg === '--confirm-delete-all') options.confirmDeleteAll = true
    else if (arg === '--all') options.all = true
    else if (arg === '--email' || arg === '--identifier' || arg === '--file') {
      throw new Error(`${arg} is no longer supported. Manual resets now run for all accounts of the selected account type.`)
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }

  if (!options.accountType) {
    options.accountType = env.RESET_ACCOUNT_TYPE || ''
  }

  return options
}

function assertSafeExecutionOptions(options) {
  if (options.help) return
  normalizeAccountResetType(options.accountType)

  if (options.identifiers.length > 0) {
    throw new Error('Targeted identifiers are not supported. This manual reset always runs against all accounts of the selected account type.')
  }

  if (!options.dryRun && (!options.confirm || !options.confirmDeleteAll)) {
    throw new Error('Refusing to delete account-type-wide data without both --confirm and --confirm-delete-all. Run with --dry-run first to review matched rows.')
  }
}

function quoteIdentifier(name) {
  const value = String(name || '')
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`Unsafe SQL identifier: ${name}`)
  return `\`${value}\``
}

const RESET_COLLATION = 'utf8mb4_general_ci'

function stringExpr(alias, column) {
  return `CONVERT(${alias}.${quoteIdentifier(column)} USING utf8mb4) COLLATE ${RESET_COLLATION}`
}

function lowerExpr(alias, column) {
  return `LOWER(${stringExpr(alias, column)})`
}

function workColumnExpr(column) {
  return `CONVERT(${quoteIdentifier(column)} USING utf8mb4) COLLATE ${RESET_COLLATION}`
}

function workSelect(tableName, column, where = '') {
  return `SELECT ${workColumnExpr(column)} FROM ${quoteIdentifier(tableName)}${where ? ` ${where}` : ''}`
}

function workLowerSelect(tableName, column, where = '') {
  return `SELECT LOWER(${workColumnExpr(column)}) FROM ${quoteIdentifier(tableName)}${where ? ` ${where}` : ''}`
}

function inWorkColumn(alias, column, tableName, workColumn = column, where = '') {
  return `${stringExpr(alias, column)} IN (${workSelect(tableName, workColumn, where)})`
}

function lowerInWorkColumn(alias, column, tableName, workColumn = column, where = '') {
  return `${lowerExpr(alias, column)} IN (${workLowerSelect(tableName, workColumn, where)})`
}

async function tableExists(db, tableName) {
  const [rows] = await db.execute(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
    [tableName],
  )
  return rows.length > 0
}

async function columnsFor(db, tableName) {
  const [rows] = await db.execute(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [tableName],
  )
  return new Set(rows.map((row) => row.COLUMN_NAME))
}

function hasColumn(columns, column) {
  return columns.has(column)
}

function anyPresent(columns, names) {
  return names.filter((name) => hasColumn(columns, name))
}

async function dropWorkTables(db) {
  for (const tableName of [...WORK_TABLES].reverse()) {
    await db.query(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`)
  }
}

async function createWorkTables(db) {
  await dropWorkTables(db)
  await db.query(`CREATE TABLE ${quoteIdentifier(TEMP_TARGETS)} (identifier VARCHAR(512) NOT NULL PRIMARY KEY) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
  await db.query(`CREATE TABLE ${quoteIdentifier(TEMP_AUTH_USERS)} (id VARCHAR(191) NOT NULL PRIMARY KEY, email VARCHAR(191) NULL, KEY idx_email (email)) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
  await db.query(`CREATE TABLE ${quoteIdentifier(TEMP_HOST_ACCOUNTS)} (id VARCHAR(191) NOT NULL PRIMARY KEY, email VARCHAR(191) NULL, auth_user_id VARCHAR(191) NULL, invite_id VARCHAR(191) NULL, KEY idx_email (email), KEY idx_auth_user (auth_user_id), KEY idx_invite (invite_id)) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
  await db.query(`CREATE TABLE ${quoteIdentifier(TEMP_HOST_ROLE_ACCOUNTS)} (id VARCHAR(191) NOT NULL PRIMARY KEY, email VARCHAR(191) NULL, auth_user_id VARCHAR(191) NULL, role_assignment_id VARCHAR(191) NULL, KEY idx_email (email), KEY idx_auth_user (auth_user_id), KEY idx_assignment (role_assignment_id)) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
  await db.query(`CREATE TABLE ${quoteIdentifier(TEMP_ORGANIZER_ACCOUNTS)} (id VARCHAR(191) NOT NULL PRIMARY KEY, email VARCHAR(191) NULL, auth_user_id VARCHAR(191) NULL, role_assignment_id VARCHAR(191) NULL, KEY idx_email (email), KEY idx_auth_user (auth_user_id), KEY idx_assignment (role_assignment_id)) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
  await db.query(`CREATE TABLE ${quoteIdentifier(TEMP_ROLE_ASSIGNMENTS)} (id VARCHAR(191) NOT NULL PRIMARY KEY, auth_user_id VARCHAR(191) NULL, email VARCHAR(191) NULL, role_key VARCHAR(64) NULL, KEY idx_email (email), KEY idx_auth_user (auth_user_id), KEY idx_role (role_key)) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
  await db.query(`CREATE TABLE ${quoteIdentifier(TEMP_TOURNAMENTS)} (id VARCHAR(191) NOT NULL PRIMARY KEY) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
  await db.query(`CREATE TABLE ${quoteIdentifier(TEMP_TEAMS)} (id VARCHAR(191) NOT NULL PRIMARY KEY) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
}

async function insertTargetIdentifiers(db, identifiers) {
  if (!identifiers.length) return 0
  const values = identifiers.map(() => '(?)').join(', ')
  const [result] = await db.execute(
    `INSERT IGNORE INTO ${quoteIdentifier(TEMP_TARGETS)} (identifier) VALUES ${values}`,
    identifiers,
  )
  return result.affectedRows || 0
}

async function insertAuthUserScope(db, all) {
  const userTable = 'user'
  if (!(await tableExists(db, userTable))) return
  const columns = await columnsFor(db, userTable)
  if (!hasColumn(columns, 'id')) return
  const emailExpression = hasColumn(columns, 'email') ? 'u.email' : 'NULL'
  const matches = anyPresent(columns, ['id', 'email'])
    .map((column) => lowerInWorkColumn('u', column, TEMP_TARGETS, 'identifier'))
  if (!all && !matches.length) return
  await db.query(
    `INSERT IGNORE INTO ${quoteIdentifier(TEMP_AUTH_USERS)} (id, email)
     SELECT u.id, ${emailExpression}
       FROM ${quoteIdentifier(userTable)} u
      ${all ? '' : `WHERE ${matches.join(' OR ')}`}`,
  )
}

async function insertAppUserScope(db, all) {
  if (!(await tableExists(db, 'app_users'))) return
  const columns = await columnsFor(db, 'app_users')
  if (!hasColumn(columns, 'auth_user_id')) return
  const emailExpression = hasColumn(columns, 'email') ? 'au.email' : 'NULL'
  const matches = anyPresent(columns, ['auth_user_id', 'email'])
    .map((column) => lowerInWorkColumn('au', column, TEMP_TARGETS, 'identifier'))
  if (!all && !matches.length) return
  await db.query(
    `INSERT IGNORE INTO ${quoteIdentifier(TEMP_AUTH_USERS)} (id, email)
     SELECT au.auth_user_id, ${emailExpression}
       FROM app_users au
      ${all ? '' : `WHERE ${matches.join(' OR ')}`}`,
  )
}

async function insertRoleAssignments(db, roleKey, all) {
  if (!(await tableExists(db, 'user_role_assignments'))) return
  const columns = await columnsFor(db, 'user_role_assignments')
  if (!hasColumn(columns, 'id')) return
  const roleClause = hasColumn(columns, 'role_key') ? `${lowerExpr('ura', 'role_key')} = ?` : '1 = 1'
  const params = hasColumn(columns, 'role_key') ? [String(roleKey || '').toLowerCase()] : []
  const matchParts = all
    ? ['1 = 1']
    : [
        hasColumn(columns, 'auth_user_id') ? inWorkColumn('ura', 'auth_user_id', TEMP_AUTH_USERS, 'id') : null,
        hasColumn(columns, 'email') ? lowerInWorkColumn('ura', 'email', TEMP_AUTH_USERS, 'email', 'WHERE email IS NOT NULL') : null,
        hasColumn(columns, 'email') ? lowerInWorkColumn('ura', 'email', TEMP_TARGETS, 'identifier') : null,
        hasColumn(columns, 'auth_user_id') ? lowerInWorkColumn('ura', 'auth_user_id', TEMP_TARGETS, 'identifier') : null,
      ].filter(Boolean)

  await db.execute(
    `INSERT IGNORE INTO ${quoteIdentifier(TEMP_ROLE_ASSIGNMENTS)} (id, auth_user_id, email, role_key)
     SELECT ura.id,
            ${hasColumn(columns, 'auth_user_id') ? 'ura.auth_user_id' : 'NULL'},
            ${hasColumn(columns, 'email') ? 'ura.email' : 'NULL'},
            ${hasColumn(columns, 'role_key') ? 'ura.role_key' : 'NULL'}
       FROM user_role_assignments ura
      WHERE ${roleClause}
        AND (${matchParts.join(' OR ')})`,
    params,
  )

  if (roleKey === 'user') {
    await db.query(
      `INSERT IGNORE INTO ${quoteIdentifier(TEMP_AUTH_USERS)} (id, email)
       SELECT auth_user_id, email
         FROM ${quoteIdentifier(TEMP_ROLE_ASSIGNMENTS)}
        WHERE auth_user_id IS NOT NULL`,
    )
  }
}

async function insertHostScope(db, all) {
  if (await tableExists(db, 'host_accounts')) {
    const columns = await columnsFor(db, 'host_accounts')
    if (hasColumn(columns, 'id')) {
      const matches = all
        ? ['1 = 1']
        : anyPresent(columns, ['id', 'email', 'auth_user_id']).map((column) => lowerInWorkColumn('ha', column, TEMP_TARGETS, 'identifier'))
      if (matches.length) {
        await db.query(
          `INSERT IGNORE INTO ${quoteIdentifier(TEMP_HOST_ACCOUNTS)} (id, email, auth_user_id, invite_id)
           SELECT ha.id,
                  ${hasColumn(columns, 'email') ? 'ha.email' : 'NULL'},
                  ${hasColumn(columns, 'auth_user_id') ? 'ha.auth_user_id' : 'NULL'},
                  ${hasColumn(columns, 'invite_id') ? 'ha.invite_id' : 'NULL'}
             FROM host_accounts ha
            WHERE ${matches.join(' OR ')}`,
        )
      }
    }
  }

  if (await tableExists(db, 'host_role_accounts')) {
    const columns = await columnsFor(db, 'host_role_accounts')
    if (hasColumn(columns, 'id')) {
      const matches = all
        ? ['1 = 1']
        : [
            hasColumn(columns, 'role_assignment_id') ? inWorkColumn('hra', 'role_assignment_id', TEMP_ROLE_ASSIGNMENTS, 'id') : null,
            ...anyPresent(columns, ['id', 'email', 'auth_user_id']).map((column) => lowerInWorkColumn('hra', column, TEMP_TARGETS, 'identifier')),
          ].filter(Boolean)
      if (matches.length) {
        await db.query(
          `INSERT IGNORE INTO ${quoteIdentifier(TEMP_HOST_ROLE_ACCOUNTS)} (id, email, auth_user_id, role_assignment_id)
           SELECT hra.id,
                  ${hasColumn(columns, 'email') ? 'hra.email' : 'NULL'},
                  ${hasColumn(columns, 'auth_user_id') ? 'hra.auth_user_id' : 'NULL'},
                  ${hasColumn(columns, 'role_assignment_id') ? 'hra.role_assignment_id' : 'NULL'}
             FROM host_role_accounts hra
            WHERE ${matches.join(' OR ')}`,
        )
      }
    }
  }
}

async function insertOrganizerScope(db, all) {
  if (!(await tableExists(db, 'organizer_role_accounts'))) return
  const columns = await columnsFor(db, 'organizer_role_accounts')
  if (!hasColumn(columns, 'id')) return
  const matches = all
    ? ['1 = 1']
    : [
        hasColumn(columns, 'role_assignment_id') ? inWorkColumn('ora', 'role_assignment_id', TEMP_ROLE_ASSIGNMENTS, 'id') : null,
        ...anyPresent(columns, ['id', 'email', 'reset_email', 'auth_user_id']).map((column) => lowerInWorkColumn('ora', column, TEMP_TARGETS, 'identifier')),
      ].filter(Boolean)
  if (!matches.length) return
  await db.query(
    `INSERT IGNORE INTO ${quoteIdentifier(TEMP_ORGANIZER_ACCOUNTS)} (id, email, auth_user_id, role_assignment_id)
     SELECT ora.id,
            ${hasColumn(columns, 'email') ? 'ora.email' : hasColumn(columns, 'reset_email') ? 'ora.reset_email' : 'NULL'},
            ${hasColumn(columns, 'auth_user_id') ? 'ora.auth_user_id' : 'NULL'},
            ${hasColumn(columns, 'role_assignment_id') ? 'ora.role_assignment_id' : 'NULL'}
       FROM organizer_role_accounts ora
      WHERE ${matches.join(' OR ')}`,
  )
}

async function insertTournamentScope(db, accountType) {
  if (!(await tableExists(db, 'tournaments'))) return
  const columns = await columnsFor(db, 'tournaments')
  if (!hasColumn(columns, 'id')) return
  const predicates = []

  if (accountType === 'host') {
    if (hasColumn(columns, 'host_account_id')) {
      predicates.push(inWorkColumn('t', 'host_account_id', TEMP_HOST_ACCOUNTS, 'id'))
      predicates.push(inWorkColumn('t', 'host_account_id', TEMP_HOST_ROLE_ACCOUNTS, 'id'))
    }
    if (hasColumn(columns, 'created_by_auth_user_id')) {
      predicates.push(inWorkColumn('t', 'created_by_auth_user_id', TEMP_HOST_ACCOUNTS, 'auth_user_id', 'WHERE auth_user_id IS NOT NULL'))
      predicates.push(inWorkColumn('t', 'created_by_auth_user_id', TEMP_HOST_ROLE_ACCOUNTS, 'auth_user_id', 'WHERE auth_user_id IS NOT NULL'))
    }
  }

  if (accountType === 'organizer') {
    if (hasColumn(columns, 'organizer_account_id')) predicates.push(inWorkColumn('t', 'organizer_account_id', TEMP_ORGANIZER_ACCOUNTS, 'id'))
    if (hasColumn(columns, 'organizer_email')) predicates.push(lowerInWorkColumn('t', 'organizer_email', TEMP_ORGANIZER_ACCOUNTS, 'email', 'WHERE email IS NOT NULL'))
    if (hasColumn(columns, 'created_by_auth_user_id')) predicates.push(inWorkColumn('t', 'created_by_auth_user_id', TEMP_ORGANIZER_ACCOUNTS, 'auth_user_id', 'WHERE auth_user_id IS NOT NULL'))
  }

  if (!predicates.length) return
  await db.query(
    `INSERT IGNORE INTO ${quoteIdentifier(TEMP_TOURNAMENTS)} (id)
     SELECT t.id FROM tournaments t WHERE ${predicates.join(' OR ')}`,
  )
}

async function insertTeamsScope(db) {
  if (!(await tableExists(db, 'team_members'))) return
  const columns = await columnsFor(db, 'team_members')
  if (!hasColumn(columns, 'team_id')) return
  const predicates = []
  if (hasColumn(columns, 'id')) predicates.push(inWorkColumn('tm', 'id', TEMP_AUTH_USERS, 'id'))
  if (hasColumn(columns, 'email')) predicates.push(lowerInWorkColumn('tm', 'email', TEMP_AUTH_USERS, 'email', 'WHERE email IS NOT NULL'))
  if (!predicates.length) return
  await db.query(
    `INSERT IGNORE INTO ${quoteIdentifier(TEMP_TEAMS)} (id)
     SELECT DISTINCT tm.team_id FROM team_members tm WHERE ${predicates.join(' OR ')}`,
  )
}

async function buildScope(db, accountType, all, identifiers) {
  await createWorkTables(db)
  await insertTargetIdentifiers(db, identifiers)

  if (accountType === 'user') {
    await insertAuthUserScope(db, all)
    await insertAppUserScope(db, all)
    await insertRoleAssignments(db, 'user', all)
    await insertTeamsScope(db)
    return
  }

  if (accountType === 'host') {
    await insertRoleAssignments(db, 'host', all)
    await insertHostScope(db, all)
    await insertTournamentScope(db, 'host')
    return
  }

  if (accountType === 'organizer') {
    await insertRoleAssignments(db, 'organizer', all)
    await insertOrganizerScope(db, all)
    await insertTournamentScope(db, 'organizer')
  }
}

async function tempCount(db, table) {
  const [rows] = await db.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`)
  return Number(rows[0]?.count || 0)
}

async function countTableRows(db, tableName, predicate) {
  if (!(await tableExists(db, tableName))) return { table: tableName, count: 0, skipped: true }
  const [rows] = await db.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)} t WHERE ${predicate}`)
  return { table: tableName, count: Number(rows[0]?.count || 0), skipped: false }
}

async function deleteTableRows(db, tableName, predicate) {
  if (!(await tableExists(db, tableName))) return { table: tableName, deleted: 0, skipped: true }
  const [result] = await db.query(`DELETE t FROM ${quoteIdentifier(tableName)} t WHERE ${predicate}`)
  return { table: tableName, deleted: result.affectedRows || 0, skipped: false }
}

async function deleteEmptyScopedTeams(db) {
  if (!(await tableExists(db, 'teams')) || !(await tableExists(db, 'team_members'))) {
    return { table: 'teams', deleted: 0, skipped: true }
  }
  const [result] = await db.query(
    `DELETE t FROM teams t
      JOIN ${quoteIdentifier(TEMP_TEAMS)} target_teams ON ${stringExpr('target_teams', 'id')} = ${stringExpr('t', 'id')}
      LEFT JOIN team_members tm ON ${stringExpr('tm', 'team_id')} = ${stringExpr('t', 'id')}
     WHERE tm.team_id IS NULL`,
  )
  return { table: 'teams', deleted: result.affectedRows || 0, skipped: false }
}

function userPredicatesFor(tableColumns) {
  const predicates = []
  if (hasColumn(tableColumns, 'userId')) predicates.push(inWorkColumn('t', 'userId', TEMP_AUTH_USERS, 'id'))
  if (hasColumn(tableColumns, 'user_id')) predicates.push(inWorkColumn('t', 'user_id', TEMP_AUTH_USERS, 'id'))
  if (hasColumn(tableColumns, 'user_id')) predicates.push(lowerInWorkColumn('t', 'user_id', TEMP_TARGETS, 'identifier'))
  if (hasColumn(tableColumns, 'email')) predicates.push(lowerInWorkColumn('t', 'email', TEMP_AUTH_USERS, 'email', 'WHERE email IS NOT NULL'))
  if (hasColumn(tableColumns, 'email')) predicates.push(lowerInWorkColumn('t', 'email', TEMP_TARGETS, 'identifier'))
  if (hasColumn(tableColumns, 'identifier')) predicates.push(lowerInWorkColumn('t', 'identifier', TEMP_AUTH_USERS, 'email', 'WHERE email IS NOT NULL'))
  if (hasColumn(tableColumns, 'created_by_user_id')) predicates.push(inWorkColumn('t', 'created_by_user_id', TEMP_AUTH_USERS, 'id'))
  if (hasColumn(tableColumns, 'created_by_email')) predicates.push(lowerInWorkColumn('t', 'created_by_email', TEMP_AUTH_USERS, 'email', 'WHERE email IS NOT NULL'))
  if (hasColumn(tableColumns, 'auth_user_id')) predicates.push(inWorkColumn('t', 'auth_user_id', TEMP_AUTH_USERS, 'id'))
  if (hasColumn(tableColumns, 'sender_user_id')) predicates.push(inWorkColumn('t', 'sender_user_id', TEMP_AUTH_USERS, 'id'))
  if (hasColumn(tableColumns, 'recipient_user_id')) predicates.push(inWorkColumn('t', 'recipient_user_id', TEMP_AUTH_USERS, 'id'))
  if (hasColumn(tableColumns, 'sender_email')) predicates.push(lowerInWorkColumn('t', 'sender_email', TEMP_AUTH_USERS, 'email', 'WHERE email IS NOT NULL'))
  if (hasColumn(tableColumns, 'recipient_email')) predicates.push(lowerInWorkColumn('t', 'recipient_email', TEMP_AUTH_USERS, 'email', 'WHERE email IS NOT NULL'))
  if (hasColumn(tableColumns, 'updated_by_auth_user_id')) predicates.push(inWorkColumn('t', 'updated_by_auth_user_id', TEMP_AUTH_USERS, 'id'))
  if (hasColumn(tableColumns, 'user_key')) {
    predicates.push(inWorkColumn('t', 'user_key', TEMP_AUTH_USERS, 'id'))
    predicates.push(lowerInWorkColumn('t', 'user_key', TEMP_AUTH_USERS, 'email', 'WHERE email IS NOT NULL'))
    predicates.push(`${lowerExpr('t', 'user_key')} IN (SELECT LOWER(CONCAT(${workColumnExpr('id')}, '|', ${workColumnExpr('email')})) FROM ${quoteIdentifier(TEMP_AUTH_USERS)} WHERE email IS NOT NULL)`)
  }
  return predicates
}

async function buildUserDeletes(db) {
  const operations = []
  for (const tableName of ['session', 'account', 'verification', 'email_verification_tokens', 'scorecard_hole_drafts', 'scores', 'tournament_registrations', 'inbox_challenge_user_state', 'inbox_messages']) {
    if (!(await tableExists(db, tableName))) continue
    const columns = await columnsFor(db, tableName)
    const predicates = userPredicatesFor(columns)
    if (predicates.length) operations.push({ tableName, predicate: predicates.join(' OR ') })
  }

  if (await tableExists(db, 'team_members')) {
    const columns = await columnsFor(db, 'team_members')
    const predicates = []
    if (hasColumn(columns, 'id')) predicates.push(inWorkColumn('t', 'id', TEMP_AUTH_USERS, 'id'))
    if (hasColumn(columns, 'email')) predicates.push(lowerInWorkColumn('t', 'email', TEMP_AUTH_USERS, 'email', 'WHERE email IS NOT NULL'))
    if (predicates.length) operations.push({ tableName: 'team_members', predicate: predicates.join(' OR ') })
  }

  if (await tableExists(db, 'app_users')) {
    const columns = await columnsFor(db, 'app_users')
    const predicates = []
    if (hasColumn(columns, 'auth_user_id')) predicates.push(inWorkColumn('t', 'auth_user_id', TEMP_AUTH_USERS, 'id'))
    if (hasColumn(columns, 'email')) predicates.push(lowerInWorkColumn('t', 'email', TEMP_AUTH_USERS, 'email', 'WHERE email IS NOT NULL'))
    if (predicates.length) operations.push({ tableName: 'app_users', predicate: predicates.join(' OR ') })
  }

  if (await tableExists(db, 'user_role_assignments')) {
    operations.push({ tableName: 'user_role_assignments', predicate: `${inWorkColumn('t', 'id', TEMP_ROLE_ASSIGNMENTS, 'id')} OR ${inWorkColumn('t', 'auth_user_id', TEMP_AUTH_USERS, 'id')}` })
  }

  if (await tableExists(db, 'user')) {
    operations.push({ tableName: 'user', predicate: inWorkColumn('t', 'id', TEMP_AUTH_USERS, 'id') })
  }

  return operations
}

async function buildHostDeletes(db) {
  const operations = []
  const hostIdSubqueries = [
    workSelect(TEMP_HOST_ACCOUNTS, 'id'),
    workSelect(TEMP_HOST_ROLE_ACCOUNTS, 'id'),
  ]
  const hostEmailSubqueries = [
    workLowerSelect(TEMP_HOST_ACCOUNTS, 'email', 'WHERE email IS NOT NULL'),
    workLowerSelect(TEMP_HOST_ROLE_ACCOUNTS, 'email', 'WHERE email IS NOT NULL'),
  ]
  const hostAuthSubqueries = [
    workSelect(TEMP_HOST_ACCOUNTS, 'auth_user_id', 'WHERE auth_user_id IS NOT NULL'),
    workSelect(TEMP_HOST_ROLE_ACCOUNTS, 'auth_user_id', 'WHERE auth_user_id IS NOT NULL'),
  ]

  const byHostId = (column) => hostIdSubqueries.map((subquery) => `${stringExpr('t', column)} IN (${subquery})`)
  const byHostEmail = (column) => hostEmailSubqueries.map((subquery) => `${lowerExpr('t', column)} IN (${subquery})`)
  const byHostAuth = (column) => hostAuthSubqueries.map((subquery) => `${stringExpr('t', column)} IN (${subquery})`)
  const byTournament = (column = 'tournament_id') => inWorkColumn('t', column, TEMP_TOURNAMENTS, 'id')

  for (const tableName of ['tournament_team_start_assignments', 'tournament_team_scores', 'tournament_registrations', 'golf_course_tournaments', 'organizer_tournament_invites']) {
    if (!(await tableExists(db, tableName))) continue
    const columns = await columnsFor(db, tableName)
    const predicates = []
    if (hasColumn(columns, 'tournament_id')) predicates.push(byTournament('tournament_id'))
    if (hasColumn(columns, 'golfhomiez_tournament_id')) predicates.push(byTournament('golfhomiez_tournament_id'))
    if (hasColumn(columns, 'host_account_id')) predicates.push(...byHostId('host_account_id'))
    if (predicates.length) operations.push({ tableName, predicate: predicates.join(' OR ') })
  }

  for (const tableName of ['host_sessions', 'host_password_reset_tokens', 'golf_course_public_pages']) {
    if (!(await tableExists(db, tableName))) continue
    const columns = await columnsFor(db, tableName)
    const predicates = []
    for (const column of ['host_account_id', 'host_id', 'account_id']) if (hasColumn(columns, column)) predicates.push(...byHostId(column))
    if (hasColumn(columns, 'email')) predicates.push(...byHostEmail('email'))
    if (predicates.length) operations.push({ tableName, predicate: predicates.join(' OR ') })
  }

  if (await tableExists(db, 'host_account_requests')) {
    const columns = await columnsFor(db, 'host_account_requests')
    const predicates = []
    if (hasColumn(columns, 'approved_host_account_id')) predicates.push(...byHostId('approved_host_account_id'))
    if (hasColumn(columns, 'email')) predicates.push(...byHostEmail('email'))
    if (predicates.length) operations.push({ tableName: 'host_account_requests', predicate: predicates.join(' OR ') })
  }

  if (await tableExists(db, 'host_account_invites')) {
    const columns = await columnsFor(db, 'host_account_invites')
    const predicates = []
    if (hasColumn(columns, 'id')) predicates.push(inWorkColumn('t', 'id', TEMP_HOST_ACCOUNTS, 'invite_id', 'WHERE invite_id IS NOT NULL'))
    for (const column of ['email', 'invitee_email']) if (hasColumn(columns, column)) predicates.push(...byHostEmail(column))
    if (predicates.length) operations.push({ tableName: 'host_account_invites', predicate: predicates.join(' OR ') })
  }

  if (await tableExists(db, 'tournaments')) operations.push({ tableName: 'tournaments', predicate: inWorkColumn('t', 'id', TEMP_TOURNAMENTS, 'id') })
  if (await tableExists(db, 'host_accounts')) operations.push({ tableName: 'host_accounts', predicate: inWorkColumn('t', 'id', TEMP_HOST_ACCOUNTS, 'id') })
  if (await tableExists(db, 'host_role_accounts')) operations.push({ tableName: 'host_role_accounts', predicate: inWorkColumn('t', 'id', TEMP_HOST_ROLE_ACCOUNTS, 'id') })
  if (await tableExists(db, 'user_role_assignments')) operations.push({ tableName: 'user_role_assignments', predicate: `${inWorkColumn('t', 'id', TEMP_ROLE_ASSIGNMENTS, 'id')} OR ${byHostAuth('auth_user_id').join(' OR ')} OR ${byHostEmail('email').join(' OR ')}` })
  return operations
}

async function buildOrganizerDeletes(db) {
  const operations = []
  const byOrganizerId = (column) => inWorkColumn('t', column, TEMP_ORGANIZER_ACCOUNTS, 'id')
  const byOrganizerEmail = (column) => lowerInWorkColumn('t', column, TEMP_ORGANIZER_ACCOUNTS, 'email', 'WHERE email IS NOT NULL')
  const byOrganizerAuth = (column) => inWorkColumn('t', column, TEMP_ORGANIZER_ACCOUNTS, 'auth_user_id', 'WHERE auth_user_id IS NOT NULL')
  const byTournament = (column = 'tournament_id') => inWorkColumn('t', column, TEMP_TOURNAMENTS, 'id')

  for (const tableName of ['tournament_team_start_assignments', 'tournament_team_scores', 'tournament_registrations', 'golf_course_tournaments', 'organizer_tournament_invites']) {
    if (!(await tableExists(db, tableName))) continue
    const columns = await columnsFor(db, tableName)
    const predicates = []
    if (hasColumn(columns, 'tournament_id')) predicates.push(byTournament('tournament_id'))
    if (hasColumn(columns, 'golfhomiez_tournament_id')) predicates.push(byTournament('golfhomiez_tournament_id'))
    if (hasColumn(columns, 'organizer_account_id')) predicates.push(byOrganizerId('organizer_account_id'))
    if (hasColumn(columns, 'organizer_email')) predicates.push(byOrganizerEmail('organizer_email'))
    if (predicates.length) operations.push({ tableName, predicate: predicates.join(' OR ') })
  }

  for (const tableName of ['organizer_sessions', 'organizer_password_reset_tokens']) {
    if (!(await tableExists(db, tableName))) continue
    const columns = await columnsFor(db, tableName)
    const predicates = []
    if (hasColumn(columns, 'organizer_account_id')) predicates.push(byOrganizerId('organizer_account_id'))
    if (hasColumn(columns, 'email')) predicates.push(byOrganizerEmail('email'))
    if (predicates.length) operations.push({ tableName, predicate: predicates.join(' OR ') })
  }

  if (await tableExists(db, 'tournaments')) operations.push({ tableName: 'tournaments', predicate: inWorkColumn('t', 'id', TEMP_TOURNAMENTS, 'id') })
  if (await tableExists(db, 'organizer_role_accounts')) operations.push({ tableName: 'organizer_role_accounts', predicate: inWorkColumn('t', 'id', TEMP_ORGANIZER_ACCOUNTS, 'id') })
  if (await tableExists(db, 'user_role_assignments')) operations.push({ tableName: 'user_role_assignments', predicate: `${inWorkColumn('t', 'id', TEMP_ROLE_ASSIGNMENTS, 'id')} OR ${byOrganizerAuth('auth_user_id')} OR ${byOrganizerEmail('email')}` })
  return operations
}

async function getDeleteOperations(db, accountType) {
  if (accountType === 'user') return buildUserDeletes(db)
  if (accountType === 'host') return buildHostDeletes(db)
  if (accountType === 'organizer') return buildOrganizerDeletes(db)
  throw new Error(`Unsupported account reset type: ${accountType}`)
}

async function countOperations(db, operations) {
  const counts = []
  for (const op of operations) counts.push(await countTableRows(db, op.tableName, op.predicate))
  return counts
}

async function deleteOperations(db, operations) {
  const deletes = []
  for (const op of operations) deletes.push(await deleteTableRows(db, op.tableName, op.predicate))
  return deletes
}

async function buildMatchedSummary(db) {
  return {
    authUsers: await tempCount(db, TEMP_AUTH_USERS),
    hostAccounts: await tempCount(db, TEMP_HOST_ACCOUNTS),
    hostRoleAccounts: await tempCount(db, TEMP_HOST_ROLE_ACCOUNTS),
    organizerAccounts: await tempCount(db, TEMP_ORGANIZER_ACCOUNTS),
    roleAssignments: await tempCount(db, TEMP_ROLE_ASSIGNMENTS),
    tournaments: await tempCount(db, TEMP_TOURNAMENTS),
    teams: await tempCount(db, TEMP_TEAMS),
  }
}

async function executeAccountDataReset(options) {
  const accountType = normalizeAccountResetType(options.accountType)
  const plan = getAccountResetPlan(accountType)
  const correlationId = randomUUID()
  const pool = getPool()
  const db = await pool.getConnection()

  logApi('manual_account_data_reset_started', {
    correlationId,
    accountType,
    dryRun: options.dryRun,
    all: true,
    targetCount: 'all',
  })

  try {
    await buildScope(db, accountType, options.all, options.identifiers)
    await db.beginTransaction()
    const matched = await buildMatchedSummary(db)
    const operations = await getDeleteOperations(db, accountType)
    const rowCounts = await countOperations(db, operations)
    let deletes = []

    if (accountType === 'user') {
      const emptyTeamCount = await countTableRows(
        db,
        'teams',
        `${inWorkColumn('t', 'id', TEMP_TEAMS, 'id')} AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE ${stringExpr('tm', 'team_id')} = ${stringExpr('t', 'id')})`,
      )
      rowCounts.push(emptyTeamCount)
    }

    if (options.dryRun) {
      await db.rollback()
      logInfo('Manual account data reset dry run completed', { correlationId, accountType, matched, rowCounts })
      return { correlationId, plan, dryRun: true, matched, rowCounts, deletes }
    }

    deletes = await deleteOperations(db, operations)
    if (accountType === 'user') deletes.push(await deleteEmptyScopedTeams(db))

    await db.commit()
    logInfo('Manual account data reset committed', { correlationId, accountType, matched, deletes })
    return { correlationId, plan, dryRun: false, matched, rowCounts, deletes }
  } catch (error) {
    await db.rollback()
    logError('Manual account data reset failed', { correlationId, accountType, error })
    throw error
  } finally {
    try {
      await dropWorkTables(db)
    } catch (error) {
      logWarn('Failed dropping manual account reset work tables', { correlationId, accountType, error })
    }
    db.release()
  }
}

function printResult(result) {
  console.log(`\n${result.plan.label}`)
  console.log(`Correlation id: ${result.correlationId}`)
  console.log(`Mode: ${result.dryRun ? 'dry-run (rolled back)' : 'confirmed delete committed'}`)
  console.log('\nMatched scope:')
  for (const [key, value] of Object.entries(result.matched)) console.log(`  ${key}: ${value}`)

  const rows = result.dryRun ? result.rowCounts : result.deletes
  console.log(`\n${result.dryRun ? 'Rows that would be deleted:' : 'Rows deleted:'}`)
  for (const item of rows) {
    const value = result.dryRun ? item.count : item.deleted
    console.log(`  ${item.table}${item.skipped ? ' (missing/skipped)' : ''}: ${value}`)
  }
  console.log('\nSearch logging/access.log, logging/api.log, and logging/error.log by the correlation id above to review this manual reset lifecycle.')
}

async function main() {
  const options = parseArgs()
  if (options.help) {
    printUsage()
    return
  }
  assertSafeExecutionOptions(options)
  const result = await executeAccountDataReset(options)
  printResult(result)
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun) {
  main()
    .catch((error) => {
      if (/^Unsupported account reset type|^Unknown option|no longer supported|Refusing|Targeted identifiers/.test(error.message)) {
        console.error(error.message)
        printUsage()
      } else {
        console.error('Manual account data reset failed:', error)
      }
      process.exitCode = 1
    })
    .finally(async () => {
      try {
        await closeDb()
      } catch (error) {
        logWarn('Failed closing database after manual account reset', { error })
      }
    })
}

export {
  assertSafeExecutionOptions,
  buildScope,
  executeAccountDataReset,
  parseArgs,
}
