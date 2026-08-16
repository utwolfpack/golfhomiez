/* global process */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { getPool, closeDb } from '../db.js'
import { logApi, logError, logInfo } from '../lib/logger.js'

const RESET_COLLATION = 'utf8mb4_general_ci'
const WORK_TABLES = ['manual_delete_target_email', 'manual_delete_auth_users', 'manual_delete_host_accounts', 'manual_delete_host_role_accounts', 'manual_delete_organizer_accounts', 'manual_delete_role_assignments', 'manual_delete_tournaments', 'manual_delete_teams']

function printUsage() {
  console.log(`Manual GolfHomiez user deletion

Usage:
  npm run data:delete-user -- --email user@example.com --dry-run
  npm run data:delete-user -- --email user@example.com --confirm

Options:
  --email <email>    Required target email address. Matching is case-insensitive.
  --dry-run          Show matched/deletable row counts without deleting.
  --confirm          Required before deletes are committed.
  --help             Show this help text.

This manual deletion runner is not wired into npm install or postinstall.
`)
}

function readValueArg(args, index, flag) {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
  return value
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const args = [...argv]
  const options = {
    email: env.DELETE_USER_EMAIL || '',
    dryRun: false,
    confirm: false,
    help: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--confirm') options.confirm = true
    else if (arg === '--email') {
      options.email = readValueArg(args, index, arg)
      index += 1
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  options.email = normalizeEmail(options.email)
  return options
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  return email
}

export function assertSafeExecutionOptions(options) {
  if (options.help) return
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.email || '')) throw new Error('A valid --email value is required before deleting user data.')
  if (!options.dryRun && !options.confirm) throw new Error('Refusing to delete user data without --confirm. Run with --dry-run first to review matched rows.')
}

function quoteIdentifier(name) {
  const value = String(name || '')
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`Unsafe SQL identifier: ${name}`)
  return `\`${value}\``
}

function stringExpr(alias, column) {
  return `CONVERT(${alias}.${quoteIdentifier(column)} USING utf8mb4) COLLATE ${RESET_COLLATION}`
}

function lowerExpr(alias, column) {
  return `LOWER(${stringExpr(alias, column)})`
}

function workExpr(column) {
  return `CONVERT(${quoteIdentifier(column)} USING utf8mb4) COLLATE ${RESET_COLLATION}`
}

function workSelect(tableName, column, where = '') {
  return `SELECT ${workExpr(column)} FROM ${quoteIdentifier(tableName)}${where ? ` ${where}` : ''}`
}

function workLowerSelect(tableName, column, where = '') {
  return `SELECT LOWER(${workExpr(column)}) FROM ${quoteIdentifier(tableName)}${where ? ` ${where}` : ''}`
}

function inWorkColumn(alias, column, tableName, workColumn = column, where = '') {
  return `${stringExpr(alias, column)} IN (${workSelect(tableName, workColumn, where)})`
}

function lowerInWorkColumn(alias, column, tableName, workColumn = column, where = '') {
  return `${lowerExpr(alias, column)} IN (${workLowerSelect(tableName, workColumn, where)})`
}

async function tableExists(db, tableName) {
  const [rows] = await db.execute('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1', [tableName])
  return rows.length > 0
}

async function columnsFor(db, tableName) {
  const [rows] = await db.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [tableName])
  return new Set(rows.map((row) => row.COLUMN_NAME))
}

function hasColumn(columns, column) {
  return columns.has(column)
}

