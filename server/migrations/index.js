import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { columnExists, foreignKeyExists, indexExists, loadSqlFile, primaryKeyMatches, tableExists } from './helpers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const migrationDir = path.resolve(__dirname, '../../migration_scripts')

export const MIGRATIONS_TABLE = 'app_schema_migrations'

async function loadMigrationSql(filename) {
  return loadSqlFile(path.join(migrationDir, filename))
}


function joinStatements(statements) {
  return statements.filter(Boolean).join(';\n')
}

async function buildAdminPortalDirectAuthSql(db) {
  const statements = []

  if (!(await tableExists(db, 'admin_users'))) {
    statements.push(await loadMigrationSql('20260416_012_admin_portal_direct_auth.sql'))
    return joinStatements(statements)
  }

  const adminUserColumns = [
    ['email', 'ALTER TABLE admin_users ADD COLUMN email VARCHAR(191) NOT NULL DEFAULT "" AFTER username'],
    ['password_hash', 'ALTER TABLE admin_users ADD COLUMN password_hash TEXT NOT NULL AFTER email'],
    ['is_active', 'ALTER TABLE admin_users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER password_hash'],
    ['last_login_at', 'ALTER TABLE admin_users ADD COLUMN last_login_at DATETIME NULL AFTER is_active'],
    ['created_at', 'ALTER TABLE admin_users ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER last_login_at'],
    ['updated_at', 'ALTER TABLE admin_users ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'],
  ]
  for (const [name, sql] of adminUserColumns) {
    if (!(await columnExists(db, 'admin_users', name))) statements.push(sql)
  }
  if (!(await indexExists(db, 'admin_users', 'uq_admin_users_username'))) statements.push('ALTER TABLE admin_users ADD UNIQUE KEY uq_admin_users_username (username)')
  if (!(await indexExists(db, 'admin_users', 'uq_admin_users_email'))) statements.push('ALTER TABLE admin_users ADD UNIQUE KEY uq_admin_users_email (email)')
  if (!(await indexExists(db, 'admin_users', 'idx_admin_users_active'))) statements.push('ALTER TABLE admin_users ADD KEY idx_admin_users_active (is_active)')

  if (!(await tableExists(db, 'admin_password_reset_tokens'))) {
    statements.push(`CREATE TABLE admin_password_reset_tokens (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      admin_user_id VARCHAR(191) NOT NULL,
      email VARCHAR(191) NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      consumed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_admin_reset_token_hash (token_hash),
      KEY idx_admin_reset_admin_user (admin_user_id),
      KEY idx_admin_reset_email (email),
      KEY idx_admin_reset_active (email, consumed_at, expires_at)
    )`)
  } else {
    const resetColumns = [
      ['admin_user_id', 'ALTER TABLE admin_password_reset_tokens ADD COLUMN admin_user_id VARCHAR(191) NOT NULL AFTER id'],
      ['email', 'ALTER TABLE admin_password_reset_tokens ADD COLUMN email VARCHAR(191) NOT NULL AFTER admin_user_id'],
      ['token_hash', 'ALTER TABLE admin_password_reset_tokens ADD COLUMN token_hash VARCHAR(255) NOT NULL AFTER email'],
      ['expires_at', 'ALTER TABLE admin_password_reset_tokens ADD COLUMN expires_at DATETIME NOT NULL AFTER token_hash'],
      ['consumed_at', 'ALTER TABLE admin_password_reset_tokens ADD COLUMN consumed_at DATETIME NULL AFTER expires_at'],
      ['created_at', 'ALTER TABLE admin_password_reset_tokens ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER consumed_at'],
    ]
    for (const [name, sql] of resetColumns) {
      if (!(await columnExists(db, 'admin_password_reset_tokens', name))) statements.push(sql)
    }
    if (!(await indexExists(db, 'admin_password_reset_tokens', 'uq_admin_reset_token_hash'))) statements.push('ALTER TABLE admin_password_reset_tokens ADD UNIQUE KEY uq_admin_reset_token_hash (token_hash)')
    if (!(await indexExists(db, 'admin_password_reset_tokens', 'idx_admin_reset_admin_user'))) statements.push('ALTER TABLE admin_password_reset_tokens ADD KEY idx_admin_reset_admin_user (admin_user_id)')
    if (!(await indexExists(db, 'admin_password_reset_tokens', 'idx_admin_reset_email'))) statements.push('ALTER TABLE admin_password_reset_tokens ADD KEY idx_admin_reset_email (email)')
    if (!(await indexExists(db, 'admin_password_reset_tokens', 'idx_admin_reset_active'))) statements.push('ALTER TABLE admin_password_reset_tokens ADD KEY idx_admin_reset_active (email, consumed_at, expires_at)')
  }

  if (!(await tableExists(db, 'host_account_invites'))) {
    statements.push(`CREATE TABLE host_account_invites (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      email VARCHAR(191) NOT NULL,
      invitee_name VARCHAR(191) NULL,
      golf_course_name VARCHAR(191) NULL,
      security_key_hash VARCHAR(255) NOT NULL,
      invited_by_admin_id VARCHAR(191) NULL,
      expires_at DATETIME NULL,
      consumed_at DATETIME NULL,
      revoked_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_host_invites_email (email),
      KEY idx_host_invites_admin (invited_by_admin_id),
      KEY idx_host_invites_active (email, consumed_at, revoked_at, expires_at)
    )`)
  } else {
    const inviteColumns = [
      ['invitee_name', 'ALTER TABLE host_account_invites ADD COLUMN invitee_name VARCHAR(191) NULL AFTER email'],
      ['golf_course_name', 'ALTER TABLE host_account_invites ADD COLUMN golf_course_name VARCHAR(191) NULL AFTER invitee_name'],
      ['security_key_hash', 'ALTER TABLE host_account_invites ADD COLUMN security_key_hash VARCHAR(255) NOT NULL DEFAULT "" AFTER golf_course_name'],
      ['invited_by_admin_id', 'ALTER TABLE host_account_invites ADD COLUMN invited_by_admin_id VARCHAR(191) NULL AFTER security_key_hash'],
      ['expires_at', 'ALTER TABLE host_account_invites ADD COLUMN expires_at DATETIME NULL AFTER invited_by_admin_id'],
      ['consumed_at', 'ALTER TABLE host_account_invites ADD COLUMN consumed_at DATETIME NULL AFTER expires_at'],
      ['revoked_at', 'ALTER TABLE host_account_invites ADD COLUMN revoked_at DATETIME NULL AFTER consumed_at'],
      ['created_at', 'ALTER TABLE host_account_invites ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER revoked_at'],
    ]
    for (const [name, sql] of inviteColumns) {
      if (!(await columnExists(db, 'host_account_invites', name))) statements.push(sql)
    }
    if (!(await indexExists(db, 'host_account_invites', 'idx_host_invites_email'))) statements.push('ALTER TABLE host_account_invites ADD KEY idx_host_invites_email (email)')
    if (!(await indexExists(db, 'host_account_invites', 'idx_host_invites_admin'))) statements.push('ALTER TABLE host_account_invites ADD KEY idx_host_invites_admin (invited_by_admin_id)')
    if (!(await indexExists(db, 'host_account_invites', 'idx_host_invites_active'))) statements.push('ALTER TABLE host_account_invites ADD KEY idx_host_invites_active (email, consumed_at, revoked_at, expires_at)')
  }

  return joinStatements(statements)
}

