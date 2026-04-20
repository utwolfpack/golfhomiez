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

export const APP_MIGRATIONS = [

  {
    version: '20260417_012',
    name: 'host_auth_portal',
    filename: '20260417_012_host_auth_portal.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'host_account_invites') &&
        await tableExists(db, 'host_accounts') &&
        await tableExists(db, 'host_sessions') &&
        await tableExists(db, 'host_password_reset_tokens') &&
        await columnExists(db, 'host_accounts', 'password_hash') &&
        await columnExists(db, 'host_accounts', 'is_validated')
      )
    },
    async getSql(db) {
      const statements = []

      if (!(await tableExists(db, 'host_account_invites'))) {
        statements.push(`CREATE TABLE IF NOT EXISTS host_account_invites (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  email VARCHAR(191) NOT NULL,
  invitee_name VARCHAR(191) NULL,
  golf_course_name VARCHAR(191) NULL,
  security_key_hash VARCHAR(255) NULL,
  security_key VARCHAR(191) NULL,
  register_url VARCHAR(1024) NULL,
  invited_by_admin_id VARCHAR(191) NULL,
  expires_at DATETIME NULL,
  consumed_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_host_invites_email (email),
  INDEX idx_host_invites_active (email, consumed_at, revoked_at, expires_at, created_at)
)`)
      } else {
        const inviteColumns = [
          ['invitee_name', 'ALTER TABLE host_account_invites ADD COLUMN invitee_name VARCHAR(191) NULL'],
          ['golf_course_name', 'ALTER TABLE host_account_invites ADD COLUMN golf_course_name VARCHAR(191) NULL'],
          ['security_key_hash', 'ALTER TABLE host_account_invites ADD COLUMN security_key_hash VARCHAR(255) NULL'],
          ['security_key', 'ALTER TABLE host_account_invites ADD COLUMN security_key VARCHAR(191) NULL'],
          ['register_url', 'ALTER TABLE host_account_invites ADD COLUMN register_url VARCHAR(1024) NULL'],
          ['invited_by_admin_id', 'ALTER TABLE host_account_invites ADD COLUMN invited_by_admin_id VARCHAR(191) NULL'],
          ['expires_at', 'ALTER TABLE host_account_invites ADD COLUMN expires_at DATETIME NULL'],
          ['consumed_at', 'ALTER TABLE host_account_invites ADD COLUMN consumed_at DATETIME NULL'],
          ['revoked_at', 'ALTER TABLE host_account_invites ADD COLUMN revoked_at DATETIME NULL'],
        ]
        for (const [columnName, sql] of inviteColumns) {
          if (!(await columnExists(db, 'host_account_invites', columnName))) statements.push(sql)
        }
        if (!(await indexExists(db, 'host_account_invites', 'idx_host_invites_email'))) {
          statements.push('ALTER TABLE host_account_invites ADD INDEX idx_host_invites_email (email)')
        }
        if (!(await indexExists(db, 'host_account_invites', 'idx_host_invites_active'))) {
          statements.push('ALTER TABLE host_account_invites ADD INDEX idx_host_invites_active (email, consumed_at, revoked_at, expires_at, created_at)')
        }
      }

      if (!(await tableExists(db, 'host_accounts'))) {
        statements.push(`CREATE TABLE IF NOT EXISTS host_accounts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  email VARCHAR(191) NOT NULL,
  golf_course_name VARCHAR(191) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_validated TINYINT(1) NOT NULL DEFAULT 1,
  validated_at DATETIME NULL,
  invite_id VARCHAR(191) NULL,
  reset_email VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_host_accounts_email (email)
)`)
      } else {
        const hostAccountColumns = [
          ['password_hash', 'ALTER TABLE host_accounts ADD COLUMN password_hash VARCHAR(255) NOT NULL DEFAULT ""'],
          ['is_validated', 'ALTER TABLE host_accounts ADD COLUMN is_validated TINYINT(1) NOT NULL DEFAULT 1'],
          ['validated_at', 'ALTER TABLE host_accounts ADD COLUMN validated_at DATETIME NULL'],
          ['invite_id', 'ALTER TABLE host_accounts ADD COLUMN invite_id VARCHAR(191) NULL'],
          ['reset_email', 'ALTER TABLE host_accounts ADD COLUMN reset_email VARCHAR(191) NULL'],
        ]
        for (const [columnName, sql] of hostAccountColumns) {
          if (!(await columnExists(db, 'host_accounts', columnName))) statements.push(sql)
        }
        if (!(await indexExists(db, 'host_accounts', 'uq_host_accounts_email'))) {
          statements.push('ALTER TABLE host_accounts ADD UNIQUE INDEX uq_host_accounts_email (email)')
        }
      }

      if (!(await tableExists(db, 'host_sessions'))) {
        statements.push(`CREATE TABLE IF NOT EXISTS host_sessions (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  host_account_id VARCHAR(191) NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_host_sessions_token_hash (token_hash),
  KEY idx_host_sessions_account (host_account_id),
  KEY idx_host_sessions_expires (expires_at)
)`)
      }

      if (!(await tableExists(db, 'host_password_reset_tokens'))) {
        statements.push(`CREATE TABLE IF NOT EXISTS host_password_reset_tokens (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  host_account_id VARCHAR(191) NOT NULL,
  email VARCHAR(191) NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_host_reset_token_hash (token_hash),
  KEY idx_host_reset_email (email),
  KEY idx_host_reset_host (host_account_id)
)`)
      }

      return statements.join(';\n')
    },
  },
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
]
export function sortMigrations(migrations) {
  return [...migrations].sort((a, b) => a.version.localeCompare(b.version))
}