async function dropWorkTables(db) {
  for (const tableName of [...WORK_TABLES].reverse()) await db.query(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`)
}

async function createWorkTables(db) {
  await dropWorkTables(db)
  await db.query(`CREATE TABLE ${quoteIdentifier('manual_delete_target_email')} (email VARCHAR(512) NOT NULL PRIMARY KEY) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
  await db.query(`CREATE TABLE ${quoteIdentifier('manual_delete_auth_users')} (id VARCHAR(191) NOT NULL PRIMARY KEY, email VARCHAR(191) NULL, KEY idx_email (email)) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
  await db.query(`CREATE TABLE ${quoteIdentifier('manual_delete_host_accounts')} (id VARCHAR(191) NOT NULL PRIMARY KEY, email VARCHAR(191) NULL, auth_user_id VARCHAR(191) NULL, invite_id VARCHAR(191) NULL, KEY idx_email (email), KEY idx_auth_user (auth_user_id), KEY idx_invite (invite_id)) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
  await db.query(`CREATE TABLE ${quoteIdentifier('manual_delete_host_role_accounts')} (id VARCHAR(191) NOT NULL PRIMARY KEY, email VARCHAR(191) NULL, auth_user_id VARCHAR(191) NULL, role_assignment_id VARCHAR(191) NULL, KEY idx_email (email), KEY idx_auth_user (auth_user_id), KEY idx_assignment (role_assignment_id)) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
  await db.query(`CREATE TABLE ${quoteIdentifier('manual_delete_organizer_accounts')} (id VARCHAR(191) NOT NULL PRIMARY KEY, email VARCHAR(191) NULL, auth_user_id VARCHAR(191) NULL, role_assignment_id VARCHAR(191) NULL, KEY idx_email (email), KEY idx_auth_user (auth_user_id), KEY idx_assignment (role_assignment_id)) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
  await db.query(`CREATE TABLE ${quoteIdentifier('manual_delete_role_assignments')} (id VARCHAR(191) NOT NULL PRIMARY KEY, auth_user_id VARCHAR(191) NULL, email VARCHAR(191) NULL, role_key VARCHAR(64) NULL, KEY idx_email (email), KEY idx_auth_user (auth_user_id), KEY idx_role (role_key)) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
  await db.query(`CREATE TABLE ${quoteIdentifier('manual_delete_tournaments')} (id VARCHAR(191) NOT NULL PRIMARY KEY) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
  await db.query(`CREATE TABLE ${quoteIdentifier('manual_delete_teams')} (id VARCHAR(191) NOT NULL PRIMARY KEY) ENGINE=Memory DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
}

async function insertTargetEmail(db, email) {
  await db.execute('INSERT IGNORE INTO manual_delete_target_email (email) VALUES (?)', [email])
}

async function insertAuthUserScope(db) {
  if (await tableExists(db, 'user')) {
    const columns = await columnsFor(db, 'user')
    if (hasColumn(columns, 'id')) {
      const emailExpression = hasColumn(columns, 'email') ? 'u.email' : 'NULL'
      const matches = []
      if (hasColumn(columns, 'email')) matches.push(lowerInWorkColumn('u', 'email', 'manual_delete_target_email', 'email'))
      if (hasColumn(columns, 'id')) matches.push(lowerInWorkColumn('u', 'id', 'manual_delete_target_email', 'email'))
      if (matches.length) {
        await db.query(`INSERT IGNORE INTO manual_delete_auth_users (id, email) SELECT u.id, ${emailExpression} FROM \`user\` u WHERE ${matches.join(' OR ')}`)
      }
    }
  }

  if (await tableExists(db, 'app_users')) {
    const columns = await columnsFor(db, 'app_users')
    if (hasColumn(columns, 'auth_user_id')) {
      const emailExpression = hasColumn(columns, 'email') ? 'au.email' : 'NULL'
      const matches = []
      if (hasColumn(columns, 'email')) matches.push(lowerInWorkColumn('au', 'email', 'manual_delete_target_email', 'email'))
      if (hasColumn(columns, 'auth_user_id')) matches.push(lowerInWorkColumn('au', 'auth_user_id', 'manual_delete_target_email', 'email'))
      if (matches.length) {
        await db.query(`INSERT IGNORE INTO manual_delete_auth_users (id, email) SELECT au.auth_user_id, ${emailExpression} FROM app_users au WHERE ${matches.join(' OR ')}`)
      }
    }
  }
}

async function insertRoleAssignments(db) {
  if (!(await tableExists(db, 'user_role_assignments'))) return
  const columns = await columnsFor(db, 'user_role_assignments')
  if (!hasColumn(columns, 'id')) return
  const authExpr = hasColumn(columns, 'auth_user_id') ? 'ura.auth_user_id' : 'NULL'
  const emailExpr = hasColumn(columns, 'email') ? 'ura.email' : 'NULL'
  const roleExpr = hasColumn(columns, 'role_key') ? 'ura.role_key' : 'NULL'
  const matches = []
  if (hasColumn(columns, 'auth_user_id')) matches.push(inWorkColumn('ura', 'auth_user_id', 'manual_delete_auth_users', 'id'))
  if (hasColumn(columns, 'email')) matches.push(lowerInWorkColumn('ura', 'email', 'manual_delete_target_email', 'email'))
  if (!matches.length) return
  await db.query(`INSERT IGNORE INTO manual_delete_role_assignments (id, auth_user_id, email, role_key) SELECT ura.id, ${authExpr}, ${emailExpr}, ${roleExpr} FROM user_role_assignments ura WHERE ${matches.join(' OR ')}`)
}

async function insertHostScopes(db) {
  if (await tableExists(db, 'host_accounts')) {
    const columns = await columnsFor(db, 'host_accounts')
    if (hasColumn(columns, 'id')) {
      const matches = []
      if (hasColumn(columns, 'auth_user_id')) matches.push(inWorkColumn('ha', 'auth_user_id', 'manual_delete_auth_users', 'id'))
      if (hasColumn(columns, 'email')) matches.push(lowerInWorkColumn('ha', 'email', 'manual_delete_target_email', 'email'))
      if (hasColumn(columns, 'reset_email')) matches.push(lowerInWorkColumn('ha', 'reset_email', 'manual_delete_target_email', 'email'))
      if (matches.length) {
        await db.query(`INSERT IGNORE INTO manual_delete_host_accounts (id, email, auth_user_id, invite_id)
          SELECT ha.id, ${hasColumn(columns, 'email') ? 'ha.email' : 'NULL'}, ${hasColumn(columns, 'auth_user_id') ? 'ha.auth_user_id' : 'NULL'}, ${hasColumn(columns, 'invite_id') ? 'ha.invite_id' : 'NULL'}
          FROM host_accounts ha WHERE ${matches.join(' OR ')}`)
      }
    }
  }

  if (await tableExists(db, 'host_role_accounts')) {
    const columns = await columnsFor(db, 'host_role_accounts')
    if (hasColumn(columns, 'id')) {
      const matches = []
      if (hasColumn(columns, 'auth_user_id')) matches.push(inWorkColumn('hra', 'auth_user_id', 'manual_delete_auth_users', 'id'))
      if (hasColumn(columns, 'email')) matches.push(lowerInWorkColumn('hra', 'email', 'manual_delete_target_email', 'email'))
      if (hasColumn(columns, 'role_assignment_id')) matches.push(inWorkColumn('hra', 'role_assignment_id', 'manual_delete_role_assignments', 'id'))
      if (matches.length) {
        await db.query(`INSERT IGNORE INTO manual_delete_host_role_accounts (id, email, auth_user_id, role_assignment_id)
          SELECT hra.id, ${hasColumn(columns, 'email') ? 'hra.email' : 'NULL'}, ${hasColumn(columns, 'auth_user_id') ? 'hra.auth_user_id' : 'NULL'}, ${hasColumn(columns, 'role_assignment_id') ? 'hra.role_assignment_id' : 'NULL'}
          FROM host_role_accounts hra WHERE ${matches.join(' OR ')}`)
      }
    }
  }
}

async function insertOrganizerScopes(db) {
  if (!(await tableExists(db, 'organizer_role_accounts'))) return
  const columns = await columnsFor(db, 'organizer_role_accounts')
  if (!hasColumn(columns, 'id')) return
  const matches = []
  if (hasColumn(columns, 'auth_user_id')) matches.push(inWorkColumn('ora', 'auth_user_id', 'manual_delete_auth_users', 'id'))
  if (hasColumn(columns, 'email')) matches.push(lowerInWorkColumn('ora', 'email', 'manual_delete_target_email', 'email'))
  if (hasColumn(columns, 'reset_email')) matches.push(lowerInWorkColumn('ora', 'reset_email', 'manual_delete_target_email', 'email'))
  if (hasColumn(columns, 'role_assignment_id')) matches.push(inWorkColumn('ora', 'role_assignment_id', 'manual_delete_role_assignments', 'id'))
  if (!matches.length) return
  await db.query(`INSERT IGNORE INTO manual_delete_organizer_accounts (id, email, auth_user_id, role_assignment_id)
    SELECT ora.id, ${hasColumn(columns, 'email') ? 'ora.email' : 'NULL'}, ${hasColumn(columns, 'auth_user_id') ? 'ora.auth_user_id' : 'NULL'}, ${hasColumn(columns, 'role_assignment_id') ? 'ora.role_assignment_id' : 'NULL'}
    FROM organizer_role_accounts ora WHERE ${matches.join(' OR ')}`)
}

async function insertTournamentScope(db) {
  if (!(await tableExists(db, 'tournaments'))) return
  const columns = await columnsFor(db, 'tournaments')
  if (!hasColumn(columns, 'id')) return
  const predicates = []
  if (hasColumn(columns, 'host_account_id')) predicates.push(inWorkColumn('t', 'host_account_id', 'manual_delete_host_accounts', 'id'))
  if (hasColumn(columns, 'host_account_id')) predicates.push(inWorkColumn('t', 'host_account_id', 'manual_delete_host_role_accounts', 'id'))
  if (hasColumn(columns, 'organizer_account_id')) predicates.push(inWorkColumn('t', 'organizer_account_id', 'manual_delete_organizer_accounts', 'id'))
  if (hasColumn(columns, 'organizer_email')) predicates.push(lowerInWorkColumn('t', 'organizer_email', 'manual_delete_target_email', 'email'))
  if (hasColumn(columns, 'created_by_auth_user_id')) predicates.push(inWorkColumn('t', 'created_by_auth_user_id', 'manual_delete_auth_users', 'id'))
  if (!predicates.length) return
  await db.query(`INSERT IGNORE INTO manual_delete_tournaments (id) SELECT DISTINCT t.id FROM tournaments t WHERE ${predicates.join(' OR ')}`)
}

async function insertTeamScope(db) {
  if (!(await tableExists(db, 'team_members'))) return
  const columns = await columnsFor(db, 'team_members')
  if (!hasColumn(columns, 'team_id')) return
  const predicates = []
  if (hasColumn(columns, 'id')) predicates.push(inWorkColumn('tm', 'id', 'manual_delete_auth_users', 'id'))
  if (hasColumn(columns, 'email')) predicates.push(lowerInWorkColumn('tm', 'email', 'manual_delete_target_email', 'email'))
  if (!predicates.length) return
  await db.query(`INSERT IGNORE INTO manual_delete_teams (id) SELECT DISTINCT tm.team_id FROM team_members tm WHERE ${predicates.join(' OR ')}`)
}

async function buildScope(db, email) {
  await createWorkTables(db)
  await insertTargetEmail(db, email)
  await insertAuthUserScope(db)
  await insertRoleAssignments(db)
  await insertHostScopes(db)
  await insertOrganizerScopes(db)
  await insertTournamentScope(db)
  await insertTeamScope(db)
}

async function countWorkTable(db, tableName) {
  const [rows] = await db.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`)
  return Number(rows[0]?.count || 0)
}

async function countRows(db, tableName, predicate) {
  if (!(await tableExists(db, tableName))) return { table: tableName, count: 0, skipped: true }
  const [rows] = await db.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)} t WHERE ${predicate}`)
  return { table: tableName, count: Number(rows[0]?.count || 0), skipped: false }
}