async function buildHostAuthPortalSql(db) {
  const statements = []

  if (!(await tableExists(db, 'host_accounts'))) {
    statements.push(await loadMigrationSql('20260417_013_host_auth_portal.sql'))
    return joinStatements(statements)
  }

  const hostAccountColumns = [
    ['auth_user_id', 'ALTER TABLE host_accounts ADD COLUMN auth_user_id VARCHAR(191) NULL AFTER id'],
    ['email', 'ALTER TABLE host_accounts ADD COLUMN email VARCHAR(191) NOT NULL DEFAULT "" AFTER auth_user_id'],
    ['account_name', 'ALTER TABLE host_accounts ADD COLUMN account_name VARCHAR(191) NOT NULL DEFAULT "" AFTER email'],
    ['password_hash', 'ALTER TABLE host_accounts ADD COLUMN password_hash TEXT NOT NULL AFTER account_name'],
    ['invite_id', 'ALTER TABLE host_accounts ADD COLUMN invite_id VARCHAR(191) NULL AFTER password_hash'],
    ['reset_email', 'ALTER TABLE host_accounts ADD COLUMN reset_email VARCHAR(191) NULL AFTER invite_id'],
    ['is_validated', 'ALTER TABLE host_accounts ADD COLUMN is_validated TINYINT(1) NOT NULL DEFAULT 0 AFTER reset_email'],
    ['validated_at', 'ALTER TABLE host_accounts ADD COLUMN validated_at DATETIME NULL AFTER is_validated'],
    ['created_at', 'ALTER TABLE host_accounts ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER validated_at'],
    ['updated_at', 'ALTER TABLE host_accounts ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'],
  ]
  for (const [name, sql] of hostAccountColumns) {
    if (!(await columnExists(db, 'host_accounts', name))) statements.push(sql)
  }
  if (!(await indexExists(db, 'host_accounts', 'uq_host_accounts_email'))) statements.push('ALTER TABLE host_accounts ADD UNIQUE KEY uq_host_accounts_email (email)')
  if (!(await indexExists(db, 'host_accounts', 'idx_host_accounts_invite'))) statements.push('ALTER TABLE host_accounts ADD KEY idx_host_accounts_invite (invite_id)')
  if (!(await indexExists(db, 'host_accounts', 'idx_host_accounts_validated'))) statements.push('ALTER TABLE host_accounts ADD KEY idx_host_accounts_validated (is_validated)')

  if (!(await tableExists(db, 'host_sessions'))) {
    statements.push(`CREATE TABLE host_sessions (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      host_account_id VARCHAR(191) NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_host_sessions_token_hash (token_hash),
      KEY idx_host_sessions_host_account (host_account_id),
      KEY idx_host_sessions_expires_at (expires_at)
    )`)
  } else {
    const sessionColumns = [
      ['host_account_id', 'ALTER TABLE host_sessions ADD COLUMN host_account_id VARCHAR(191) NOT NULL AFTER id'],
      ['token_hash', 'ALTER TABLE host_sessions ADD COLUMN token_hash VARCHAR(255) NOT NULL AFTER host_account_id'],
      ['expires_at', 'ALTER TABLE host_sessions ADD COLUMN expires_at DATETIME NOT NULL AFTER token_hash'],
      ['created_at', 'ALTER TABLE host_sessions ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER expires_at'],
      ['updated_at', 'ALTER TABLE host_sessions ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'],
    ]
    for (const [name, sql] of sessionColumns) {
      if (!(await columnExists(db, 'host_sessions', name))) statements.push(sql)
    }
    if (!(await indexExists(db, 'host_sessions', 'uq_host_sessions_token_hash'))) statements.push('ALTER TABLE host_sessions ADD UNIQUE KEY uq_host_sessions_token_hash (token_hash)')
    if (!(await indexExists(db, 'host_sessions', 'idx_host_sessions_host_account'))) statements.push('ALTER TABLE host_sessions ADD KEY idx_host_sessions_host_account (host_account_id)')
    if (!(await indexExists(db, 'host_sessions', 'idx_host_sessions_expires_at'))) statements.push('ALTER TABLE host_sessions ADD KEY idx_host_sessions_expires_at (expires_at)')
  }

  if (!(await tableExists(db, 'host_password_reset_tokens'))) {
    statements.push(`CREATE TABLE host_password_reset_tokens (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      host_account_id VARCHAR(191) NOT NULL,
      email VARCHAR(191) NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      consumed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_host_reset_token_hash (token_hash),
      KEY idx_host_reset_host_account (host_account_id),
      KEY idx_host_reset_email (email),
      KEY idx_host_reset_active (email, consumed_at, expires_at)
    )`)
  } else {
    const resetColumns = [
      ['host_account_id', 'ALTER TABLE host_password_reset_tokens ADD COLUMN host_account_id VARCHAR(191) NOT NULL AFTER id'],
      ['email', 'ALTER TABLE host_password_reset_tokens ADD COLUMN email VARCHAR(191) NOT NULL AFTER host_account_id'],
      ['token_hash', 'ALTER TABLE host_password_reset_tokens ADD COLUMN token_hash VARCHAR(255) NOT NULL AFTER email'],
      ['expires_at', 'ALTER TABLE host_password_reset_tokens ADD COLUMN expires_at DATETIME NOT NULL AFTER token_hash'],
      ['consumed_at', 'ALTER TABLE host_password_reset_tokens ADD COLUMN consumed_at DATETIME NULL AFTER expires_at'],
      ['created_at', 'ALTER TABLE host_password_reset_tokens ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER consumed_at'],
    ]
    for (const [name, sql] of resetColumns) {
      if (!(await columnExists(db, 'host_password_reset_tokens', name))) statements.push(sql)
    }
    if (!(await indexExists(db, 'host_password_reset_tokens', 'uq_host_reset_token_hash'))) statements.push('ALTER TABLE host_password_reset_tokens ADD UNIQUE KEY uq_host_reset_token_hash (token_hash)')
    if (!(await indexExists(db, 'host_password_reset_tokens', 'idx_host_reset_host_account'))) statements.push('ALTER TABLE host_password_reset_tokens ADD KEY idx_host_reset_host_account (host_account_id)')
    if (!(await indexExists(db, 'host_password_reset_tokens', 'idx_host_reset_email'))) statements.push('ALTER TABLE host_password_reset_tokens ADD KEY idx_host_reset_email (email)')
    if (!(await indexExists(db, 'host_password_reset_tokens', 'idx_host_reset_active'))) statements.push('ALTER TABLE host_password_reset_tokens ADD KEY idx_host_reset_active (email, consumed_at, expires_at)')
  }

  return joinStatements(statements)
}



