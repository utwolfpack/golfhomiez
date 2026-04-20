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
  }
]
export function sortMigrations(migrations) {
  return [...migrations].sort((a, b) => a.version.localeCompare(b.version))
}