async function deleteRows(db, tableName, predicate) {
  if (!(await tableExists(db, tableName))) return { table: tableName, deleted: 0, skipped: true }
  const [result] = await db.query(`DELETE t FROM ${quoteIdentifier(tableName)} t WHERE ${predicate}`)
  return { table: tableName, deleted: result.affectedRows || 0, skipped: false }
}

function userPredicates(columns) {
  const predicates = []
  if (hasColumn(columns, 'userId')) predicates.push(inWorkColumn('t', 'userId', 'manual_delete_auth_users', 'id'))
  if (hasColumn(columns, 'user_id')) predicates.push(inWorkColumn('t', 'user_id', 'manual_delete_auth_users', 'id'))
  if (hasColumn(columns, 'auth_user_id')) predicates.push(inWorkColumn('t', 'auth_user_id', 'manual_delete_auth_users', 'id'))
  if (hasColumn(columns, 'created_by_user_id')) predicates.push(inWorkColumn('t', 'created_by_user_id', 'manual_delete_auth_users', 'id'))
  if (hasColumn(columns, 'updated_by_auth_user_id')) predicates.push(inWorkColumn('t', 'updated_by_auth_user_id', 'manual_delete_auth_users', 'id'))
  if (hasColumn(columns, 'sender_user_id')) predicates.push(inWorkColumn('t', 'sender_user_id', 'manual_delete_auth_users', 'id'))
  if (hasColumn(columns, 'recipient_user_id')) predicates.push(inWorkColumn('t', 'recipient_user_id', 'manual_delete_auth_users', 'id'))
  for (const column of ['email', 'created_by_email', 'sender_email', 'recipient_email', 'identifier']) {
    if (hasColumn(columns, column)) predicates.push(lowerInWorkColumn('t', column, 'manual_delete_target_email', 'email'))
  }
  if (hasColumn(columns, 'user_key')) {
    predicates.push(inWorkColumn('t', 'user_key', 'manual_delete_auth_users', 'id'))
    predicates.push(lowerInWorkColumn('t', 'user_key', 'manual_delete_target_email', 'email'))
    predicates.push(`${lowerExpr('t', 'user_key')} IN (SELECT LOWER(CONCAT(${workExpr('id')}, '|', ${workExpr('email')})) FROM manual_delete_auth_users WHERE email IS NOT NULL)`)
  }
  return predicates
}