async function buildRbacAdminPortalReconcileSql(db) {
  const statements = []

  if (!(await tableExists(db, 'role_definitions'))) {
    statements.push(`CREATE TABLE role_definitions (
      role_key VARCHAR(64) NOT NULL PRIMARY KEY,
      display_name VARCHAR(191) NOT NULL,
      description TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`)
  } else {
    const roleColumns = [
      ['display_name', 'ALTER TABLE role_definitions ADD COLUMN display_name VARCHAR(191) NOT NULL DEFAULT "" AFTER role_key'],
      ['description', 'ALTER TABLE role_definitions ADD COLUMN description TEXT NULL AFTER display_name'],
      ['created_at', 'ALTER TABLE role_definitions ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER description'],
      ['updated_at', 'ALTER TABLE role_definitions ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'],
    ]
    for (const [name, sql] of roleColumns) {
      if (!(await columnExists(db, 'role_definitions', name))) statements.push(sql)
    }
  }

  statements.push(`INSERT INTO role_definitions (role_key, display_name, description) VALUES
    ('user', 'User', 'Access to publicly available information and the logged in user profile'),
    ('host', 'Host – Golf Course', 'Access to all golf course information'),
    ('organizer', 'Organizer', 'Access to tournament information for tournaments organized by the logged in user'),
    ('admin', 'Admin', 'Full access to admin portal and application information')
    ON DUPLICATE KEY UPDATE
      display_name = VALUES(display_name),
      description = VALUES(description)`)

  if (!(await tableExists(db, 'user_role_assignments'))) {
    statements.push(`CREATE TABLE user_role_assignments (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      auth_user_id VARCHAR(191) NULL,
      email VARCHAR(191) NULL,
      role_key VARCHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_user_role_assignments_auth_user (auth_user_id),
      KEY idx_user_role_assignments_email (email),
      KEY idx_user_role_assignments_role_status (role_key, status),
      UNIQUE KEY uq_user_role_assignments_auth_role (auth_user_id, role_key)
    )`)
  } else {
    const assignmentColumns = [
      ['auth_user_id', 'ALTER TABLE user_role_assignments ADD COLUMN auth_user_id VARCHAR(191) NULL AFTER id'],
      ['email', 'ALTER TABLE user_role_assignments ADD COLUMN email VARCHAR(191) NULL AFTER auth_user_id'],
      ['role_key', 'ALTER TABLE user_role_assignments ADD COLUMN role_key VARCHAR(64) NOT NULL DEFAULT "user" AFTER email'],
      ['status', 'ALTER TABLE user_role_assignments ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT "active" AFTER role_key'],
      ['created_at', 'ALTER TABLE user_role_assignments ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER status'],
      ['updated_at', 'ALTER TABLE user_role_assignments ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'],
    ]
    for (const [name, sql] of assignmentColumns) {
      if (!(await columnExists(db, 'user_role_assignments', name))) statements.push(sql)
    }
    if (!(await indexExists(db, 'user_role_assignments', 'idx_user_role_assignments_auth_user'))) statements.push('ALTER TABLE user_role_assignments ADD KEY idx_user_role_assignments_auth_user (auth_user_id)')
    if (!(await indexExists(db, 'user_role_assignments', 'idx_user_role_assignments_email'))) statements.push('ALTER TABLE user_role_assignments ADD KEY idx_user_role_assignments_email (email)')
    if (!(await indexExists(db, 'user_role_assignments', 'idx_user_role_assignments_role_status'))) statements.push('ALTER TABLE user_role_assignments ADD KEY idx_user_role_assignments_role_status (role_key, status)')
    if (!(await indexExists(db, 'user_role_assignments', 'uq_user_role_assignments_auth_role'))) statements.push('ALTER TABLE user_role_assignments ADD UNIQUE KEY uq_user_role_assignments_auth_role (auth_user_id, role_key)')
  }

  if (await tableExists(db, 'app_users') && await columnExists(db, 'app_users', 'id') && await columnExists(db, 'app_users', 'email')) {
    statements.push(`INSERT INTO user_role_assignments (id, auth_user_id, email, role_key, status)
      SELECT REPLACE(UUID(), '-', ''), au.id, au.email, 'user', 'active'
      FROM app_users au
      LEFT JOIN user_role_assignments ura
        ON ura.auth_user_id = au.id
       AND ura.role_key = 'user'
      WHERE ura.id IS NULL`)
  }

  if (!(await tableExists(db, 'host_role_accounts'))) {
    statements.push(`CREATE TABLE host_role_accounts (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      auth_user_id VARCHAR(191) NULL,
      email VARCHAR(191) NOT NULL,
      golf_course_name VARCHAR(191) NULL,
      account_name VARCHAR(191) NULL,
      is_validated TINYINT(1) NOT NULL DEFAULT 0,
      validated_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_host_role_accounts_auth_user (auth_user_id),
      KEY idx_host_role_accounts_email (email)
    )`)
  } else {
    const hostRoleColumns = [
      ['auth_user_id', 'ALTER TABLE host_role_accounts ADD COLUMN auth_user_id VARCHAR(191) NULL AFTER id'],
      ['email', 'ALTER TABLE host_role_accounts ADD COLUMN email VARCHAR(191) NOT NULL DEFAULT "" AFTER auth_user_id'],
      ['golf_course_name', 'ALTER TABLE host_role_accounts ADD COLUMN golf_course_name VARCHAR(191) NULL AFTER email'],
      ['account_name', 'ALTER TABLE host_role_accounts ADD COLUMN account_name VARCHAR(191) NULL AFTER golf_course_name'],
      ['is_validated', 'ALTER TABLE host_role_accounts ADD COLUMN is_validated TINYINT(1) NOT NULL DEFAULT 0 AFTER account_name'],
      ['validated_at', 'ALTER TABLE host_role_accounts ADD COLUMN validated_at DATETIME NULL AFTER is_validated'],
      ['created_at', 'ALTER TABLE host_role_accounts ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER validated_at'],
      ['updated_at', 'ALTER TABLE host_role_accounts ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'],
    ]
    for (const [name, sql] of hostRoleColumns) {
      if (!(await columnExists(db, 'host_role_accounts', name))) statements.push(sql)
    }
    if (!(await indexExists(db, 'host_role_accounts', 'idx_host_role_accounts_auth_user'))) statements.push('ALTER TABLE host_role_accounts ADD KEY idx_host_role_accounts_auth_user (auth_user_id)')
    if (!(await indexExists(db, 'host_role_accounts', 'idx_host_role_accounts_email'))) statements.push('ALTER TABLE host_role_accounts ADD KEY idx_host_role_accounts_email (email)')
  }

  if (!(await tableExists(db, 'organizer_role_accounts'))) {
    statements.push(`CREATE TABLE organizer_role_accounts (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      auth_user_id VARCHAR(191) NULL,
      email VARCHAR(191) NOT NULL,
      display_name VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_organizer_role_accounts_auth_user (auth_user_id),
      KEY idx_organizer_role_accounts_email (email)
    )`)
  } else {
    const organizerColumns = [
      ['auth_user_id', 'ALTER TABLE organizer_role_accounts ADD COLUMN auth_user_id VARCHAR(191) NULL AFTER id'],
      ['email', 'ALTER TABLE organizer_role_accounts ADD COLUMN email VARCHAR(191) NOT NULL DEFAULT "" AFTER auth_user_id'],
      ['display_name', 'ALTER TABLE organizer_role_accounts ADD COLUMN display_name VARCHAR(191) NULL AFTER email'],
      ['created_at', 'ALTER TABLE organizer_role_accounts ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER display_name'],
      ['updated_at', 'ALTER TABLE organizer_role_accounts ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'],
    ]
    for (const [name, sql] of organizerColumns) {
      if (!(await columnExists(db, 'organizer_role_accounts', name))) statements.push(sql)
    }
    if (!(await indexExists(db, 'organizer_role_accounts', 'idx_organizer_role_accounts_auth_user'))) statements.push('ALTER TABLE organizer_role_accounts ADD KEY idx_organizer_role_accounts_auth_user (auth_user_id)')
    if (!(await indexExists(db, 'organizer_role_accounts', 'idx_organizer_role_accounts_email'))) statements.push('ALTER TABLE organizer_role_accounts ADD KEY idx_organizer_role_accounts_email (email)')
  }

  if (!(await tableExists(db, 'tournaments'))) {
    statements.push(`CREATE TABLE tournaments (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      organizer_account_id VARCHAR(191) NULL,
      host_account_id VARCHAR(191) NULL,
      name VARCHAR(191) NOT NULL,
      description TEXT NULL,
      course_name VARCHAR(191) NULL,
      start_date DATETIME NULL,
      end_date DATETIME NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'draft',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_tournaments_organizer (organizer_account_id),
      KEY idx_tournaments_host (host_account_id),
      KEY idx_tournaments_status (status)
    )`)
  } else {
    const tournamentColumns = [
      ['organizer_account_id', 'ALTER TABLE tournaments ADD COLUMN organizer_account_id VARCHAR(191) NULL AFTER id'],
      ['host_account_id', 'ALTER TABLE tournaments ADD COLUMN host_account_id VARCHAR(191) NULL AFTER organizer_account_id'],
      ['name', 'ALTER TABLE tournaments ADD COLUMN name VARCHAR(191) NOT NULL DEFAULT "Untitled tournament" AFTER host_account_id'],
      ['description', 'ALTER TABLE tournaments ADD COLUMN description TEXT NULL AFTER name'],
      ['course_name', 'ALTER TABLE tournaments ADD COLUMN course_name VARCHAR(191) NULL AFTER description'],
      ['start_date', 'ALTER TABLE tournaments ADD COLUMN start_date DATETIME NULL AFTER course_name'],
      ['end_date', 'ALTER TABLE tournaments ADD COLUMN end_date DATETIME NULL AFTER start_date'],
      ['status', 'ALTER TABLE tournaments ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT "draft" AFTER end_date'],
      ['created_at', 'ALTER TABLE tournaments ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER status'],
      ['updated_at', 'ALTER TABLE tournaments ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'],
    ]
    for (const [name, sql] of tournamentColumns) {
      if (!(await columnExists(db, 'tournaments', name))) statements.push(sql)
    }
    if (!(await indexExists(db, 'tournaments', 'idx_tournaments_organizer'))) statements.push('ALTER TABLE tournaments ADD KEY idx_tournaments_organizer (organizer_account_id)')
    if (!(await indexExists(db, 'tournaments', 'idx_tournaments_host'))) statements.push('ALTER TABLE tournaments ADD KEY idx_tournaments_host (host_account_id)')
    if (!(await indexExists(db, 'tournaments', 'idx_tournaments_status'))) statements.push('ALTER TABLE tournaments ADD KEY idx_tournaments_status (status)')
  }

  if (await tableExists(db, 'host_accounts')) {
    const hostCompatColumns = [
      ['auth_user_id', 'ALTER TABLE host_accounts ADD COLUMN auth_user_id VARCHAR(191) NULL AFTER id'],
      ['email', 'ALTER TABLE host_accounts ADD COLUMN email VARCHAR(191) NOT NULL DEFAULT "" AFTER auth_user_id'],
      ['account_name', 'ALTER TABLE host_accounts ADD COLUMN account_name VARCHAR(191) NOT NULL DEFAULT "" AFTER email'],
      ['golf_course_name', 'ALTER TABLE host_accounts ADD COLUMN golf_course_name VARCHAR(191) NULL AFTER account_name'],
      ['password_hash', 'ALTER TABLE host_accounts ADD COLUMN password_hash TEXT NOT NULL AFTER golf_course_name'],
      ['invite_id', 'ALTER TABLE host_accounts ADD COLUMN invite_id VARCHAR(191) NULL AFTER password_hash'],
      ['reset_email', 'ALTER TABLE host_accounts ADD COLUMN reset_email VARCHAR(191) NULL AFTER invite_id'],
      ['is_validated', 'ALTER TABLE host_accounts ADD COLUMN is_validated TINYINT(1) NOT NULL DEFAULT 0 AFTER reset_email'],
      ['validated_at', 'ALTER TABLE host_accounts ADD COLUMN validated_at DATETIME NULL AFTER is_validated'],
      ['created_at', 'ALTER TABLE host_accounts ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER validated_at'],
      ['updated_at', 'ALTER TABLE host_accounts ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'],
    ]
    for (const [name, sql] of hostCompatColumns) {
      if (!(await columnExists(db, 'host_accounts', name))) statements.push(sql)
    }
  }

  if (await tableExists(db, 'host_account_invites')) {
    const inviteCompatColumns = [
      ['email', 'ALTER TABLE host_account_invites ADD COLUMN email VARCHAR(191) NOT NULL DEFAULT "" AFTER id'],
      ['invitee_name', 'ALTER TABLE host_account_invites ADD COLUMN invitee_name VARCHAR(191) NULL AFTER email'],
      ['golf_course_name', 'ALTER TABLE host_account_invites ADD COLUMN golf_course_name VARCHAR(191) NULL AFTER invitee_name'],
      ['account_name', 'ALTER TABLE host_account_invites ADD COLUMN account_name VARCHAR(191) NULL AFTER golf_course_name'],
      ['security_key_hash', 'ALTER TABLE host_account_invites ADD COLUMN security_key_hash VARCHAR(255) NOT NULL DEFAULT "" AFTER account_name'],
      ['invited_by_admin_id', 'ALTER TABLE host_account_invites ADD COLUMN invited_by_admin_id VARCHAR(191) NULL AFTER security_key_hash'],
      ['expires_at', 'ALTER TABLE host_account_invites ADD COLUMN expires_at DATETIME NULL AFTER invited_by_admin_id'],
      ['consumed_at', 'ALTER TABLE host_account_invites ADD COLUMN consumed_at DATETIME NULL AFTER expires_at'],
      ['revoked_at', 'ALTER TABLE host_account_invites ADD COLUMN revoked_at DATETIME NULL AFTER consumed_at'],
      ['created_at', 'ALTER TABLE host_account_invites ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER revoked_at'],
      ['updated_at', 'ALTER TABLE host_account_invites ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'],
    ]
    for (const [name, sql] of inviteCompatColumns) {
      if (!(await columnExists(db, 'host_account_invites', name))) statements.push(sql)
    }
  }

  return joinStatements(statements)
}

export const APP_MIGRATIONS = [
  {
    version: '20260326_001',
    name: 'baseline_app_schema',
    filename: '20260326_001_baseline_app_schema.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'teams') &&
        await tableExists(db, 'team_members') &&
        await tableExists(db, 'scores') &&
        await columnExists(db, 'scores', 'created_by_user_id') &&
        await indexExists(db, 'scores', 'idx_scores_created_by') &&
        await foreignKeyExists(db, 'team_members', 'fk_team_members_team')
      )
    },
    async getSql() {
      return loadMigrationSql('20260326_001_baseline_app_schema.sql')
    },
  },
  {
    version: '20260326_002',
    name: 'align_scores_table',
    filename: '20260326_002_align_scores_table.sql',
    async isSatisfied(db) {
      return (
        await columnExists(db, 'scores', 'mode') &&
        await columnExists(db, 'scores', 'holes_json') &&
        await indexExists(db, 'scores', 'idx_scores_date')
      )
    },
    async getSql() {
      return loadMigrationSql('20260326_002_align_scores_table.sql')
    },
  },

  {
    version: '20260327_003',
    name: 'drop_stale_scores_user_fk',
    filename: '20260327_003_drop_stale_scores_user_fk.sql',
    async isSatisfied(db) {
      return !(await foreignKeyExists(db, 'scores', 'fk_scores_user'))
    },
    async getSql() {
      return loadMigrationSql('20260327_003_drop_stale_scores_user_fk.sql')
    },
  },

  {
    version: '20260402_004',
    name: 'backfill_legacy_users_as_verified',
    filename: '20260402_004_backfill_legacy_users_as_verified.sql',
    async isSatisfied(db) {
      const [[{ pending = 0 } = {}] = []] = await db.query(`
        SELECT COUNT(*) AS pending
        FROM \`user\`
        WHERE COALESCE(emailVerified, 0) = 0
      `)
      return Number(pending) === 0
    },
    async getSql() {
      return loadMigrationSql('20260402_004_backfill_legacy_users_as_verified.sql')
    },
  },
  {
    version: '20260403_006',
    name: 'team_member_invites',
    filename: '20260403_006_team_member_invites.sql',
    async isSatisfied(db) {
      return await tableExists(db, 'invitations')
    },
    async getSql() {
      return loadMigrationSql('20260403_006_team_member_invites.sql')
    },
  },
  {
    version: '20260409_009',
    name: 'team_member_primary_key_scope',
    filename: '20260409_009_team_member_primary_key_scope.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'team_members') &&
        await primaryKeyMatches(db, 'team_members', ['team_id', 'id']) &&
        await indexExists(db, 'team_members', 'idx_team_members_member_id')
      )
    },
    async getSql() {
      return loadMigrationSql('20260409_009_team_member_primary_key_scope.sql')
    },
  },
  {
    version: '20260411_010',
    name: 'app_user_profiles',
    filename: '20260411_010_app_user_profiles.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'app_users') &&
        await columnExists(db, 'app_users', 'primary_city') &&
        await columnExists(db, 'app_users', 'primary_state') &&
        await columnExists(db, 'app_users', 'primary_zip_code') &&
        await columnExists(db, 'app_users', 'alcohol_preference') &&
        await columnExists(db, 'app_users', 'cannabis_preference') &&
        await columnExists(db, 'app_users', 'sobriety_preference') &&
        await columnExists(db, 'app_users', 'profile_enriched_at') &&
        await indexExists(db, 'app_users', 'idx_app_users_enriched')
      )
    },
    async getSql(db) {
      const hasTable = await tableExists(db, 'app_users')
      if (!hasTable) {
        return loadMigrationSql('20260411_010_app_user_profiles.sql')
      }

      const statements = []
      const columns = [
        ['primary_city', 'ALTER TABLE app_users ADD COLUMN primary_city VARCHAR(191) NULL AFTER name'],
        ['primary_state', 'ALTER TABLE app_users ADD COLUMN primary_state VARCHAR(64) NULL AFTER primary_city'],
        ['primary_zip_code', 'ALTER TABLE app_users ADD COLUMN primary_zip_code VARCHAR(16) NULL AFTER primary_state'],
        ['alcohol_preference', 'ALTER TABLE app_users ADD COLUMN alcohol_preference VARCHAR(64) NULL AFTER primary_zip_code'],
        ['cannabis_preference', 'ALTER TABLE app_users ADD COLUMN cannabis_preference VARCHAR(64) NULL AFTER alcohol_preference'],
        ['sobriety_preference', 'ALTER TABLE app_users ADD COLUMN sobriety_preference VARCHAR(64) NULL AFTER cannabis_preference'],
        ['profile_enriched_at', 'ALTER TABLE app_users ADD COLUMN profile_enriched_at DATETIME NULL AFTER sobriety_preference'],
      ]

      for (const [columnName, sql] of columns) {
        if (!(await columnExists(db, 'app_users', columnName))) statements.push(sql)
      }

      if (!(await indexExists(db, 'app_users', 'idx_app_users_enriched'))) {
        statements.push('ALTER TABLE app_users ADD INDEX idx_app_users_enriched (profile_enriched_at)')
      }

      return statements.join(';\n')
    },
  },
  {
    version: '20260413_011',
    name: 'remove_profile_state_code',
    filename: '20260413_011_remove_profile_state_code.sql',
    async isSatisfied(db) {
      return !(await columnExists(db, 'app_users', 'primary_state_code'))
    },
    async getSql() {
      return loadMigrationSql('20260413_011_remove_profile_state_code.sql')
    },
  }
  ,
  {
    version: '20260416_012',
    name: 'admin_portal_direct_auth',
    filename: '20260416_012_admin_portal_direct_auth.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'admin_users') &&
        await columnExists(db, 'admin_users', 'password_hash') &&
        await tableExists(db, 'admin_password_reset_tokens') &&
        await tableExists(db, 'host_account_invites') &&
        await columnExists(db, 'host_account_invites', 'security_key_hash') &&
        await indexExists(db, 'host_account_invites', 'idx_host_invites_active')
      )
    },
    async getSql(db) {
      return buildAdminPortalDirectAuthSql(db)
    },
  },
  {
    version: '20260417_013',
    name: 'host_auth_portal',
    filename: '20260417_013_host_auth_portal.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'host_accounts') &&
        await columnExists(db, 'host_accounts', 'password_hash') &&
        await columnExists(db, 'host_accounts', 'is_validated') &&
        await tableExists(db, 'host_sessions') &&
        await columnExists(db, 'host_sessions', 'token_hash') &&
        await tableExists(db, 'host_password_reset_tokens') &&
        await indexExists(db, 'host_sessions', 'uq_host_sessions_token_hash')
      )
    },
    async getSql(db) {
      return buildHostAuthPortalSql(db)
    },
  },
  {
    version: '20260420_014',
    name: 'rbac_admin_portal_reconcile',
    filename: '20260420_014_rbac_admin_portal_reconcile.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'role_definitions') &&
        await tableExists(db, 'user_role_assignments') &&
        await tableExists(db, 'host_role_accounts') &&
        await tableExists(db, 'organizer_role_accounts') &&
        await tableExists(db, 'tournaments') &&
        await columnExists(db, 'host_accounts', 'account_name') &&
        await columnExists(db, 'host_account_invites', 'account_name')
      )
    },
    async getSql(db) {
      return buildRbacAdminPortalReconcileSql(db)
    },
  }
]
export function sortMigrations(migrations) {
  return [...migrations].sort((a, b) => a.version.localeCompare(b.version))
}