async function buildDeleteOperations(db) {
  const operations = []
  const byTournament = (column = 'tournament_id') => inWorkColumn('t', column, 'manual_delete_tournaments', 'id')
  const byHostId = (column) => [inWorkColumn('t', column, 'manual_delete_host_accounts', 'id'), inWorkColumn('t', column, 'manual_delete_host_role_accounts', 'id')]
  const byHostEmail = (column) => [lowerInWorkColumn('t', column, 'manual_delete_host_accounts', 'email', 'WHERE email IS NOT NULL'), lowerInWorkColumn('t', column, 'manual_delete_host_role_accounts', 'email', 'WHERE email IS NOT NULL')]
  const byOrganizerId = (column) => inWorkColumn('t', column, 'manual_delete_organizer_accounts', 'id')
  const byOrganizerEmail = (column) => lowerInWorkColumn('t', column, 'manual_delete_organizer_accounts', 'email', 'WHERE email IS NOT NULL')

  for (const tableName of ['tournament_team_start_assignments', 'tournament_team_scores', 'tournament_registrations', 'golf_course_tournaments', 'organizer_tournament_invites']) {
    if (!(await tableExists(db, tableName))) continue
    const columns = await columnsFor(db, tableName)
    const predicates = []
    if (hasColumn(columns, 'tournament_id')) predicates.push(byTournament('tournament_id'))
    if (hasColumn(columns, 'golfhomiez_tournament_id')) predicates.push(byTournament('golfhomiez_tournament_id'))
    if (hasColumn(columns, 'host_account_id')) predicates.push(...byHostId('host_account_id'))
    if (hasColumn(columns, 'organizer_account_id')) predicates.push(byOrganizerId('organizer_account_id'))
    if (hasColumn(columns, 'organizer_email')) predicates.push(byOrganizerEmail('organizer_email'))
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

  for (const tableName of ['organizer_sessions', 'organizer_password_reset_tokens']) {
    if (!(await tableExists(db, tableName))) continue
    const columns = await columnsFor(db, tableName)
    const predicates = []
    if (hasColumn(columns, 'organizer_account_id')) predicates.push(byOrganizerId('organizer_account_id'))
    if (hasColumn(columns, 'email')) predicates.push(byOrganizerEmail('email'))
    if (predicates.length) operations.push({ tableName, predicate: predicates.join(' OR ') })
  }

  if (await tableExists(db, 'host_account_requests')) {
    const columns = await columnsFor(db, 'host_account_requests')
    const predicates = []
    if (hasColumn(columns, 'approved_host_account_id')) predicates.push(...byHostId('approved_host_account_id'))
    if (hasColumn(columns, 'email')) predicates.push(lowerInWorkColumn('t', 'email', 'manual_delete_target_email', 'email'))
    if (predicates.length) operations.push({ tableName: 'host_account_requests', predicate: predicates.join(' OR ') })
  }

  if (await tableExists(db, 'host_account_invites')) {
    const columns = await columnsFor(db, 'host_account_invites')
    const predicates = []
    if (hasColumn(columns, 'id')) predicates.push(inWorkColumn('t', 'id', 'manual_delete_host_accounts', 'invite_id', 'WHERE invite_id IS NOT NULL'))
    for (const column of ['email', 'invitee_email']) if (hasColumn(columns, column)) predicates.push(lowerInWorkColumn('t', column, 'manual_delete_target_email', 'email'))
    if (predicates.length) operations.push({ tableName: 'host_account_invites', predicate: predicates.join(' OR ') })
  }

  if (await tableExists(db, 'tournaments')) operations.push({ tableName: 'tournaments', predicate: inWorkColumn('t', 'id', 'manual_delete_tournaments', 'id') })

  for (const tableName of ['session', 'account', 'verification', 'email_verification_tokens', 'scorecard_hole_drafts', 'scores', 'inbox_challenge_user_state', 'inbox_messages', 'app_users']) {
    if (!(await tableExists(db, tableName))) continue
    const columns = await columnsFor(db, tableName)
    const predicates = userPredicates(columns)
    if (predicates.length) operations.push({ tableName, predicate: predicates.join(' OR ') })
  }

  if (await tableExists(db, 'team_members')) {
    const columns = await columnsFor(db, 'team_members')
    const predicates = userPredicates(columns)
    if (hasColumn(columns, 'team_id')) predicates.push(inWorkColumn('t', 'team_id', 'manual_delete_teams', 'id'))
    if (predicates.length) operations.push({ tableName: 'team_members', predicate: predicates.join(' OR ') })
  }

  if (await tableExists(db, 'teams')) operations.push({ tableName: 'teams', predicate: inWorkColumn('t', 'id', 'manual_delete_teams', 'id') })
  if (await tableExists(db, 'host_accounts')) operations.push({ tableName: 'host_accounts', predicate: inWorkColumn('t', 'id', 'manual_delete_host_accounts', 'id') })
  if (await tableExists(db, 'host_role_accounts')) operations.push({ tableName: 'host_role_accounts', predicate: inWorkColumn('t', 'id', 'manual_delete_host_role_accounts', 'id') })
  if (await tableExists(db, 'organizer_role_accounts')) operations.push({ tableName: 'organizer_role_accounts', predicate: inWorkColumn('t', 'id', 'manual_delete_organizer_accounts', 'id') })
  if (await tableExists(db, 'user_role_assignments')) operations.push({ tableName: 'user_role_assignments', predicate: inWorkColumn('t', 'id', 'manual_delete_role_assignments', 'id') })
  if (await tableExists(db, 'user')) operations.push({ tableName: 'user', predicate: inWorkColumn('t', 'id', 'manual_delete_auth_users', 'id') })

  return operations
}

async function countOperations(db, operations) {
  const counts = []
  for (const operation of operations) counts.push(await countRows(db, operation.tableName, operation.predicate))
  return counts
}

async function deleteOperations(db, operations) {
  const deletes = []
  for (const operation of operations) deletes.push(await deleteRows(db, operation.tableName, operation.predicate))
  return deletes
}

async function matchedSummary(db) {
  return {
    authUsers: await countWorkTable(db, 'manual_delete_auth_users'),
    hostAccounts: await countWorkTable(db, 'manual_delete_host_accounts'),
    hostRoleAccounts: await countWorkTable(db, 'manual_delete_host_role_accounts'),
    organizerAccounts: await countWorkTable(db, 'manual_delete_organizer_accounts'),
    roleAssignments: await countWorkTable(db, 'manual_delete_role_assignments'),
    tournaments: await countWorkTable(db, 'manual_delete_tournaments'),
    teams: await countWorkTable(db, 'manual_delete_teams'),
  }
}

export async function executeManualUserDelete(options) {
  assertSafeExecutionOptions(options)
  const correlationId = randomUUID()
  const pool = getPool()
  const db = await pool.getConnection()

  logApi('manual_user_delete_started', { correlationId, email: options.email, dryRun: options.dryRun })

  try {
    await buildScope(db, options.email)
    const operations = await buildDeleteOperations(db)
    const summary = await matchedSummary(db)
    const counts = await countOperations(db, operations)

    if (options.dryRun) {
      logApi('manual_user_delete_dry_run_completed', { correlationId, email: options.email, summary, counts })
      return { correlationId, dryRun: true, email: options.email, summary, counts, deletes: [], committed: false }
    }

    await db.beginTransaction()
    const deletes = await deleteOperations(db, operations)
    await db.commit()
    logApi('manual_user_delete_committed', { correlationId, email: options.email, summary, deletes })
    return { correlationId, dryRun: false, email: options.email, summary, counts, deletes, committed: true }
  } catch (error) {
    try { await db.rollback() } catch { /* rollback may fail when no transaction was started */ }
    logError('manual_user_delete_failed', { correlationId, email: options.email, error })
    throw error
  } finally {
    await dropWorkTables(db)
    db.release()
  }
}

function isDirectRun() {
  return process.argv[1] && process.argv[1].endsWith('delete-user-data.js')
}

async function main() {
  try {
    const options = parseArgs()
    if (options.help) {
      printUsage()
      return
    }
    assertSafeExecutionOptions(options)
    const result = await executeManualUserDelete(options)
    console.log(JSON.stringify(result, null, 2))
    logInfo('Manual user delete finished', { correlationId: result.correlationId, email: result.email, committed: result.committed })
  } catch (error) {
    console.error('Manual user delete failed:', error)
    process.exitCode = 1
  } finally {
    await closeDb()
  }
}

if (isDirectRun()) main()
