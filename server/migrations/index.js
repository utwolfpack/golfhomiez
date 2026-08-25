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

async function columnCollation(db, tableName, columnName) {
  const [[row] = []] = await db.execute(
    `SELECT COLLATION_NAME AS collationName
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [tableName, columnName],
  )
  return row?.collationName || null
}



async function uniqueTeamNameIndexExists(db) {
  const [rows] = await db.execute(
    `SELECT INDEX_NAME AS indexName
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'teams'
        AND COLUMN_NAME = 'name'
        AND NON_UNIQUE = 0
      LIMIT 1`,
  )
  return rows.length > 0
}

async function columnIsNullable(db, tableName, columnName) {
  const [[row] = []] = await db.execute(
    `SELECT IS_NULLABLE AS isNullable
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [tableName, columnName],
  )
  return !row || row.isNullable === 'YES'
}

async function columnIsAutoIncrement(db, tableName, columnName) {
  const [[row] = []] = await db.execute(
    `SELECT EXTRA AS extra
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [tableName, columnName],
  )
  return String(row?.extra || '').toLowerCase().includes('auto_increment')
}

async function blankTextRowCount(db, tableName, columnName) {
  const [[row = {}] = []] = await db.execute(
    `SELECT COUNT(*) AS blankCount
       FROM ${tableName}
      WHERE ${columnName} IS NOT NULL
        AND TRIM(${columnName}) = ''`,
  )
  return Number(row.blankCount || 0)
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
  },
  {
    version: '20260420_015',
    name: 'admin_rbac_portal_compat',
    filename: '20260420_015_admin_rbac_portal_compat.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'role_definitions') &&
        await tableExists(db, 'user_role_assignments') &&
        await tableExists(db, 'admin_users') &&
        await tableExists(db, 'admin_password_reset_tokens') &&
        await tableExists(db, 'host_account_invites') &&
        await tableExists(db, 'host_accounts') &&
        await tableExists(db, 'host_sessions') &&
        await tableExists(db, 'host_password_reset_tokens') &&
        await columnExists(db, 'admin_users', 'password_hash') &&
        await columnExists(db, 'admin_users', 'password_salt') &&
        await columnExists(db, 'admin_users', 'is_active') &&
        await columnExists(db, 'host_account_invites', 'invitee_email') &&
        await columnExists(db, 'host_account_invites', 'account_name') &&
        await columnExists(db, 'host_account_invites', 'security_key_hash') &&
        await columnExists(db, 'host_account_invites', 'revoked_at') &&
        await columnExists(db, 'host_accounts', 'account_name') &&
        await columnExists(db, 'host_accounts', 'password_hash') &&
        await columnExists(db, 'host_accounts', 'password_salt') &&
        await columnExists(db, 'host_accounts', 'is_validated') &&
        await columnExists(db, 'host_accounts', 'validated_at') &&
        await columnExists(db, 'host_sessions', 'host_account_id') &&
        await columnExists(db, 'host_sessions', 'token_hash') &&
        await columnExists(db, 'host_password_reset_tokens', 'token_hash')
      )
    },
    async getSql(db) {
      const statements = []
      const push = (sql) => {
        if (sql) statements.push(sql)
      }

      const reconcileTable = async (tableName, createSql, columns = [], indexes = []) => {
        if (!(await tableExists(db, tableName))) {
          push(createSql)
          return
        }
        for (const [columnName, sql] of columns) {
          if (!(await columnExists(db, tableName, columnName))) push(sql)
        }
        for (const [indexName, sql] of indexes) {
          if (!(await indexExists(db, tableName, indexName))) push(sql)
        }
      }

      await reconcileTable(
        'role_definitions',
        `CREATE TABLE role_definitions (
  role_key VARCHAR(64) NOT NULL PRIMARY KEY,
  display_name VARCHAR(191) NOT NULL,
  description TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`,
        [
          ['display_name', 'ALTER TABLE role_definitions ADD COLUMN display_name VARCHAR(191) NULL'],
          ['description', 'ALTER TABLE role_definitions ADD COLUMN description TEXT NULL'],
          ['created_at', 'ALTER TABLE role_definitions ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
          ['updated_at', 'ALTER TABLE role_definitions ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
        ]
      )

      await reconcileTable(
        'user_role_assignments',
        `CREATE TABLE user_role_assignments (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  auth_user_id VARCHAR(191) NULL,
  email VARCHAR(191) NULL,
  role_key VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_role_assignments_auth_user (auth_user_id),
  INDEX idx_user_role_assignments_email (email),
  INDEX idx_user_role_assignments_role_key (role_key)
)`,
        [
          ['auth_user_id', 'ALTER TABLE user_role_assignments ADD COLUMN auth_user_id VARCHAR(191) NULL'],
          ['email', 'ALTER TABLE user_role_assignments ADD COLUMN email VARCHAR(191) NULL'],
          ['status', "ALTER TABLE user_role_assignments ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active'"],
          ['created_at', 'ALTER TABLE user_role_assignments ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
          ['updated_at', 'ALTER TABLE user_role_assignments ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
        ],
        [
          ['idx_user_role_assignments_auth_user', 'ALTER TABLE user_role_assignments ADD INDEX idx_user_role_assignments_auth_user (auth_user_id)'],
          ['idx_user_role_assignments_email', 'ALTER TABLE user_role_assignments ADD INDEX idx_user_role_assignments_email (email)'],
          ['idx_user_role_assignments_role_key', 'ALTER TABLE user_role_assignments ADD INDEX idx_user_role_assignments_role_key (role_key)'],
        ]
      )

      await reconcileTable(
        'admin_users',
        `CREATE TABLE admin_users (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  username VARCHAR(191) NOT NULL,
  email VARCHAR(191) NULL,
  password_hash VARCHAR(255) NOT NULL,
  password_salt VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_users_username (username),
  UNIQUE KEY uq_admin_users_email (email)
)`,
        [
          ['email', 'ALTER TABLE admin_users ADD COLUMN email VARCHAR(191) NULL'],
          ['password_hash', 'ALTER TABLE admin_users ADD COLUMN password_hash VARCHAR(255) NULL'],
          ['password_salt', 'ALTER TABLE admin_users ADD COLUMN password_salt VARCHAR(255) NULL'],
          ['is_active', 'ALTER TABLE admin_users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1'],
          ['last_login_at', 'ALTER TABLE admin_users ADD COLUMN last_login_at DATETIME NULL'],
          ['created_at', 'ALTER TABLE admin_users ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
          ['updated_at', 'ALTER TABLE admin_users ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
        ],
        [
          ['uq_admin_users_username', 'ALTER TABLE admin_users ADD UNIQUE INDEX uq_admin_users_username (username)'],
          ['uq_admin_users_email', 'ALTER TABLE admin_users ADD UNIQUE INDEX uq_admin_users_email (email)'],
        ]
      )

      await reconcileTable(
        'admin_password_reset_tokens',
        `CREATE TABLE admin_password_reset_tokens (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  admin_user_id VARCHAR(191) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_password_reset_token_hash (token_hash),
  KEY idx_admin_password_reset_admin_user_id (admin_user_id)
)`,
        [
          ['admin_user_id', 'ALTER TABLE admin_password_reset_tokens ADD COLUMN admin_user_id VARCHAR(191) NULL'],
          ['token_hash', 'ALTER TABLE admin_password_reset_tokens ADD COLUMN token_hash VARCHAR(255) NULL'],
          ['expires_at', 'ALTER TABLE admin_password_reset_tokens ADD COLUMN expires_at DATETIME NULL'],
          ['used_at', 'ALTER TABLE admin_password_reset_tokens ADD COLUMN used_at DATETIME NULL'],
          ['created_at', 'ALTER TABLE admin_password_reset_tokens ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
        ],
        [
          ['uq_admin_password_reset_token_hash', 'ALTER TABLE admin_password_reset_tokens ADD UNIQUE INDEX uq_admin_password_reset_token_hash (token_hash)'],
          ['idx_admin_password_reset_admin_user_id', 'ALTER TABLE admin_password_reset_tokens ADD INDEX idx_admin_password_reset_admin_user_id (admin_user_id)'],
        ]
      )

      const compatTables = [
        {
          name: 'host_role_accounts',
          createSql: `CREATE TABLE host_role_accounts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  auth_user_id VARCHAR(191) NULL,
  email VARCHAR(191) NULL,
  golf_course_name VARCHAR(191) NULL,
  account_name VARCHAR(191) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_host_role_accounts_auth_user_id (auth_user_id),
  KEY idx_host_role_accounts_email (email)
)`,
          columns: [
            ['auth_user_id', 'ALTER TABLE host_role_accounts ADD COLUMN auth_user_id VARCHAR(191) NULL'],
            ['email', 'ALTER TABLE host_role_accounts ADD COLUMN email VARCHAR(191) NULL'],
            ['golf_course_name', 'ALTER TABLE host_role_accounts ADD COLUMN golf_course_name VARCHAR(191) NULL'],
            ['account_name', 'ALTER TABLE host_role_accounts ADD COLUMN account_name VARCHAR(191) NULL'],
            ['status', "ALTER TABLE host_role_accounts ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active'"],
            ['created_at', 'ALTER TABLE host_role_accounts ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
            ['updated_at', 'ALTER TABLE host_role_accounts ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
          ],
          indexes: [
            ['idx_host_role_accounts_auth_user_id', 'ALTER TABLE host_role_accounts ADD INDEX idx_host_role_accounts_auth_user_id (auth_user_id)'],
            ['idx_host_role_accounts_email', 'ALTER TABLE host_role_accounts ADD INDEX idx_host_role_accounts_email (email)'],
          ],
        },
        {
          name: 'organizer_role_accounts',
          createSql: `CREATE TABLE organizer_role_accounts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  auth_user_id VARCHAR(191) NULL,
  email VARCHAR(191) NULL,
  organizer_name VARCHAR(191) NULL,
  organization_name VARCHAR(191) NULL,
  contact_name VARCHAR(191) NULL,
  phone VARCHAR(64) NULL,
  website_url VARCHAR(512) NULL,
  notes TEXT NULL,
  password_hash VARCHAR(255) NULL,
  reset_email VARCHAR(191) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_organizer_role_accounts_auth_user_id (auth_user_id),
  KEY idx_organizer_role_accounts_email (email)
)`,
          columns: [
            ['auth_user_id', 'ALTER TABLE organizer_role_accounts ADD COLUMN auth_user_id VARCHAR(191) NULL'],
            ['email', 'ALTER TABLE organizer_role_accounts ADD COLUMN email VARCHAR(191) NULL'],
            ['organizer_name', 'ALTER TABLE organizer_role_accounts ADD COLUMN organizer_name VARCHAR(191) NULL'],
            ['organization_name', 'ALTER TABLE organizer_role_accounts ADD COLUMN organization_name VARCHAR(191) NULL'],
            ['contact_name', 'ALTER TABLE organizer_role_accounts ADD COLUMN contact_name VARCHAR(191) NULL'],
            ['phone', 'ALTER TABLE organizer_role_accounts ADD COLUMN phone VARCHAR(64) NULL'],
            ['website_url', 'ALTER TABLE organizer_role_accounts ADD COLUMN website_url VARCHAR(512) NULL'],
            ['notes', 'ALTER TABLE organizer_role_accounts ADD COLUMN notes TEXT NULL'],
            ['password_hash', 'ALTER TABLE organizer_role_accounts ADD COLUMN password_hash VARCHAR(255) NULL'],
            ['reset_email', 'ALTER TABLE organizer_role_accounts ADD COLUMN reset_email VARCHAR(191) NULL'],
            ['status', "ALTER TABLE organizer_role_accounts ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active'"],
            ['created_at', 'ALTER TABLE organizer_role_accounts ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
            ['updated_at', 'ALTER TABLE organizer_role_accounts ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
          ],
          indexes: [
            ['idx_organizer_role_accounts_auth_user_id', 'ALTER TABLE organizer_role_accounts ADD INDEX idx_organizer_role_accounts_auth_user_id (auth_user_id)'],
            ['idx_organizer_role_accounts_email', 'ALTER TABLE organizer_role_accounts ADD INDEX idx_organizer_role_accounts_email (email)'],
          ],
        },
        {
          name: 'tournaments',
          createSql: `CREATE TABLE tournaments (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  organizer_account_id VARCHAR(191) NULL,
  host_account_id VARCHAR(191) NULL,
  title VARCHAR(191) NOT NULL,
  description TEXT NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tournaments_organizer_account_id (organizer_account_id),
  KEY idx_tournaments_host_account_id (host_account_id)
)`,
          columns: [
            ['organizer_account_id', 'ALTER TABLE tournaments ADD COLUMN organizer_account_id VARCHAR(191) NULL'],
            ['host_account_id', 'ALTER TABLE tournaments ADD COLUMN host_account_id VARCHAR(191) NULL'],
            ['title', 'ALTER TABLE tournaments ADD COLUMN title VARCHAR(191) NULL'],
            ['description', 'ALTER TABLE tournaments ADD COLUMN description TEXT NULL'],
            ['starts_at', 'ALTER TABLE tournaments ADD COLUMN starts_at DATETIME NULL'],
            ['ends_at', 'ALTER TABLE tournaments ADD COLUMN ends_at DATETIME NULL'],
            ['status', "ALTER TABLE tournaments ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'draft'"],
            ['created_at', 'ALTER TABLE tournaments ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
            ['updated_at', 'ALTER TABLE tournaments ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
          ],
          indexes: [
            ['idx_tournaments_organizer_account_id', 'ALTER TABLE tournaments ADD INDEX idx_tournaments_organizer_account_id (organizer_account_id)'],
            ['idx_tournaments_host_account_id', 'ALTER TABLE tournaments ADD INDEX idx_tournaments_host_account_id (host_account_id)'],
          ],
        },
        {
          name: 'host_account_invites',
          createSql: `CREATE TABLE host_account_invites (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  invitee_email VARCHAR(191) NULL,
  email VARCHAR(191) NULL,
  invitee_name VARCHAR(191) NULL,
  name VARCHAR(191) NULL,
  golf_course_name VARCHAR(191) NULL,
  account_name VARCHAR(191) NULL,
  course_name VARCHAR(191) NULL,
  security_key_hash VARCHAR(255) NULL,
  security_key VARCHAR(255) NULL,
  invited_by_admin_id VARCHAR(191) NULL,
  admin_user_id VARCHAR(191) NULL,
  expires_at DATETIME NULL,
  consumed_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_host_account_invites_email (invitee_email),
  KEY idx_host_account_invites_legacy_email (email),
  KEY idx_host_account_invites_admin_user_id (invited_by_admin_id),
  KEY idx_host_account_invites_expires_at (expires_at)
)`,
          columns: [
            ['invitee_email', 'ALTER TABLE host_account_invites ADD COLUMN invitee_email VARCHAR(191) NULL'],
            ['email', 'ALTER TABLE host_account_invites ADD COLUMN email VARCHAR(191) NULL'],
            ['invitee_name', 'ALTER TABLE host_account_invites ADD COLUMN invitee_name VARCHAR(191) NULL'],
            ['name', 'ALTER TABLE host_account_invites ADD COLUMN name VARCHAR(191) NULL'],
            ['golf_course_name', 'ALTER TABLE host_account_invites ADD COLUMN golf_course_name VARCHAR(191) NULL'],
            ['account_name', 'ALTER TABLE host_account_invites ADD COLUMN account_name VARCHAR(191) NULL'],
            ['course_name', 'ALTER TABLE host_account_invites ADD COLUMN course_name VARCHAR(191) NULL'],
            ['security_key_hash', 'ALTER TABLE host_account_invites ADD COLUMN security_key_hash VARCHAR(255) NULL'],
            ['security_key', 'ALTER TABLE host_account_invites ADD COLUMN security_key VARCHAR(255) NULL'],
            ['invited_by_admin_id', 'ALTER TABLE host_account_invites ADD COLUMN invited_by_admin_id VARCHAR(191) NULL'],
            ['admin_user_id', 'ALTER TABLE host_account_invites ADD COLUMN admin_user_id VARCHAR(191) NULL'],
            ['expires_at', 'ALTER TABLE host_account_invites ADD COLUMN expires_at DATETIME NULL'],
            ['consumed_at', 'ALTER TABLE host_account_invites ADD COLUMN consumed_at DATETIME NULL'],
            ['revoked_at', 'ALTER TABLE host_account_invites ADD COLUMN revoked_at DATETIME NULL'],
            ['created_at', 'ALTER TABLE host_account_invites ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
            ['updated_at', 'ALTER TABLE host_account_invites ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
          ],
          indexes: [
            ['idx_host_account_invites_email', 'ALTER TABLE host_account_invites ADD INDEX idx_host_account_invites_email (invitee_email)'],
            ['idx_host_account_invites_legacy_email', 'ALTER TABLE host_account_invites ADD INDEX idx_host_account_invites_legacy_email (email)'],
            ['idx_host_account_invites_admin_user_id', 'ALTER TABLE host_account_invites ADD INDEX idx_host_account_invites_admin_user_id (invited_by_admin_id)'],
            ['idx_host_account_invites_expires_at', 'ALTER TABLE host_account_invites ADD INDEX idx_host_account_invites_expires_at (expires_at)'],
          ],
        },
        {
          name: 'host_accounts',
          createSql: `CREATE TABLE host_accounts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  auth_user_id VARCHAR(191) NULL,
  email VARCHAR(191) NULL,
  password_hash VARCHAR(255) NULL,
  password_salt VARCHAR(255) NULL,
  golf_course_name VARCHAR(191) NULL,
  account_name VARCHAR(191) NULL,
  course_name VARCHAR(191) NULL,
  name VARCHAR(191) NULL,
  invite_id VARCHAR(191) NULL,
  reset_email VARCHAR(191) NULL,
  contact_name VARCHAR(191) NULL,
  phone VARCHAR(64) NULL,
  website_url VARCHAR(512) NULL,
  notes TEXT NULL,
  is_validated TINYINT(1) NOT NULL DEFAULT 0,
  validated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_host_accounts_email (email),
  KEY idx_host_accounts_auth_user_id (auth_user_id),
  KEY idx_host_accounts_invite_id (invite_id)
)`,
          columns: [
            ['auth_user_id', 'ALTER TABLE host_accounts ADD COLUMN auth_user_id VARCHAR(191) NULL'],
            ['email', 'ALTER TABLE host_accounts ADD COLUMN email VARCHAR(191) NULL'],
            ['password_hash', 'ALTER TABLE host_accounts ADD COLUMN password_hash VARCHAR(255) NULL'],
            ['password_salt', 'ALTER TABLE host_accounts ADD COLUMN password_salt VARCHAR(255) NULL'],
            ['golf_course_name', 'ALTER TABLE host_accounts ADD COLUMN golf_course_name VARCHAR(191) NULL'],
            ['account_name', 'ALTER TABLE host_accounts ADD COLUMN account_name VARCHAR(191) NULL'],
            ['course_name', 'ALTER TABLE host_accounts ADD COLUMN course_name VARCHAR(191) NULL'],
            ['name', 'ALTER TABLE host_accounts ADD COLUMN name VARCHAR(191) NULL'],
            ['invite_id', 'ALTER TABLE host_accounts ADD COLUMN invite_id VARCHAR(191) NULL'],
            ['reset_email', 'ALTER TABLE host_accounts ADD COLUMN reset_email VARCHAR(191) NULL'],
            ['contact_name', 'ALTER TABLE host_accounts ADD COLUMN contact_name VARCHAR(191) NULL'],
            ['phone', 'ALTER TABLE host_accounts ADD COLUMN phone VARCHAR(64) NULL'],
            ['website_url', 'ALTER TABLE host_accounts ADD COLUMN website_url VARCHAR(512) NULL'],
            ['notes', 'ALTER TABLE host_accounts ADD COLUMN notes TEXT NULL'],
            ['is_validated', 'ALTER TABLE host_accounts ADD COLUMN is_validated TINYINT(1) NOT NULL DEFAULT 0'],
            ['validated_at', 'ALTER TABLE host_accounts ADD COLUMN validated_at DATETIME NULL'],
            ['created_at', 'ALTER TABLE host_accounts ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
            ['updated_at', 'ALTER TABLE host_accounts ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
          ],
          indexes: [
            ['idx_host_accounts_email', 'ALTER TABLE host_accounts ADD INDEX idx_host_accounts_email (email)'],
            ['idx_host_accounts_auth_user_id', 'ALTER TABLE host_accounts ADD INDEX idx_host_accounts_auth_user_id (auth_user_id)'],
            ['idx_host_accounts_invite_id', 'ALTER TABLE host_accounts ADD INDEX idx_host_accounts_invite_id (invite_id)'],
          ],
        },
        {
          name: 'host_sessions',
          createSql: `CREATE TABLE host_sessions (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  host_account_id VARCHAR(191) NULL,
  host_id VARCHAR(191) NULL,
  account_id VARCHAR(191) NULL,
  token_hash VARCHAR(255) NULL,
  token VARCHAR(255) NULL,
  session_token VARCHAR(255) NULL,
  session_id VARCHAR(255) NULL,
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_host_sessions_host_account_id (host_account_id),
  KEY idx_host_sessions_token_hash (token_hash),
  KEY idx_host_sessions_token (token),
  KEY idx_host_sessions_session_token (session_token),
  KEY idx_host_sessions_session_id (session_id)
)`,
          columns: [
            ['host_account_id', 'ALTER TABLE host_sessions ADD COLUMN host_account_id VARCHAR(191) NULL'],
            ['host_id', 'ALTER TABLE host_sessions ADD COLUMN host_id VARCHAR(191) NULL'],
            ['account_id', 'ALTER TABLE host_sessions ADD COLUMN account_id VARCHAR(191) NULL'],
            ['token_hash', 'ALTER TABLE host_sessions ADD COLUMN token_hash VARCHAR(255) NULL'],
            ['token', 'ALTER TABLE host_sessions ADD COLUMN token VARCHAR(255) NULL'],
            ['session_token', 'ALTER TABLE host_sessions ADD COLUMN session_token VARCHAR(255) NULL'],
            ['session_id', 'ALTER TABLE host_sessions ADD COLUMN session_id VARCHAR(255) NULL'],
            ['expires_at', 'ALTER TABLE host_sessions ADD COLUMN expires_at DATETIME NULL'],
            ['created_at', 'ALTER TABLE host_sessions ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
            ['updated_at', 'ALTER TABLE host_sessions ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
          ],
          indexes: [
            ['idx_host_sessions_host_account_id', 'ALTER TABLE host_sessions ADD INDEX idx_host_sessions_host_account_id (host_account_id)'],
            ['idx_host_sessions_token_hash', 'ALTER TABLE host_sessions ADD INDEX idx_host_sessions_token_hash (token_hash)'],
            ['idx_host_sessions_token', 'ALTER TABLE host_sessions ADD INDEX idx_host_sessions_token (token)'],
            ['idx_host_sessions_session_token', 'ALTER TABLE host_sessions ADD INDEX idx_host_sessions_session_token (session_token)'],
            ['idx_host_sessions_session_id', 'ALTER TABLE host_sessions ADD INDEX idx_host_sessions_session_id (session_id)'],
          ],
        },
        {
          name: 'host_password_reset_tokens',
          createSql: `CREATE TABLE host_password_reset_tokens (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  host_account_id VARCHAR(191) NULL,
  host_id VARCHAR(191) NULL,
  email VARCHAR(191) NULL,
  token_hash VARCHAR(255) NULL,
  token VARCHAR(255) NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_host_password_reset_host_account_id (host_account_id),
  KEY idx_host_password_reset_email (email),
  KEY idx_host_password_reset_token_hash (token_hash),
  KEY idx_host_password_reset_token (token)
)`,
          columns: [
            ['host_account_id', 'ALTER TABLE host_password_reset_tokens ADD COLUMN host_account_id VARCHAR(191) NULL'],
            ['host_id', 'ALTER TABLE host_password_reset_tokens ADD COLUMN host_id VARCHAR(191) NULL'],
            ['email', 'ALTER TABLE host_password_reset_tokens ADD COLUMN email VARCHAR(191) NULL'],
            ['token_hash', 'ALTER TABLE host_password_reset_tokens ADD COLUMN token_hash VARCHAR(255) NULL'],
            ['token', 'ALTER TABLE host_password_reset_tokens ADD COLUMN token VARCHAR(255) NULL'],
            ['expires_at', 'ALTER TABLE host_password_reset_tokens ADD COLUMN expires_at DATETIME NULL'],
            ['used_at', 'ALTER TABLE host_password_reset_tokens ADD COLUMN used_at DATETIME NULL'],
            ['created_at', 'ALTER TABLE host_password_reset_tokens ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
          ],
          indexes: [
            ['idx_host_password_reset_host_account_id', 'ALTER TABLE host_password_reset_tokens ADD INDEX idx_host_password_reset_host_account_id (host_account_id)'],
            ['idx_host_password_reset_email', 'ALTER TABLE host_password_reset_tokens ADD INDEX idx_host_password_reset_email (email)'],
            ['idx_host_password_reset_token_hash', 'ALTER TABLE host_password_reset_tokens ADD INDEX idx_host_password_reset_token_hash (token_hash)'],
            ['idx_host_password_reset_token', 'ALTER TABLE host_password_reset_tokens ADD INDEX idx_host_password_reset_token (token)'],
          ],
        },
      ]

      for (const table of compatTables) {
        await reconcileTable(table.name, table.createSql, table.columns, table.indexes)
      }

      push(`INSERT INTO role_definitions (role_key, display_name, description)
VALUES
  ('user', 'User', 'Access to public and self information'),
  ('host', 'Host – Golf Course', 'Access to golf course information'),
  ('organizer', 'Organizer', 'Access to organizer tournament information'),
  ('admin', 'Admin', 'Direct admin portal access')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  updated_at = CURRENT_TIMESTAMP`)

      return statements.join(';\n')
    },
  },
  {
    version: '20260421_016',
    name: 'scores_golf_course_catalog_columns',
    filename: '20260421_016_scores_golf_course_catalog_columns.sql',
    async isSatisfied(db) {
      return (
        await columnExists(db, 'scores', 'golf_course_id') &&
        await columnExists(db, 'scores', 'course_rating') &&
        await columnExists(db, 'scores', 'slope_rating') &&
        await columnExists(db, 'scores', 'course_par') &&
        await indexExists(db, 'scores', 'idx_scores_golf_course_id')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'scores', 'golf_course_id'))) {
        statements.push('ALTER TABLE scores ADD COLUMN golf_course_id VARCHAR(191) NULL AFTER course')
      }
      if (!(await columnExists(db, 'scores', 'course_rating'))) {
        statements.push('ALTER TABLE scores ADD COLUMN course_rating DECIMAL(4,1) NULL AFTER golf_course_id')
      }
      if (!(await columnExists(db, 'scores', 'slope_rating'))) {
        statements.push('ALTER TABLE scores ADD COLUMN slope_rating INT NULL AFTER course_rating')
      }
      if (!(await columnExists(db, 'scores', 'course_par'))) {
        statements.push('ALTER TABLE scores ADD COLUMN course_par INT NULL AFTER slope_rating')
      }
      if (!(await indexExists(db, 'scores', 'idx_scores_golf_course_id'))) {
        statements.push('ALTER TABLE scores ADD INDEX idx_scores_golf_course_id (golf_course_id)')
      }
      return statements.join(';\n')
    },
  },{
  version: '20260422_017',
  name: 'host_account_requests',
  filename: '20260422_017_host_account_requests.sql',
  async isSatisfied(db) {
    return (
      await tableExists(db, 'host_account_requests') &&
      await columnExists(db, 'host_account_requests', 'state_code') &&
      await columnExists(db, 'host_account_requests', 'golf_course_name') &&
      await columnExists(db, 'host_account_requests', 'representative_details') &&
      await indexExists(db, 'host_account_requests', 'idx_host_account_requests_status_created')
    )
  },
  async getSql() {
    return loadMigrationSql('20260422_017_host_account_requests.sql')
  },
},{
  version: '20260422_018',
  name: 'host_account_request_password_hash',
  filename: '20260422_018_host_account_request_password_hash.sql',
  async isSatisfied(db) {
    return (
      await tableExists(db, 'host_account_requests') &&
      await columnExists(db, 'host_account_requests', 'requested_password_hash')
    )
  },
  async getSql() {
    return loadMigrationSql('20260422_018_host_account_request_password_hash.sql')
  },
},
{
  version: '20260427_020',
  name: 'tournament_portals_registrations',
  filename: '20260427_020_tournament_portals_registrations.sql',
  async isSatisfied(db) {
    const [columnRows] = await db.execute(
      `SELECT COLUMN_TYPE AS column_type, CHARACTER_SET_NAME AS character_set_name, COLLATION_NAME AS collation_name
         FROM information_schema.COLUMNS
        WHERE table_schema = DATABASE()
          AND table_name = 'tournament_registrations'
          AND column_name = 'tournament_id'
        LIMIT 1`
    )
    const [tournamentIdRows] = await db.execute(
      `SELECT COLUMN_TYPE AS column_type, CHARACTER_SET_NAME AS character_set_name, COLLATION_NAME AS collation_name
         FROM information_schema.COLUMNS
        WHERE table_schema = DATABASE()
          AND table_name = 'tournaments'
          AND column_name = 'id'
        LIMIT 1`
    )
    const registrationTournamentId = columnRows[0]
    const tournamentId = tournamentIdRows[0]
    const tournamentIdCompatible = Boolean(
      registrationTournamentId &&
        tournamentId &&
        String(registrationTournamentId.column_type).toLowerCase() === String(tournamentId.column_type).toLowerCase() &&
        String(registrationTournamentId.character_set_name || '').toLowerCase() === String(tournamentId.character_set_name || '').toLowerCase() &&
        String(registrationTournamentId.collation_name || '').toLowerCase() === String(tournamentId.collation_name || '').toLowerCase()
    )
    return (
      await tableExists(db, 'tournament_registrations') &&
      tournamentIdCompatible &&
      await columnExists(db, 'tournament_registrations', 'correlation_id') &&
      await columnExists(db, 'tournaments', 'portal_slug') &&
      await indexExists(db, 'tournament_registrations', 'uniq_tournament_registrations_user') &&
      await foreignKeyExists(db, 'tournament_registrations', 'fk_tournament_registrations_tournament')
    )
  },
  async getSql(db) {
    const quoteIdentifier = (value) => `\`${String(value).replaceAll('`', '``')}\``
    const [tournamentIdRows] = await db.execute(
      `SELECT COLUMN_TYPE AS column_type, CHARACTER_SET_NAME AS character_set_name, COLLATION_NAME AS collation_name
         FROM information_schema.COLUMNS
        WHERE table_schema = DATABASE()
          AND table_name = 'tournaments'
          AND column_name = 'id'
        LIMIT 1`
    )
    const tournamentId = tournamentIdRows[0]
    const tournamentColumnType = String(tournamentId?.column_type || '').trim()
    if (!tournamentColumnType) {
      throw new Error('Cannot build tournament_registrations migration: tournaments.id column type could not be detected')
    }
    const tournamentIdDefinition = [
      tournamentColumnType.toUpperCase(),
      tournamentId.character_set_name ? `CHARACTER SET ${quoteIdentifier(tournamentId.character_set_name)}` : '',
      tournamentId.collation_name ? `COLLATE ${quoteIdentifier(tournamentId.collation_name)}` : '',
      'NOT NULL',
    ]
      .filter(Boolean)
      .join(' ')

    const statements = []
    const hasRegistrationTable = await tableExists(db, 'tournament_registrations')
    if (!hasRegistrationTable) {
      statements.push(`CREATE TABLE tournament_registrations (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  tournament_id ${tournamentIdDefinition},
  auth_user_id VARCHAR(191) NOT NULL,
  email VARCHAR(191) NOT NULL,
  name VARCHAR(191) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'registered',
  correlation_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_tournament_registrations_user (tournament_id, auth_user_id),
  KEY idx_tournament_registrations_tournament (tournament_id),
  KEY idx_tournament_registrations_email (email),
  KEY idx_tournament_registrations_correlation (correlation_id),
  CONSTRAINT fk_tournament_registrations_tournament
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    } else {
      const hasRegistrationFk = await foreignKeyExists(db, 'tournament_registrations', 'fk_tournament_registrations_tournament')
      if (hasRegistrationFk) {
        statements.push('ALTER TABLE tournament_registrations DROP FOREIGN KEY fk_tournament_registrations_tournament')
      }
      if (!(await columnExists(db, 'tournament_registrations', 'correlation_id'))) {
        statements.push('ALTER TABLE tournament_registrations ADD COLUMN correlation_id VARCHAR(191) NULL AFTER status')
      }
      if (!(await columnExists(db, 'tournament_registrations', 'updated_at'))) {
        statements.push('ALTER TABLE tournament_registrations ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at')
      }
      statements.push(`ALTER TABLE tournament_registrations MODIFY COLUMN tournament_id ${tournamentIdDefinition}`)
      if (!(await indexExists(db, 'tournament_registrations', 'uniq_tournament_registrations_user'))) {
        statements.push('CREATE UNIQUE INDEX uniq_tournament_registrations_user ON tournament_registrations (tournament_id, auth_user_id)')
      }
      if (!(await indexExists(db, 'tournament_registrations', 'idx_tournament_registrations_tournament'))) {
        statements.push('CREATE INDEX idx_tournament_registrations_tournament ON tournament_registrations (tournament_id)')
      }
      if (!(await indexExists(db, 'tournament_registrations', 'idx_tournament_registrations_email'))) {
        statements.push('CREATE INDEX idx_tournament_registrations_email ON tournament_registrations (email)')
      }
      if (!(await indexExists(db, 'tournament_registrations', 'idx_tournament_registrations_correlation'))) {
        statements.push('CREATE INDEX idx_tournament_registrations_correlation ON tournament_registrations (correlation_id)')
      }
      statements.push(`ALTER TABLE tournament_registrations
  ADD CONSTRAINT fk_tournament_registrations_tournament
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
  ON DELETE CASCADE`)
    }

    if (!(await columnExists(db, 'tournaments', 'portal_slug'))) {
      statements.push('ALTER TABLE tournaments ADD COLUMN portal_slug VARCHAR(191) NULL')
    }
    if (!(await columnExists(db, 'tournaments', 'is_public'))) {
      statements.push('ALTER TABLE tournaments ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 0')
    }
    if (!(await columnExists(db, 'tournaments', 'status'))) {
      statements.push("ALTER TABLE tournaments ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'draft'")
    }
    if (!(await indexExists(db, 'tournaments', 'idx_tournaments_portal_slug'))) {
      statements.push('CREATE INDEX idx_tournaments_portal_slug ON tournaments (portal_slug)')
    }
    if (!(await indexExists(db, 'tournaments', 'idx_tournaments_status_public'))) {
      statements.push('CREATE INDEX idx_tournaments_status_public ON tournaments (status, is_public)')
    }

    return statements.join(';\n')
  },
},


  {
    version: '20260506_021',
    name: 'tournament_schema_stage_compat',
    filename: '20260506_021_tournament_schema_stage_compat.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'tournaments') &&
        await columnExists(db, 'tournaments', 'name') &&
        await columnExists(db, 'tournaments', 'description') &&
        await columnExists(db, 'tournaments', 'start_date') &&
        await columnExists(db, 'tournaments', 'end_date') &&
        await columnExists(db, 'tournaments', 'status') &&
        await columnExists(db, 'tournaments', 'is_public') &&
        await columnExists(db, 'tournaments', 'tournament_identifier') &&
        await columnExists(db, 'tournaments', 'portal_slug') &&
        await columnExists(db, 'tournaments', 'organizer_email') &&
        await columnExists(db, 'tournaments', 'host_account_id') &&
        await columnExists(db, 'tournaments', 'organizer_account_id') &&
        await tableExists(db, 'organizer_role_accounts') &&
        await columnExists(db, 'organizer_role_accounts', 'organization_name') &&
        await tableExists(db, 'host_role_accounts') &&
        await columnExists(db, 'host_role_accounts', 'golf_course_name') &&
        await tableExists(db, 'host_accounts') &&
        await columnExists(db, 'host_accounts', 'golf_course_name') &&
        await indexExists(db, 'tournaments', 'idx_tournaments_identifier') &&
        await indexExists(db, 'tournaments', 'idx_tournaments_host_account') &&
        await indexExists(db, 'tournaments', 'idx_tournaments_organizer_account')
      )
    },
    async getSql(db) {
      const statements = []
      const addColumn = async (tableName, columnName, sql) => {
        if (await tableExists(db, tableName)) {
          if (!(await columnExists(db, tableName, columnName))) statements.push(sql)
        }
      }
      const addIndex = async (tableName, indexName, sql) => {
        if (await tableExists(db, tableName)) {
          if (!(await indexExists(db, tableName, indexName))) statements.push(sql)
        }
      }

      if (!(await tableExists(db, 'tournaments'))) {
        statements.push(`CREATE TABLE tournaments (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  tournament_identifier VARCHAR(191) NULL,
  portal_slug VARCHAR(191) NULL,
  name VARCHAR(191) NOT NULL,
  title VARCHAR(191) NULL,
  description TEXT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  host_account_id VARCHAR(191) NULL,
  organizer_account_id VARCHAR(191) NULL,
  organizer_email VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tournaments_identifier (tournament_identifier),
  KEY idx_tournaments_portal_slug (portal_slug),
  KEY idx_tournaments_status_public (status, is_public),
  KEY idx_tournaments_host_account (host_account_id),
  KEY idx_tournaments_organizer_account (organizer_account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
      } else {
        await addColumn('tournaments', 'tournament_identifier', 'ALTER TABLE tournaments ADD COLUMN tournament_identifier VARCHAR(191) NULL')
        await addColumn('tournaments', 'portal_slug', 'ALTER TABLE tournaments ADD COLUMN portal_slug VARCHAR(191) NULL')
        await addColumn('tournaments', 'name', 'ALTER TABLE tournaments ADD COLUMN name VARCHAR(191) NULL')
        await addColumn('tournaments', 'title', 'ALTER TABLE tournaments ADD COLUMN title VARCHAR(191) NULL')
        await addColumn('tournaments', 'description', 'ALTER TABLE tournaments ADD COLUMN description TEXT NULL')
        await addColumn('tournaments', 'start_date', 'ALTER TABLE tournaments ADD COLUMN start_date DATE NULL')
        await addColumn('tournaments', 'end_date', 'ALTER TABLE tournaments ADD COLUMN end_date DATE NULL')
        await addColumn('tournaments', 'status', "ALTER TABLE tournaments ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'draft'")
        await addColumn('tournaments', 'is_public', 'ALTER TABLE tournaments ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 0')
        await addColumn('tournaments', 'host_account_id', 'ALTER TABLE tournaments ADD COLUMN host_account_id VARCHAR(191) NULL')
        await addColumn('tournaments', 'organizer_account_id', 'ALTER TABLE tournaments ADD COLUMN organizer_account_id VARCHAR(191) NULL')
        await addColumn('tournaments', 'organizer_email', 'ALTER TABLE tournaments ADD COLUMN organizer_email VARCHAR(191) NULL')
        await addColumn('tournaments', 'created_at', 'ALTER TABLE tournaments ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP')
        await addColumn('tournaments', 'updated_at', 'ALTER TABLE tournaments ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
        if ((await columnExists(db, 'tournaments', 'title')) && (await columnExists(db, 'tournaments', 'name'))) {
          statements.push("UPDATE tournaments SET name = COALESCE(NULLIF(name, ''), NULLIF(title, ''), CONCAT('Tournament ', id)) WHERE name IS NULL OR name = ''")
        }
        await addIndex('tournaments', 'idx_tournaments_identifier', 'CREATE INDEX idx_tournaments_identifier ON tournaments (tournament_identifier)')
        await addIndex('tournaments', 'idx_tournaments_portal_slug', 'CREATE INDEX idx_tournaments_portal_slug ON tournaments (portal_slug)')
        await addIndex('tournaments', 'idx_tournaments_status_public', 'CREATE INDEX idx_tournaments_status_public ON tournaments (status, is_public)')
        await addIndex('tournaments', 'idx_tournaments_host_account', 'CREATE INDEX idx_tournaments_host_account ON tournaments (host_account_id)')
        await addIndex('tournaments', 'idx_tournaments_organizer_account', 'CREATE INDEX idx_tournaments_organizer_account ON tournaments (organizer_account_id)')
      }

      await addColumn('organizer_role_accounts', 'organization_name', 'ALTER TABLE organizer_role_accounts ADD COLUMN organization_name VARCHAR(191) NULL')
      if (await tableExists(db, 'organizer_role_accounts')) {
        const hasOrgName = await columnExists(db, 'organizer_role_accounts', 'organizer_name')
        const hasContactName = await columnExists(db, 'organizer_role_accounts', 'contact_name')
        const hasEmail = await columnExists(db, 'organizer_role_accounts', 'email')
        const candidates = [hasOrgName ? 'NULLIF(organizer_name, \'\')' : null, hasContactName ? 'NULLIF(contact_name, \'\')' : null, hasEmail ? 'email' : null].filter(Boolean)
        if (candidates.length) {
          statements.push(`UPDATE organizer_role_accounts SET organization_name = COALESCE(NULLIF(organization_name, ''), ${candidates.join(', ')}) WHERE organization_name IS NULL OR organization_name = ''`)
        }
      }

      await addColumn('host_role_accounts', 'golf_course_name', 'ALTER TABLE host_role_accounts ADD COLUMN golf_course_name VARCHAR(191) NULL')
      if (await tableExists(db, 'host_role_accounts')) {
        const hasAccountName = await columnExists(db, 'host_role_accounts', 'account_name')
        const hasCourseName = await columnExists(db, 'host_role_accounts', 'course_name')
        const candidates = [hasAccountName ? 'NULLIF(account_name, \'\')' : null, hasCourseName ? 'NULLIF(course_name, \'\')' : null].filter(Boolean)
        if (candidates.length) {
          statements.push(`UPDATE host_role_accounts SET golf_course_name = COALESCE(NULLIF(golf_course_name, ''), ${candidates.join(', ')}) WHERE golf_course_name IS NULL OR golf_course_name = ''`)
        }
      }

      await addColumn('host_accounts', 'golf_course_name', 'ALTER TABLE host_accounts ADD COLUMN golf_course_name VARCHAR(191) NULL')
      if (await tableExists(db, 'host_accounts')) {
        const hasAccountName = await columnExists(db, 'host_accounts', 'account_name')
        const hasCourseName = await columnExists(db, 'host_accounts', 'course_name')
        const candidates = [hasAccountName ? 'NULLIF(account_name, \'\')' : null, hasCourseName ? 'NULLIF(course_name, \'\')' : null].filter(Boolean)
        if (candidates.length) {
          statements.push(`UPDATE host_accounts SET golf_course_name = COALESCE(NULLIF(golf_course_name, ''), ${candidates.join(', ')}) WHERE golf_course_name IS NULL OR golf_course_name = ''`)
        }
      }

      return statements.join(';\n')
    },
  },


  {
    version: '20260507_024',
    name: 'tournament_registration_teams',
    filename: '20260507_024_tournament_registration_teams.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'tournament_registrations') &&
        await columnExists(db, 'tournament_registrations', 'team_id') &&
        await columnExists(db, 'tournament_registrations', 'team_name') &&
        await columnExists(db, 'tournament_registrations', 'team_members_json') &&
        await indexExists(db, 'tournament_registrations', 'idx_tournament_registrations_team')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'tournament_registrations', 'team_id'))) statements.push('ALTER TABLE tournament_registrations ADD COLUMN team_id VARCHAR(191) NULL AFTER status')
      if (!(await columnExists(db, 'tournament_registrations', 'team_name'))) statements.push('ALTER TABLE tournament_registrations ADD COLUMN team_name VARCHAR(191) NULL AFTER team_id')
      if (!(await columnExists(db, 'tournament_registrations', 'team_members_json'))) statements.push('ALTER TABLE tournament_registrations ADD COLUMN team_members_json JSON NULL AFTER team_name')
      if (!(await indexExists(db, 'tournament_registrations', 'idx_tournament_registrations_team'))) statements.push('CREATE INDEX idx_tournament_registrations_team ON tournament_registrations (team_id)')
      return statements.join(';\n')
    },
  },


  {
    version: '20260507_025',
    name: 'tournament_page_templates',
    filename: '20260507_025_tournament_page_templates.sql',
    async isSatisfied(db) {
      return (
        await columnExists(db, 'tournaments', 'template_key') &&
        await columnExists(db, 'tournaments', 'template_background_image_url') &&
        await columnExists(db, 'tournaments', 'template_data') &&
        await indexExists(db, 'tournaments', 'idx_tournaments_template_key')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'tournaments', 'template_key'))) statements.push('ALTER TABLE tournaments ADD COLUMN template_key VARCHAR(64) NULL AFTER is_public')
      if (!(await columnExists(db, 'tournaments', 'template_background_image_url'))) statements.push('ALTER TABLE tournaments ADD COLUMN template_background_image_url LONGTEXT NULL AFTER template_key')
      if (!(await columnExists(db, 'tournaments', 'template_data'))) statements.push('ALTER TABLE tournaments ADD COLUMN template_data LONGTEXT NULL AFTER template_background_image_url')
      if (!(await indexExists(db, 'tournaments', 'idx_tournaments_template_key'))) statements.push('CREATE INDEX idx_tournaments_template_key ON tournaments (template_key)')
      return statements.join(';\n')
    },
  },


  {
    version: '20260507_026',
    name: 'tournament_flyer_template_fields',
    filename: '20260507_026_tournament_flyer_template_fields.sql',
    async isSatisfied(db) {
      return await columnExists(db, 'tournaments', 'template_data')
    },
    async getSql(db) {
      if (await columnExists(db, 'tournaments', 'template_data')) return ''
      return 'ALTER TABLE tournaments ADD COLUMN template_data LONGTEXT NULL AFTER template_background_image_url'
    },
  },


  {
    version: '20260507_027',
    name: 'golf_course_address_fields',
    filename: '20260507_027_golf_course_address_fields.sql',
    async isSatisfied(db) {
      if (!(await tableExists(db, 'golf_courses'))) return true
      return (
        await columnExists(db, 'golf_courses', 'address') &&
        await columnExists(db, 'golf_courses', 'postal_code')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await tableExists(db, 'golf_courses'))) return '-- golf_courses table does not exist; runtime table creation includes address fields'
      if (!(await columnExists(db, 'golf_courses', 'address'))) statements.push('ALTER TABLE golf_courses ADD COLUMN address VARCHAR(255) NULL AFTER city')
      if (!(await columnExists(db, 'golf_courses', 'postal_code'))) statements.push('ALTER TABLE golf_courses ADD COLUMN postal_code VARCHAR(32) NULL AFTER address')
      return statements.join(';\n') || '-- golf_courses address fields already exist'
    },
  },


  {
    version: '20260508_028',
    name: 'host_tournament_creation_schema_alignment',
    filename: '20260508_028_host_tournament_creation_schema_alignment.sql',
    async isSatisfied(db) {
      if (!(await tableExists(db, 'tournaments'))) return true
      return (
        await columnExists(db, 'tournaments', 'created_by_auth_user_id') &&
        await columnExists(db, 'tournaments', 'template_key') &&
        await columnExists(db, 'tournaments', 'template_background_image_url') &&
        await columnExists(db, 'tournaments', 'template_data') &&
        await columnExists(db, 'tournaments', 'tournament_identifier') &&
        await columnExists(db, 'tournaments', 'organizer_email') &&
        await indexExists(db, 'tournaments', 'idx_tournaments_identifier') &&
        await indexExists(db, 'tournaments', 'idx_tournaments_template_key')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await tableExists(db, 'tournaments'))) return '-- tournaments table does not exist; baseline migration creates it for fresh installs'
      if (!(await columnExists(db, 'tournaments', 'tournament_identifier'))) statements.push('ALTER TABLE tournaments ADD COLUMN tournament_identifier VARCHAR(191) NULL AFTER host_account_id')
      if (!(await columnExists(db, 'tournaments', 'organizer_email'))) statements.push('ALTER TABLE tournaments ADD COLUMN organizer_email VARCHAR(191) NULL AFTER tournament_identifier')
      if (!(await columnExists(db, 'tournaments', 'created_by_auth_user_id'))) statements.push('ALTER TABLE tournaments ADD COLUMN created_by_auth_user_id VARCHAR(191) NULL AFTER is_public')
      if (!(await columnExists(db, 'tournaments', 'template_key'))) statements.push('ALTER TABLE tournaments ADD COLUMN template_key VARCHAR(64) NULL AFTER is_public')
      if (!(await columnExists(db, 'tournaments', 'template_background_image_url'))) statements.push('ALTER TABLE tournaments ADD COLUMN template_background_image_url LONGTEXT NULL AFTER template_key')
      if (!(await columnExists(db, 'tournaments', 'template_data'))) statements.push('ALTER TABLE tournaments ADD COLUMN template_data LONGTEXT NULL AFTER template_background_image_url')
      if (!(await indexExists(db, 'tournaments', 'idx_tournaments_identifier'))) statements.push('CREATE INDEX idx_tournaments_identifier ON tournaments (tournament_identifier)')
      if (!(await indexExists(db, 'tournaments', 'idx_tournaments_template_key'))) statements.push('CREATE INDEX idx_tournaments_template_key ON tournaments (template_key)')
      return statements.join(';\n') || '-- host tournament creation schema is already aligned'
    },
  },


  {
    version: '20260508_029',
    name: 'organizer_invite_schema_alignment',
    filename: '20260508_029_organizer_invite_schema_alignment.sql',
    async isSatisfied(db) {
      if (!(await tableExists(db, 'organizer_role_accounts'))) return true
      return (
        await columnExists(db, 'organizer_role_accounts', 'role_assignment_id') &&
        await indexExists(db, 'organizer_role_accounts', 'idx_organizer_role_accounts_role_assignment')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await tableExists(db, 'organizer_role_accounts'))) return '-- organizer_role_accounts table does not exist; baseline migration creates it for fresh installs'
      if (!(await columnExists(db, 'organizer_role_accounts', 'role_assignment_id'))) statements.push('ALTER TABLE organizer_role_accounts ADD COLUMN role_assignment_id VARCHAR(64) NULL AFTER id')
      if (!(await indexExists(db, 'organizer_role_accounts', 'idx_organizer_role_accounts_role_assignment'))) statements.push('CREATE INDEX idx_organizer_role_accounts_role_assignment ON organizer_role_accounts (role_assignment_id)')
      return statements.join(';\n') || '-- organizer invite schema is already aligned'
    },
  },

  {
    version: '20260508_030',
    name: 'organizer_registration_schema_alignment',
    filename: '20260508_030_organizer_registration_schema_alignment.sql',
    async isSatisfied(db) {
      if (!(await tableExists(db, 'organizer_role_accounts'))) return true
      return (
        await columnExists(db, 'organizer_role_accounts', 'contact_name') &&
        await columnExists(db, 'organizer_role_accounts', 'phone') &&
        await columnExists(db, 'organizer_role_accounts', 'website_url') &&
        await columnExists(db, 'organizer_role_accounts', 'notes') &&
        await columnExists(db, 'organizer_role_accounts', 'password_hash') &&
        await columnExists(db, 'organizer_role_accounts', 'reset_email')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await tableExists(db, 'organizer_role_accounts'))) return '-- organizer_role_accounts table does not exist; baseline migration creates it for fresh installs'
      if (!(await columnExists(db, 'organizer_role_accounts', 'contact_name'))) statements.push('ALTER TABLE organizer_role_accounts ADD COLUMN contact_name VARCHAR(191) NULL')
      if (!(await columnExists(db, 'organizer_role_accounts', 'phone'))) statements.push('ALTER TABLE organizer_role_accounts ADD COLUMN phone VARCHAR(64) NULL')
      if (!(await columnExists(db, 'organizer_role_accounts', 'website_url'))) statements.push('ALTER TABLE organizer_role_accounts ADD COLUMN website_url VARCHAR(512) NULL')
      if (!(await columnExists(db, 'organizer_role_accounts', 'notes'))) statements.push('ALTER TABLE organizer_role_accounts ADD COLUMN notes TEXT NULL')
      if (!(await columnExists(db, 'organizer_role_accounts', 'password_hash'))) statements.push('ALTER TABLE organizer_role_accounts ADD COLUMN password_hash VARCHAR(255) NULL')
      if (!(await columnExists(db, 'organizer_role_accounts', 'reset_email'))) statements.push('ALTER TABLE organizer_role_accounts ADD COLUMN reset_email VARCHAR(191) NULL')
      return statements.join(';\n') || '-- organizer registration schema is already aligned'
    },
  },


  {
    version: '20260508_031',
    name: 'organizer_session_collation_alignment',
    filename: '20260508_031_organizer_session_collation_alignment.sql',
    async isSatisfied(_db) {
      // Organizer session/account joins are made collation-safe in code using
      // explicit COLLATE clauses. Avoid altering foreign-keyed key columns in
      // deployed databases because MySQL rejects incompatible FK column changes.
      return true
    },
    async getSql(_db) {
      return 'SELECT 1'
    },
  },

  {
    version: '20260508_032',
    name: 'remove_redundant_tournament_template_name',
    filename: '20260508_032_remove_redundant_tournament_template_name.sql',
    async isSatisfied(db) {
      if (!(await tableExists(db, 'tournaments'))) return true
      if (!(await columnExists(db, 'tournaments', 'template_data'))) return true
      const [[row = {}] = []] = await db.execute(`
        SELECT COUNT(*) AS remaining
          FROM tournaments
         WHERE template_data IS NOT NULL
           AND JSON_VALID(template_data)
           AND JSON_CONTAINS_PATH(template_data, 'one', '$.tournamentName')
      `)
      return Number(row.remaining || 0) === 0
    },
    async getSql() {
      return loadMigrationSql('20260508_032_remove_redundant_tournament_template_name.sql')
    },
  },

  {
    version: '20260513_033',
    name: 'tournament_team_slot_limit',
    filename: '20260513_033_tournament_team_slot_limit.sql',
    async isSatisfied(db) {
      if (!(await tableExists(db, 'tournaments'))) return true
      return await columnExists(db, 'tournaments', 'team_slot_limit')
    },
    async getSql(db) {
      if (!(await tableExists(db, 'tournaments'))) return '-- tournaments table does not exist; baseline migration creates it for fresh installs'
      if (await columnExists(db, 'tournaments', 'team_slot_limit')) return '-- tournament team slot limit already exists'
      return loadMigrationSql('20260513_033_tournament_team_slot_limit.sql')
    },
  },

  {
    version: '20260513_034',
    name: 'host_profile_fields',
    filename: '20260513_034_host_profile_fields.sql',
    async isSatisfied(db) {
      if (!(await tableExists(db, 'host_accounts'))) return true
      return (
        await columnExists(db, 'host_accounts', 'contact_name') &&
        await columnExists(db, 'host_accounts', 'phone') &&
        await columnExists(db, 'host_accounts', 'website_url') &&
        await columnExists(db, 'host_accounts', 'notes')
      )
    },
    async getSql(db) {
      if (!(await tableExists(db, 'host_accounts'))) return '-- host_accounts table does not exist; baseline migration creates it for fresh installs'
      const statements = []
      if (!(await columnExists(db, 'host_accounts', 'contact_name'))) statements.push('ALTER TABLE host_accounts ADD COLUMN contact_name VARCHAR(191) NULL')
      if (!(await columnExists(db, 'host_accounts', 'phone'))) statements.push('ALTER TABLE host_accounts ADD COLUMN phone VARCHAR(64) NULL')
      if (!(await columnExists(db, 'host_accounts', 'website_url'))) statements.push('ALTER TABLE host_accounts ADD COLUMN website_url VARCHAR(512) NULL')
      if (!(await columnExists(db, 'host_accounts', 'notes'))) statements.push('ALTER TABLE host_accounts ADD COLUMN notes TEXT NULL')
      return statements.join(';\n') || '-- host profile fields already exist'
    },
  },


  {
    version: '20260514_035',
    name: 'profile_notes_null_defaults',
    filename: '20260514_035_profile_notes_null_defaults.sql',
    async isSatisfied(db) {
      const profileNoteColumns = [
        ['host_accounts', 'notes'],
        ['organizer_role_accounts', 'notes'],
      ]
      for (const [tableName, columnName] of profileNoteColumns) {
        if (!(await tableExists(db, tableName))) continue
        if (!(await columnExists(db, tableName, columnName))) return false
        if (!(await columnIsNullable(db, tableName, columnName))) return false
        if ((await blankTextRowCount(db, tableName, columnName)) > 0) return false
      }
      return true
    },
    async getSql(db) {
      const statements = []
      if (await tableExists(db, 'host_accounts')) {
        if (!(await columnExists(db, 'host_accounts', 'notes'))) {
          statements.push('ALTER TABLE host_accounts ADD COLUMN notes TEXT NULL')
        } else {
          if (!(await columnIsNullable(db, 'host_accounts', 'notes'))) statements.push('ALTER TABLE host_accounts MODIFY COLUMN notes TEXT NULL')
          statements.push("UPDATE host_accounts SET notes = NULL WHERE notes IS NOT NULL AND TRIM(notes) = ''")
        }
      }
      if (await tableExists(db, 'organizer_role_accounts')) {
        if (!(await columnExists(db, 'organizer_role_accounts', 'notes'))) {
          statements.push('ALTER TABLE organizer_role_accounts ADD COLUMN notes TEXT NULL')
        } else {
          if (!(await columnIsNullable(db, 'organizer_role_accounts', 'notes'))) statements.push('ALTER TABLE organizer_role_accounts MODIFY COLUMN notes TEXT NULL')
          statements.push("UPDATE organizer_role_accounts SET notes = NULL WHERE notes IS NOT NULL AND TRIM(notes) = ''")
        }
      }
      return statements.join(';\n') || '-- profile notes already default to NULL'
    },
  },

  {
    version: '20260514_036',
    name: 'scheduled_jobs_admin',
    filename: '20260514_036_scheduled_jobs_admin.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'scheduled_jobs') &&
        await tableExists(db, 'scheduled_job_runs')
      )
    },
    async getSql() {
      return loadMigrationSql('20260514_036_scheduled_jobs_admin.sql')
    },
  },


  {
    version: '20260514_037',
    name: 'admin_portal_review_and_remove_host_invites',
    filename: '20260514_037_admin_portal_review_and_remove_host_invites.sql',
    async isSatisfied(db) {
      return !(await tableExists(db, 'host_account_invites'))
    },
    async getSql(db) {
      const statements = []
      if (await tableExists(db, 'host_account_invites')) statements.push('DROP TABLE IF EXISTS host_account_invites')
      if ((await tableExists(db, 'host_accounts')) && (await columnExists(db, 'host_accounts', 'invite_id'))) {
        statements.push('ALTER TABLE host_accounts MODIFY COLUMN invite_id VARCHAR(191) NULL')
      }
      return statements.join(';\n') || '-- host invite schema already removed'
    },
  },

  {
    version: '20260515_038',
    name: 'user_profile_phone_and_organizer_password_resets',
    filename: '20260515_038_user_profile_phone_and_organizer_password_resets.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'app_users') &&
        await columnExists(db, 'app_users', 'phone') &&
        await tableExists(db, 'organizer_password_reset_tokens') &&
        await columnExists(db, 'organizer_password_reset_tokens', 'organizer_account_id') &&
        await columnExists(db, 'organizer_password_reset_tokens', 'token_hash') &&
        await columnExists(db, 'organizer_password_reset_tokens', 'expires_at') &&
        await columnExists(db, 'organizer_password_reset_tokens', 'used_at') &&
        await indexExists(db, 'organizer_password_reset_tokens', 'idx_organizer_password_reset_token')
      )
    },
    async getSql(db) {
      const statements = []
      if (await tableExists(db, 'app_users')) {
        if (!(await columnExists(db, 'app_users', 'phone'))) statements.push('ALTER TABLE app_users ADD COLUMN phone VARCHAR(64) NULL AFTER name')
      } else {
        statements.push('-- app_users table does not exist; earlier app_user_profiles migration creates it for fresh installs')
      }
      if (!(await tableExists(db, 'organizer_password_reset_tokens'))) {
        statements.push(`CREATE TABLE IF NOT EXISTS organizer_password_reset_tokens (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  organizer_account_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_organizer_password_reset_account (organizer_account_id),
  INDEX idx_organizer_password_reset_token (token_hash),
  INDEX idx_organizer_password_reset_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
      } else {
        if (!(await columnExists(db, 'organizer_password_reset_tokens', 'organizer_account_id'))) statements.push('ALTER TABLE organizer_password_reset_tokens ADD COLUMN organizer_account_id VARCHAR(64) NOT NULL AFTER id')
        if (!(await columnExists(db, 'organizer_password_reset_tokens', 'token_hash'))) statements.push('ALTER TABLE organizer_password_reset_tokens ADD COLUMN token_hash VARCHAR(255) NOT NULL AFTER organizer_account_id')
        if (!(await columnExists(db, 'organizer_password_reset_tokens', 'expires_at'))) statements.push('ALTER TABLE organizer_password_reset_tokens ADD COLUMN expires_at DATETIME NOT NULL AFTER token_hash')
        if (!(await columnExists(db, 'organizer_password_reset_tokens', 'used_at'))) statements.push('ALTER TABLE organizer_password_reset_tokens ADD COLUMN used_at DATETIME NULL AFTER expires_at')
        if (!(await columnExists(db, 'organizer_password_reset_tokens', 'created_at'))) statements.push('ALTER TABLE organizer_password_reset_tokens ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER used_at')
        if (!(await columnExists(db, 'organizer_password_reset_tokens', 'updated_at'))) statements.push('ALTER TABLE organizer_password_reset_tokens ADD COLUMN updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP AFTER created_at')
        if (!(await indexExists(db, 'organizer_password_reset_tokens', 'idx_organizer_password_reset_account'))) statements.push('CREATE INDEX idx_organizer_password_reset_account ON organizer_password_reset_tokens (organizer_account_id)')
        if (!(await indexExists(db, 'organizer_password_reset_tokens', 'idx_organizer_password_reset_token'))) statements.push('CREATE INDEX idx_organizer_password_reset_token ON organizer_password_reset_tokens (token_hash)')
        if (!(await indexExists(db, 'organizer_password_reset_tokens', 'idx_organizer_password_reset_expires'))) statements.push('CREATE INDEX idx_organizer_password_reset_expires ON organizer_password_reset_tokens (expires_at)')
      }
      return statements.join(';\n') || '-- user profile phone and organizer password reset schema already exists'
    },
  },


  {
    version: '20260516_039',
    name: 'golf_course_hole_scorecards',
    filename: '20260516_039_golf_course_hole_scorecards.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'golf_course_hole_scorecards') &&
        await columnExists(db, 'golf_course_hole_scorecards', 'hole_number') &&
        await columnExists(db, 'golf_course_hole_scorecards', 'par') &&
        await columnExists(db, 'golf_course_hole_scorecards', 'yards') &&
        await indexExists(db, 'golf_course_hole_scorecards', 'ux_golf_course_hole_scorecards_course_hole') &&
        await indexExists(db, 'golf_course_hole_scorecards', 'idx_golf_course_hole_scorecards_state_course')
      )
    },
    async getSql() {
      return loadMigrationSql('20260516_039_golf_course_hole_scorecards.sql')
    },
  },
  {
    version: '20260516_040',
    name: 'golf_course_hole_scorecards_stroke_index',
    filename: '20260516_040_golf_course_hole_scorecards_stroke_index.sql',
    async isSatisfied(db) {
      return (
        !(await tableExists(db, 'golf_course_hole_scorecards')) ||
        await columnExists(db, 'golf_course_hole_scorecards', 'stroke_index')
      )
    },
    async getSql() {
      return loadMigrationSql('20260516_040_golf_course_hole_scorecards_stroke_index.sql')
    },
  },
  {
    version: '20260516_041',
    name: 'scorecard_hole_drafts',
    filename: '20260516_041_scorecard_hole_drafts.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'scorecard_hole_drafts') &&
        await columnExists(db, 'scorecard_hole_drafts', 'created_by_user_id') &&
        await columnExists(db, 'scorecard_hole_drafts', 'hole_number') &&
        await columnExists(db, 'scorecard_hole_drafts', 'score') &&
        await columnExists(db, 'scorecard_hole_drafts', 'score_provided') &&
        await indexExists(db, 'scorecard_hole_drafts', 'idx_scorecard_hole_drafts_context_lookup')
      )
    },
    async getSql() {
      return loadMigrationSql('20260516_041_scorecard_hole_drafts.sql')
    },
  },

  {
    version: '20260516_042',
    name: 'team_scorecard_sides_and_opponent_holes',
    filename: '20260516_042_team_scorecard_sides_and_opponent_holes.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'scorecard_hole_drafts') &&
        await columnExists(db, 'scorecard_hole_drafts', 'scoring_side') &&
        await columnExists(db, 'scores', 'opponent_holes_json') &&
        await indexExists(db, 'scorecard_hole_drafts', 'idx_scorecard_hole_drafts_context_lookup')
      )
    },
    async getSql(db) {
      const statements = []
      if ((await tableExists(db, 'scorecard_hole_drafts')) && !(await columnExists(db, 'scorecard_hole_drafts', 'scoring_side'))) {
        statements.push("ALTER TABLE scorecard_hole_drafts ADD COLUMN scoring_side VARCHAR(16) NOT NULL DEFAULT 'team' AFTER mode")
      }
      if (await tableExists(db, 'scorecard_hole_drafts')) {
        if (await indexExists(db, 'scorecard_hole_drafts', 'idx_scorecard_hole_drafts_context_lookup')) {
          statements.push('ALTER TABLE scorecard_hole_drafts DROP INDEX idx_scorecard_hole_drafts_context_lookup')
        }
        statements.push('CREATE INDEX idx_scorecard_hole_drafts_context_lookup ON scorecard_hole_drafts (created_by_user_id, mode, scoring_side, date, state, course(160), team_key(160), opponent_team_key(160))')
      }
      if ((await tableExists(db, 'scores')) && !(await columnExists(db, 'scores', 'opponent_holes_json'))) {
        statements.push('ALTER TABLE scores ADD COLUMN opponent_holes_json JSON NULL AFTER holes_json')
      }
      return statements.join(';\n') || '-- team scorecard side and opponent holes schema already exists'
    },
  },


  {
    version: '20260518_043',
    name: 'golf_user_inbox_messages',
    filename: '20260518_043_golf_user_inbox_messages.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'inbox_messages') &&
        await columnExists(db, 'inbox_messages', 'message_type') &&
        await columnExists(db, 'inbox_messages', 'recipient_user_id') &&
        await columnExists(db, 'inbox_messages', 'recipient_email') &&
        await columnExists(db, 'inbox_messages', 'message_body') &&
        await columnExists(db, 'inbox_messages', 'read_at') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_recipient_user_read') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_recipient_email_read')
      )
    },
    async getSql() {
      return loadMigrationSql('20260518_043_golf_user_inbox_messages.sql')
    },
  },


  {
    version: '20260518_044',
    name: 'golf_user_inbox_threads_and_sent_sections',
    filename: '20260518_044_golf_user_inbox_threads_and_sent_sections.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'inbox_messages') &&
        await columnExists(db, 'inbox_messages', 'thread_id') &&
        await columnExists(db, 'inbox_messages', 'parent_message_id') &&
        !(await columnIsNullable(db, 'inbox_messages', 'thread_id')) &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_thread_created') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_parent') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_sender_type_created')
      )
    },
    async getSql(db) {
      const statements = []
      const hasThreadId = await columnExists(db, 'inbox_messages', 'thread_id')
      const hasParentMessageId = await columnExists(db, 'inbox_messages', 'parent_message_id')

      if (!hasThreadId) statements.push('ALTER TABLE inbox_messages ADD COLUMN thread_id VARCHAR(191) NULL AFTER id')
      if (!hasParentMessageId) statements.push('ALTER TABLE inbox_messages ADD COLUMN parent_message_id VARCHAR(191) NULL AFTER thread_id')
      statements.push("UPDATE inbox_messages SET thread_id = id WHERE thread_id IS NULL OR thread_id = ''")
      if (!hasThreadId || await columnIsNullable(db, 'inbox_messages', 'thread_id')) statements.push('ALTER TABLE inbox_messages MODIFY thread_id VARCHAR(191) NOT NULL')
      if (!(await indexExists(db, 'inbox_messages', 'idx_inbox_messages_thread_created'))) statements.push('CREATE INDEX idx_inbox_messages_thread_created ON inbox_messages(thread_id, created_at)')
      if (!(await indexExists(db, 'inbox_messages', 'idx_inbox_messages_parent'))) statements.push('CREATE INDEX idx_inbox_messages_parent ON inbox_messages(parent_message_id)')
      if (!(await indexExists(db, 'inbox_messages', 'idx_inbox_messages_sender_type_created'))) statements.push('CREATE INDEX idx_inbox_messages_sender_type_created ON inbox_messages(sender_user_id, message_type, created_at)')
      return statements.join(';\n')
    },
  },


  {
    version: '20260518_045',
    name: 'team_challenge_inbox_visibility',
    filename: '20260518_045_team_challenge_inbox_visibility.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'inbox_messages') &&
        await columnExists(db, 'inbox_messages', 'proposer_team_id') &&
        await columnExists(db, 'inbox_messages', 'proposer_team_name') &&
        await columnExists(db, 'inbox_messages', 'challenged_team_id') &&
        await columnExists(db, 'inbox_messages', 'challenged_team_name') &&
        await columnExists(db, 'inbox_messages', 'challenge_status') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_proposer_team_created') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_challenged_team_read') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_challenge_status')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'inbox_messages', 'proposer_team_id'))) statements.push('ALTER TABLE inbox_messages ADD COLUMN proposer_team_id VARCHAR(191) NULL AFTER parent_message_id')
      if (!(await columnExists(db, 'inbox_messages', 'proposer_team_name'))) statements.push('ALTER TABLE inbox_messages ADD COLUMN proposer_team_name VARCHAR(255) NULL AFTER proposer_team_id')
      if (!(await columnExists(db, 'inbox_messages', 'challenged_team_id'))) statements.push('ALTER TABLE inbox_messages ADD COLUMN challenged_team_id VARCHAR(191) NULL AFTER proposer_team_name')
      if (!(await columnExists(db, 'inbox_messages', 'challenged_team_name'))) statements.push('ALTER TABLE inbox_messages ADD COLUMN challenged_team_name VARCHAR(255) NULL AFTER challenged_team_id')
      if (!(await columnExists(db, 'inbox_messages', 'challenge_status'))) statements.push('ALTER TABLE inbox_messages ADD COLUMN challenge_status VARCHAR(32) NULL AFTER challenged_team_name')
      if (!(await indexExists(db, 'inbox_messages', 'idx_inbox_messages_proposer_team_created'))) statements.push('CREATE INDEX idx_inbox_messages_proposer_team_created ON inbox_messages(proposer_team_id, created_at)')
      if (!(await indexExists(db, 'inbox_messages', 'idx_inbox_messages_challenged_team_read'))) statements.push('CREATE INDEX idx_inbox_messages_challenged_team_read ON inbox_messages(challenged_team_id, read_at, created_at)')
      if (!(await indexExists(db, 'inbox_messages', 'idx_inbox_messages_challenge_status'))) statements.push('CREATE INDEX idx_inbox_messages_challenge_status ON inbox_messages(message_type, challenge_status, created_at)')
      return statements.join(';\n') || '-- team challenge inbox visibility schema already exists'
    },
  },


  {
    version: '20260518_046',
    name: 'team_challenge_scores',
    filename: '20260518_046_team_challenge_scores.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'inbox_messages') &&
        await columnExists(db, 'inbox_messages', 'proposer_team_score') &&
        await columnExists(db, 'inbox_messages', 'challenged_team_score') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_team_challenge_scores')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'inbox_messages', 'proposer_team_score'))) statements.push('ALTER TABLE inbox_messages ADD COLUMN proposer_team_score INT NULL AFTER challenge_status')
      if (!(await columnExists(db, 'inbox_messages', 'challenged_team_score'))) statements.push('ALTER TABLE inbox_messages ADD COLUMN challenged_team_score INT NULL AFTER proposer_team_score')
      if (!(await indexExists(db, 'inbox_messages', 'idx_inbox_messages_team_challenge_scores'))) statements.push('CREATE INDEX idx_inbox_messages_team_challenge_scores ON inbox_messages(message_type, proposer_team_id, challenged_team_id, challenge_status)')
      return statements.join(';\n') || '-- team challenge score schema already exists'
    },
  },

  {
    version: '20260518_047',
    name: 'team_challenge_hole_scorecards',
    filename: '20260518_047_team_challenge_hole_scorecards.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'inbox_messages') &&
        await columnExists(db, 'inbox_messages', 'proposer_team_holes_json') &&
        await columnExists(db, 'inbox_messages', 'challenged_team_holes_json') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_team_challenge_hole_scorecards')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'inbox_messages', 'proposer_team_holes_json'))) statements.push('ALTER TABLE inbox_messages ADD COLUMN proposer_team_holes_json JSON NULL AFTER proposer_team_score')
      if (!(await columnExists(db, 'inbox_messages', 'challenged_team_holes_json'))) statements.push('ALTER TABLE inbox_messages ADD COLUMN challenged_team_holes_json JSON NULL AFTER challenged_team_score')
      if (!(await indexExists(db, 'inbox_messages', 'idx_inbox_messages_team_challenge_hole_scorecards'))) statements.push('CREATE INDEX idx_inbox_messages_team_challenge_hole_scorecards ON inbox_messages(message_type, thread_id, proposer_team_id, challenged_team_id)')
      return statements.join(';\n') || '-- team challenge hole scorecard schema already exists'
    },
  },


  {
    version: '20260518_048',
    name: 'team_challenge_course_context',
    filename: '20260518_048_team_challenge_course_context.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'inbox_messages') &&
        await columnExists(db, 'inbox_messages', 'challenge_date') &&
        await columnExists(db, 'inbox_messages', 'challenge_state') &&
        await columnExists(db, 'inbox_messages', 'challenge_course') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_team_challenge_course_context')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'inbox_messages', 'challenge_date'))) statements.push('ALTER TABLE inbox_messages ADD COLUMN challenge_date DATE NULL AFTER challenge_status')
      if (!(await columnExists(db, 'inbox_messages', 'challenge_state'))) statements.push('ALTER TABLE inbox_messages ADD COLUMN challenge_state VARCHAR(64) NULL AFTER challenge_date')
      if (!(await columnExists(db, 'inbox_messages', 'challenge_course'))) statements.push('ALTER TABLE inbox_messages ADD COLUMN challenge_course VARCHAR(255) NULL AFTER challenge_state')
      if (!(await indexExists(db, 'inbox_messages', 'idx_inbox_messages_team_challenge_course_context'))) statements.push('CREATE INDEX idx_inbox_messages_team_challenge_course_context ON inbox_messages(message_type, challenge_date, challenge_state, challenge_course)')
      return statements.join(';\n') || '-- team challenge course context schema already exists'
    },
  },


  {
    version: '20260518_049',
    name: 'individual_challenge_inbox_scores',
    filename: '20260518_049_individual_challenge_inbox_scores.sql',
    async isSatisfied(db) {
      if (!(await tableExists(db, 'inbox_messages'))) return false
      const [[typeRow = {}] = []] = await db.execute(`
        SELECT COLUMN_TYPE AS columnType
          FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'inbox_messages'
           AND COLUMN_NAME = 'message_type'
         LIMIT 1
      `)
      return (
        String(typeRow.columnType || '').includes('individual_challenge') &&
        await columnExists(db, 'inbox_messages', 'individual_participants_json') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_individual_challenge_participants')
      )
    },
    async getSql(db) {
      const statements = []
      const [[typeRow = {}] = []] = await db.execute(`
        SELECT COLUMN_TYPE AS columnType
          FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'inbox_messages'
           AND COLUMN_NAME = 'message_type'
         LIMIT 1
      `)
      if (!String(typeRow.columnType || '').includes('individual_challenge')) statements.push("ALTER TABLE inbox_messages MODIFY message_type ENUM('message','challenge_request','individual_challenge') NOT NULL DEFAULT 'message'")
      if (!(await columnExists(db, 'inbox_messages', 'individual_participants_json'))) statements.push('ALTER TABLE inbox_messages ADD COLUMN individual_participants_json JSON NULL AFTER challenged_team_holes_json')
      if (!(await indexExists(db, 'inbox_messages', 'idx_inbox_messages_individual_challenge_participants'))) statements.push('CREATE INDEX idx_inbox_messages_individual_challenge_participants ON inbox_messages(message_type, thread_id, created_at)')
      return statements.join(';\n') || '-- individual challenge inbox score schema already exists'
    },
  },


  {
    version: '20260521_050',
    name: 'remove_local_golf_course_datasource',
    filename: '20260521_050_remove_local_golf_course_datasource.sql',
    async isSatisfied(db) {
      return (
        !(await tableExists(db, 'golf_courses')) &&
        !(await tableExists(db, 'golf_course_holes')) &&
        !(await tableExists(db, 'golf_course_hole_scorecards'))
      )
    },
    async getSql() {
      return loadMigrationSql('20260521_050_remove_local_golf_course_datasource.sql')
    },
  },


  {
    version: '20260521_051',
    name: 'round_and_challenge_tee_color',
    filename: '20260521_051_round_and_challenge_tee_color.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'scores') &&
        await columnExists(db, 'scores', 'tee_color') &&
        await tableExists(db, 'inbox_messages') &&
        await columnExists(db, 'inbox_messages', 'challenge_tee_color')
      )
    },
    async getSql(db) {
      const statements = []
      if (await tableExists(db, 'scores') && !(await columnExists(db, 'scores', 'tee_color'))) statements.push("ALTER TABLE scores ADD COLUMN tee_color VARCHAR(16) NOT NULL DEFAULT 'white' AFTER round_score")
      if (await tableExists(db, 'inbox_messages') && !(await columnExists(db, 'inbox_messages', 'challenge_tee_color'))) statements.push("ALTER TABLE inbox_messages ADD COLUMN challenge_tee_color VARCHAR(16) NOT NULL DEFAULT 'white' AFTER challenge_course")
      return statements.join(';\n') || '-- round and challenge tee-color schema already exists'
    },
  },

  {
    version: '20260521_052',
    name: 'external_api_call_metrics',
    filename: '20260521_052_external_api_call_metrics.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'external_api_call_metrics') &&
        await indexExists(db, 'external_api_call_metrics', 'idx_external_api_call_metrics_api_date') &&
        await indexExists(db, 'external_api_call_metrics', 'idx_external_api_call_metrics_api_endpoint_date')
      )
    },
    async getSql() {
      return loadMigrationSql('20260521_052_external_api_call_metrics.sql')
    },
  },

  {
    version: '20260522_053',
    name: 'profile_location_enrichment_requirement',
    filename: '20260522_053_profile_location_enrichment_requirement.sql',
    async isSatisfied(db) {
      if (!(await tableExists(db, 'app_users'))) return true
      const [[row = {}] = []] = await db.execute(`
        SELECT COUNT(*) AS pending
          FROM app_users
         WHERE profile_enriched_at IS NOT NULL
           AND (
             phone IS NULL OR TRIM(phone) = '' OR
             primary_city IS NULL OR TRIM(primary_city) = '' OR
             primary_state IS NULL OR TRIM(primary_state) = '' OR
             primary_zip_code IS NULL OR TRIM(primary_zip_code) = ''
           )
      `)
      return Number(row.pending || 0) === 0
    },
    async getSql() {
      return loadMigrationSql('20260522_053_profile_location_enrichment_requirement.sql')
    },
  },



  {
    version: '20260527_054',
    name: 'team_name_unique_index',
    filename: '20260527_054_team_name_unique_index.sql',
    async isSatisfied(db) {
      return await tableExists(db, 'teams') && await uniqueTeamNameIndexExists(db)
    },
    async getSql() {
      return loadMigrationSql('20260527_054_team_name_unique_index.sql')
    },
  },

  {
    version: '20260527_055',
    name: 'team_member_invite_status',
    filename: '20260527_055_team_member_invite_status.sql',
    async isSatisfied(db) {
      return await tableExists(db, 'team_members') &&
        await columnExists(db, 'team_members', 'status') &&
        await columnExists(db, 'team_members', 'verified')
    },
    async getSql(db) {
      const statements = []
      if (await tableExists(db, 'team_members') && !(await columnExists(db, 'team_members', 'status'))) {
        statements.push("ALTER TABLE team_members ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'invited' AFTER email")
      }
      if (await tableExists(db, 'team_members') && !(await columnExists(db, 'team_members', 'verified'))) {
        statements.push("ALTER TABLE team_members ADD COLUMN verified TINYINT(1) NOT NULL DEFAULT 0 AFTER status")
      }
      statements.push(`UPDATE team_members tm
LEFT JOIN \`user\` u ON LOWER(u.email) = LOWER(tm.email)
   SET tm.status = CASE
         WHEN COALESCE(u.emailVerified, 0) <> 0 THEN 'active'
         WHEN u.id IS NOT NULL THEN 'pending_verification'
         ELSE COALESCE(NULLIF(tm.status, ''), 'invited')
       END,
       tm.verified = CASE WHEN COALESCE(u.emailVerified, 0) <> 0 THEN 1 ELSE COALESCE(tm.verified, 0) END`)
      return statements.join(';\n')
    },
  },

  {
    version: '20260622_056',
    name: 'app_feature_flags',
    filename: '20260622_056_app_feature_flags.sql',
    async isSatisfied(db) {
      if (!(await tableExists(db, 'app_feature_flags'))) return false
      if (!(await indexExists(db, 'app_feature_flags', 'idx_app_feature_flags_enabled'))) return false
      const [[row = {}] = []] = await db.execute(
        `SELECT COUNT(*) AS flagCount
           FROM app_feature_flags
          WHERE flag_key = 'profileSocialPreferences'`,
      )
      return Number(row.flagCount || 0) > 0
    },
    async getSql() {
      return loadMigrationSql('20260622_056_app_feature_flags.sql')
    },
  },


  {
    version: '20260624_057',
    name: 'team_challenge_skins_points',
    filename: '20260624_057_team_challenge_skins_points.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'inbox_messages') &&
        await columnExists(db, 'inbox_messages', 'challenge_scoring_type') &&
        await columnExists(db, 'inbox_messages', 'challenge_points_per_hole') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_team_challenge_scoring')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'inbox_messages', 'challenge_scoring_type'))) statements.push("ALTER TABLE inbox_messages ADD COLUMN challenge_scoring_type VARCHAR(32) NOT NULL DEFAULT 'stroke_play' AFTER challenge_tee_color")
      if (!(await columnExists(db, 'inbox_messages', 'challenge_points_per_hole'))) statements.push('ALTER TABLE inbox_messages ADD COLUMN challenge_points_per_hole DECIMAL(10,2) NULL AFTER challenge_scoring_type')
      statements.push("UPDATE inbox_messages SET challenge_scoring_type = 'stroke_play' WHERE challenge_scoring_type IS NULL OR TRIM(challenge_scoring_type) = ''")
      if (!(await indexExists(db, 'inbox_messages', 'idx_inbox_messages_team_challenge_scoring'))) statements.push('CREATE INDEX idx_inbox_messages_team_challenge_scoring ON inbox_messages(message_type, challenge_scoring_type, challenge_status, created_at)')
      return statements.join(';\n') || '-- team challenge skins points schema already exists'
    },
  },


  {
    version: '20260630_058',
    name: 'golfcourseapi_datasource_cleanup',
    filename: '20260630_058_golfcourseapi_datasource_cleanup.sql',
    async isSatisfied(db) {
      return !(await tableExists(db, 'golf_course_hole_scorecards')) &&
        !(await tableExists(db, 'golf_course_holes')) &&
        !(await tableExists(db, 'golf_courses'))
    },
    async getSql() {
      return loadMigrationSql('20260630_058_golfcourseapi_datasource_cleanup.sql')
    },
  },


  {
    version: '20260630_059',
    name: 'opengolfapi_database_catalog',
    filename: '20260630_059_opengolfapi_database_catalog.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'golf_courses') &&
        await tableExists(db, 'golf_course_holes') &&
        await columnExists(db, 'golf_courses', 'external_course_id') &&
        await columnExists(db, 'golf_courses', 'state_code') &&
        await columnExists(db, 'golf_courses', 'county') &&
        await columnExists(db, 'golf_courses', 'total_yardage') &&
        await columnExists(db, 'golf_courses', 'raw_detail_payload') &&
        await columnExists(db, 'golf_course_holes', 'tee_name') &&
        await columnExists(db, 'golf_course_holes', 'yards') &&
        await columnExists(db, 'golf_course_holes', 'stroke_index') &&
        await indexExists(db, 'golf_courses', 'idx_golf_courses_active_state') &&
        await indexExists(db, 'golf_course_holes', 'idx_golf_course_holes_course_hole')
      )
    },
    async getSql() {
      return loadMigrationSql('20260630_059_opengolfapi_database_catalog.sql')
    },
  },

  {
    version: '20260702_060',
    name: 'opengolfapi_hole_endpoint_geometry',
    filename: '20260702_060_opengolfapi_hole_endpoint_geometry.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'golf_course_holes') &&
        await columnExists(db, 'golf_course_holes', 'tee_latitude') &&
        await columnExists(db, 'golf_course_holes', 'tee_longitude') &&
        await indexExists(db, 'golf_course_holes', 'idx_golf_course_holes_tee_coordinates')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'golf_course_holes', 'tee_latitude'))) {
        statements.push('ALTER TABLE golf_course_holes ADD COLUMN tee_latitude DECIMAL(10,7) NULL AFTER stroke_index')
      }
      if (!(await columnExists(db, 'golf_course_holes', 'tee_longitude'))) {
        statements.push('ALTER TABLE golf_course_holes ADD COLUMN tee_longitude DECIMAL(10,7) NULL AFTER tee_latitude')
      }
      if (!(await indexExists(db, 'golf_course_holes', 'idx_golf_course_holes_tee_coordinates'))) {
        statements.push('CREATE INDEX idx_golf_course_holes_tee_coordinates ON golf_course_holes (tee_latitude, tee_longitude)')
      }
      return statements.join(';\n')
    },
  },


  {
    version: '20260723_061',
    name: 'inbox_challenge_user_state',
    filename: '20260723_061_inbox_challenge_user_state.sql',
    async isSatisfied(db) {
      return await tableExists(db, 'inbox_challenge_user_state') &&
        await columnExists(db, 'inbox_challenge_user_state', 'deleted_at') &&
        await indexExists(db, 'inbox_challenge_user_state', 'idx_inbox_challenge_user_state_deleted')
    },
    async getSql() {
      return loadMigrationSql('20260723_061_inbox_challenge_user_state.sql')
    },
  },

  {
    version: '20260723_062',
    name: 'team_identifiers',
    filename: '20260723_062_team_identifiers.sql',
    async isSatisfied(db) {
      return await columnExists(db, 'teams', 'team_identifier') &&
        await indexExists(db, 'teams', 'idx_teams_team_identifier') &&
        !(await columnIsNullable(db, 'teams', 'team_identifier')) &&
        await columnIsAutoIncrement(db, 'teams', 'team_identifier')
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'teams', 'team_identifier'))) {
        statements.push('ALTER TABLE teams ADD COLUMN team_identifier BIGINT UNSIGNED NULL AFTER name')
      }
      statements.push(`SET @next_team_identifier := GREATEST(
  99,
  COALESCE((SELECT MAX(team_identifier) FROM teams), 99)
)`)
      statements.push(`UPDATE teams
   SET team_identifier = (@next_team_identifier := @next_team_identifier + 1)
 WHERE team_identifier IS NULL
 ORDER BY created_at ASC, id ASC`)
      if (await columnIsNullable(db, 'teams', 'team_identifier')) {
        statements.push('ALTER TABLE teams MODIFY COLUMN team_identifier BIGINT UNSIGNED NOT NULL')
      }
      if (!(await indexExists(db, 'teams', 'idx_teams_team_identifier'))) {
        statements.push('CREATE UNIQUE INDEX idx_teams_team_identifier ON teams (team_identifier)')
      }
      if (!(await columnIsAutoIncrement(db, 'teams', 'team_identifier'))) {
        statements.push('ALTER TABLE teams MODIFY COLUMN team_identifier BIGINT UNSIGNED NOT NULL AUTO_INCREMENT')
      }
      statements.push('ALTER TABLE teams AUTO_INCREMENT = 100')
      return statements.join(';\n')
    },
  },


  {
    version: '20260728_063',
    name: 'tournament_team_scores',
    filename: '20260728_063_tournament_team_scores.sql',
    async isSatisfied(db) {
      const [scoreTournamentIdRows] = await db.execute(
        `SELECT COLUMN_TYPE AS column_type, CHARACTER_SET_NAME AS character_set_name, COLLATION_NAME AS collation_name
           FROM information_schema.COLUMNS
          WHERE table_schema = DATABASE()
            AND table_name = 'tournament_team_scores'
            AND column_name = 'tournament_id'
          LIMIT 1`
      )
      const [tournamentIdRows] = await db.execute(
        `SELECT COLUMN_TYPE AS column_type, CHARACTER_SET_NAME AS character_set_name, COLLATION_NAME AS collation_name
           FROM information_schema.COLUMNS
          WHERE table_schema = DATABASE()
            AND table_name = 'tournaments'
            AND column_name = 'id'
          LIMIT 1`
      )
      const scoreTournamentId = scoreTournamentIdRows[0]
      const tournamentId = tournamentIdRows[0]
      const tournamentIdCompatible = Boolean(
        scoreTournamentId &&
          tournamentId &&
          String(scoreTournamentId.column_type).toLowerCase() === String(tournamentId.column_type).toLowerCase() &&
          String(scoreTournamentId.character_set_name || '').toLowerCase() === String(tournamentId.character_set_name || '').toLowerCase() &&
          String(scoreTournamentId.collation_name || '').toLowerCase() === String(tournamentId.collation_name || '').toLowerCase()
      )
      return (
        await tableExists(db, 'tournament_team_scores') &&
        tournamentIdCompatible &&
        await columnExists(db, 'tournament_team_scores', 'team_key') &&
        await columnExists(db, 'tournament_team_scores', 'holes_json') &&
        await columnExists(db, 'tournament_team_scores', 'tee_color') &&
        await columnExists(db, 'tournament_team_scores', 'correlation_id') &&
        await indexExists(db, 'tournament_team_scores', 'uniq_tournament_team_scores_team') &&
        await indexExists(db, 'tournament_team_scores', 'idx_tournament_team_scores_updated') &&
        await foreignKeyExists(db, 'tournament_team_scores', 'fk_tournament_team_scores_tournament')
      )
    },
    async getSql(db) {
      const quoteIdentifier = (value) => `\`${String(value).replaceAll('`', '``')}\``
      const [tournamentIdRows] = await db.execute(
        `SELECT COLUMN_TYPE AS column_type, CHARACTER_SET_NAME AS character_set_name, COLLATION_NAME AS collation_name
           FROM information_schema.COLUMNS
          WHERE table_schema = DATABASE()
            AND table_name = 'tournaments'
            AND column_name = 'id'
          LIMIT 1`
      )
      const tournamentId = tournamentIdRows[0]
      const tournamentColumnType = String(tournamentId?.column_type || '').trim()
      if (!tournamentColumnType) {
        throw new Error('Cannot build tournament_team_scores migration: tournaments.id column type could not be detected')
      }
      const tournamentIdDefinition = [
        tournamentColumnType.toUpperCase(),
        tournamentId.character_set_name ? `CHARACTER SET ${quoteIdentifier(tournamentId.character_set_name)}` : '',
        tournamentId.collation_name ? `COLLATE ${quoteIdentifier(tournamentId.collation_name)}` : '',
        'NOT NULL',
      ].filter(Boolean).join(' ')

      const statements = []
      const hasScoreTable = await tableExists(db, 'tournament_team_scores')
      if (!hasScoreTable) {
        statements.push(`CREATE TABLE tournament_team_scores (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  tournament_id ${tournamentIdDefinition},
  team_key VARCHAR(255) NOT NULL,
  team_id VARCHAR(191) NULL,
  team_name VARCHAR(191) NOT NULL,
  total_score INT NULL,
  holes_json JSON NULL,
  tee_color VARCHAR(32) NOT NULL DEFAULT 'white',
  updated_by_auth_user_id VARCHAR(191) NULL,
  correlation_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_tournament_team_scores_team (tournament_id, team_key),
  KEY idx_tournament_team_scores_tournament (tournament_id),
  KEY idx_tournament_team_scores_team_id (team_id),
  KEY idx_tournament_team_scores_updated (updated_at),
  KEY idx_tournament_team_scores_correlation (correlation_id),
  CONSTRAINT fk_tournament_team_scores_tournament
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
      } else {
        if (await foreignKeyExists(db, 'tournament_team_scores', 'fk_tournament_team_scores_tournament')) {
          statements.push('ALTER TABLE tournament_team_scores DROP FOREIGN KEY fk_tournament_team_scores_tournament')
        }
        const columns = [
          ['team_key', 'ALTER TABLE tournament_team_scores ADD COLUMN team_key VARCHAR(255) NOT NULL AFTER tournament_id'],
          ['team_id', 'ALTER TABLE tournament_team_scores ADD COLUMN team_id VARCHAR(191) NULL AFTER team_key'],
          ['team_name', "ALTER TABLE tournament_team_scores ADD COLUMN team_name VARCHAR(191) NOT NULL DEFAULT 'Tournament team' AFTER team_id"],
          ['total_score', 'ALTER TABLE tournament_team_scores ADD COLUMN total_score INT NULL AFTER team_name'],
          ['holes_json', 'ALTER TABLE tournament_team_scores ADD COLUMN holes_json JSON NULL AFTER total_score'],
          ['tee_color', "ALTER TABLE tournament_team_scores ADD COLUMN tee_color VARCHAR(32) NOT NULL DEFAULT 'white' AFTER holes_json"],
          ['updated_by_auth_user_id', 'ALTER TABLE tournament_team_scores ADD COLUMN updated_by_auth_user_id VARCHAR(191) NULL AFTER tee_color'],
          ['correlation_id', 'ALTER TABLE tournament_team_scores ADD COLUMN correlation_id VARCHAR(191) NULL AFTER updated_by_auth_user_id'],
          ['created_at', 'ALTER TABLE tournament_team_scores ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
          ['updated_at', 'ALTER TABLE tournament_team_scores ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
        ]
        for (const [columnName, sql] of columns) {
          if (!(await columnExists(db, 'tournament_team_scores', columnName))) statements.push(sql)
        }
        statements.push(`ALTER TABLE tournament_team_scores MODIFY COLUMN tournament_id ${tournamentIdDefinition}`)
        if (!(await indexExists(db, 'tournament_team_scores', 'uniq_tournament_team_scores_team'))) statements.push('CREATE UNIQUE INDEX uniq_tournament_team_scores_team ON tournament_team_scores (tournament_id, team_key)')
        if (!(await indexExists(db, 'tournament_team_scores', 'idx_tournament_team_scores_tournament'))) statements.push('CREATE INDEX idx_tournament_team_scores_tournament ON tournament_team_scores (tournament_id)')
        if (!(await indexExists(db, 'tournament_team_scores', 'idx_tournament_team_scores_team_id'))) statements.push('CREATE INDEX idx_tournament_team_scores_team_id ON tournament_team_scores (team_id)')
        if (!(await indexExists(db, 'tournament_team_scores', 'idx_tournament_team_scores_updated'))) statements.push('CREATE INDEX idx_tournament_team_scores_updated ON tournament_team_scores (updated_at)')
        if (!(await indexExists(db, 'tournament_team_scores', 'idx_tournament_team_scores_correlation'))) statements.push('CREATE INDEX idx_tournament_team_scores_correlation ON tournament_team_scores (correlation_id)')
        statements.push(`ALTER TABLE tournament_team_scores
  ADD CONSTRAINT fk_tournament_team_scores_tournament
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
  ON DELETE CASCADE`)
      }
      return statements.join(';\n')
    },
  },


  {
    version: '20260729_064',
    name: 'golf_course_tournament_search',
    filename: '20260729_064_golf_course_tournament_search.sql',
    async isSatisfied(db) {
      return (
        await columnExists(db, 'golf_courses', 'golf_course_website') &&
        await tableExists(db, 'golf_course_tournaments') &&
        await columnExists(db, 'golf_course_tournaments', 'discovery_key') &&
        await columnExists(db, 'golf_course_tournaments', 'tournament_date') &&
        await columnExists(db, 'golf_course_tournaments', 'tournament_website') &&
        await indexExists(db, 'golf_course_tournaments', 'ux_golf_course_tournaments_discovery_key') &&
        await indexExists(db, 'golf_course_tournaments', 'idx_golf_course_tournaments_state_date') &&
        await tableExists(db, 'golf_course_tournament_crawl_state') &&
        await columnExists(db, 'golf_course_tournament_crawl_state', 'next_crawl_after') &&
        await indexExists(db, 'golf_course_tournament_crawl_state', 'idx_golf_course_tournament_crawl_next')
      )
    },
    async getSql(db) {
      const statements = []
      const hasWebsiteColumn = await columnExists(db, 'golf_courses', 'website')
      if (!(await columnExists(db, 'golf_courses', 'golf_course_website'))) {
        statements.push(`ALTER TABLE golf_courses ADD COLUMN golf_course_website VARCHAR(1024) NULL${hasWebsiteColumn ? ' AFTER website' : ''}`)
      }
      if (hasWebsiteColumn) {
        statements.push(`UPDATE golf_courses
   SET golf_course_website = website
 WHERE (golf_course_website IS NULL OR TRIM(golf_course_website) = '')
   AND website IS NOT NULL
   AND TRIM(website) <> ''`)
      }

      if (!(await tableExists(db, 'golf_course_tournaments'))) {
        statements.push(`CREATE TABLE golf_course_tournaments (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  discovery_key CHAR(64) NOT NULL,
  golf_course_id VARCHAR(64) NULL,
  golf_course_name VARCHAR(191) NOT NULL,
  tournament_name VARCHAR(255) NULL,
  state_code VARCHAR(8) NOT NULL,
  city VARCHAR(128) NULL,
  zip_code VARCHAR(32) NULL,
  tournament_date DATE NOT NULL,
  tournament_website VARCHAR(1024) NULL,
  source_url VARCHAR(1024) NOT NULL,
  discovered_text TEXT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  correlation_id VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_golf_course_tournaments_discovery_key (discovery_key),
  KEY idx_golf_course_tournaments_state_date (state_code, tournament_date),
  KEY idx_golf_course_tournaments_city_date (city, tournament_date),
  KEY idx_golf_course_tournaments_zip_date (zip_code, tournament_date),
  KEY idx_golf_course_tournaments_course_date (golf_course_name, tournament_date),
  KEY idx_golf_course_tournaments_active_date (active, tournament_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
      } else {
        const tournamentColumns = [
          ['discovery_key', 'CHAR(64) NULL'],
          ['golf_course_id', 'VARCHAR(64) NULL'],
          ['golf_course_name', "VARCHAR(191) NOT NULL DEFAULT 'Unknown golf course'"],
          ['tournament_name', 'VARCHAR(255) NULL'],
          ['state_code', "VARCHAR(8) NOT NULL DEFAULT ''"],
          ['city', 'VARCHAR(128) NULL'],
          ['zip_code', 'VARCHAR(32) NULL'],
          ['tournament_date', 'DATE NULL'],
          ['tournament_website', 'VARCHAR(1024) NULL'],
          ['source_url', 'VARCHAR(1024) NULL'],
          ['discovered_text', 'TEXT NULL'],
          ['active', 'TINYINT(1) NOT NULL DEFAULT 1'],
          ['first_seen_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
          ['last_seen_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
          ['correlation_id', 'VARCHAR(128) NULL'],
          ['created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
          ['updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
        ]
        for (const [columnName, definition] of tournamentColumns) {
          if (!(await columnExists(db, 'golf_course_tournaments', columnName))) {
            statements.push(`ALTER TABLE golf_course_tournaments ADD COLUMN ${columnName} ${definition}`)
          }
        }
        if (!(await indexExists(db, 'golf_course_tournaments', 'ux_golf_course_tournaments_discovery_key'))) statements.push('CREATE UNIQUE INDEX ux_golf_course_tournaments_discovery_key ON golf_course_tournaments (discovery_key)')
        if (!(await indexExists(db, 'golf_course_tournaments', 'idx_golf_course_tournaments_state_date'))) statements.push('CREATE INDEX idx_golf_course_tournaments_state_date ON golf_course_tournaments (state_code, tournament_date)')
        if (!(await indexExists(db, 'golf_course_tournaments', 'idx_golf_course_tournaments_city_date'))) statements.push('CREATE INDEX idx_golf_course_tournaments_city_date ON golf_course_tournaments (city, tournament_date)')
        if (!(await indexExists(db, 'golf_course_tournaments', 'idx_golf_course_tournaments_zip_date'))) statements.push('CREATE INDEX idx_golf_course_tournaments_zip_date ON golf_course_tournaments (zip_code, tournament_date)')
        if (!(await indexExists(db, 'golf_course_tournaments', 'idx_golf_course_tournaments_course_date'))) statements.push('CREATE INDEX idx_golf_course_tournaments_course_date ON golf_course_tournaments (golf_course_name, tournament_date)')
        if (!(await indexExists(db, 'golf_course_tournaments', 'idx_golf_course_tournaments_active_date'))) statements.push('CREATE INDEX idx_golf_course_tournaments_active_date ON golf_course_tournaments (active, tournament_date)')
      }

      if (!(await tableExists(db, 'golf_course_tournament_crawl_state'))) {
        statements.push(`CREATE TABLE golf_course_tournament_crawl_state (
  golf_course_id VARCHAR(64) NOT NULL PRIMARY KEY,
  golf_course_name VARCHAR(191) NOT NULL,
  website VARCHAR(1024) NOT NULL,
  last_crawled_at DATETIME NULL,
  last_success_at DATETIME NULL,
  next_crawl_after DATETIME NULL,
  last_status VARCHAR(32) NULL,
  last_error TEXT NULL,
  pages_crawled INT UNSIGNED NOT NULL DEFAULT 0,
  tournaments_found INT UNSIGNED NOT NULL DEFAULT 0,
  correlation_id VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_golf_course_tournament_crawl_next (next_crawl_after),
  KEY idx_golf_course_tournament_crawl_status (last_status, last_crawled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
      } else {
        const crawlColumns = [
          ['golf_course_name', "VARCHAR(191) NOT NULL DEFAULT 'Unknown golf course'"],
          ['website', "VARCHAR(1024) NOT NULL DEFAULT ''"],
          ['last_crawled_at', 'DATETIME NULL'],
          ['last_success_at', 'DATETIME NULL'],
          ['next_crawl_after', 'DATETIME NULL'],
          ['last_status', 'VARCHAR(32) NULL'],
          ['last_error', 'TEXT NULL'],
          ['pages_crawled', 'INT UNSIGNED NOT NULL DEFAULT 0'],
          ['tournaments_found', 'INT UNSIGNED NOT NULL DEFAULT 0'],
          ['correlation_id', 'VARCHAR(128) NULL'],
          ['created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
          ['updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
        ]
        for (const [columnName, definition] of crawlColumns) {
          if (!(await columnExists(db, 'golf_course_tournament_crawl_state', columnName))) {
            statements.push(`ALTER TABLE golf_course_tournament_crawl_state ADD COLUMN ${columnName} ${definition}`)
          }
        }
        if (!(await indexExists(db, 'golf_course_tournament_crawl_state', 'idx_golf_course_tournament_crawl_next'))) statements.push('CREATE INDEX idx_golf_course_tournament_crawl_next ON golf_course_tournament_crawl_state (next_crawl_after)')
        if (!(await indexExists(db, 'golf_course_tournament_crawl_state', 'idx_golf_course_tournament_crawl_status'))) statements.push('CREATE INDEX idx_golf_course_tournament_crawl_status ON golf_course_tournament_crawl_state (last_status, last_crawled_at)')
      }
      return statements.join(';\n')
    },
  },
  {
    version: '20260729_065',
    name: 'scheduled_job_configuration',
    filename: '20260729_065_scheduled_job_configuration.sql',
    async isSatisfied(db) {
      return (
        await columnExists(db, 'scheduled_jobs', 'schedule_type') &&
        await columnExists(db, 'scheduled_jobs', 'schedule_time') &&
        await columnExists(db, 'scheduled_jobs', 'schedule_day_of_week') &&
        await columnExists(db, 'scheduled_jobs', 'schedule_day_of_month') &&
        await columnExists(db, 'scheduled_jobs', 'job_config_json') &&
        await indexExists(db, 'scheduled_jobs', 'idx_scheduled_jobs_schedule_type')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'scheduled_jobs', 'schedule_type'))) {
        statements.push("ALTER TABLE scheduled_jobs ADD COLUMN schedule_type VARCHAR(16) NOT NULL DEFAULT 'manual' AFTER schedule_time_zone")
      }
      if (!(await columnExists(db, 'scheduled_jobs', 'schedule_time'))) {
        statements.push('ALTER TABLE scheduled_jobs ADD COLUMN schedule_time TIME NULL AFTER schedule_type')
      }
      if (!(await columnExists(db, 'scheduled_jobs', 'schedule_day_of_week'))) {
        statements.push('ALTER TABLE scheduled_jobs ADD COLUMN schedule_day_of_week TINYINT UNSIGNED NULL AFTER schedule_time')
      }
      if (!(await columnExists(db, 'scheduled_jobs', 'schedule_day_of_month'))) {
        statements.push('ALTER TABLE scheduled_jobs ADD COLUMN schedule_day_of_month TINYINT UNSIGNED NULL AFTER schedule_day_of_week')
      }
      if (!(await columnExists(db, 'scheduled_jobs', 'job_config_json'))) {
        statements.push('ALTER TABLE scheduled_jobs ADD COLUMN job_config_json LONGTEXT NULL AFTER schedule_day_of_month')
      }
      statements.push(`UPDATE scheduled_jobs
   SET schedule_type = 'daily',
       schedule_time = '02:00:00',
       schedule_day_of_week = NULL,
       schedule_day_of_month = NULL,
       schedule_label = 'Daily 02:00 MT'
 WHERE id = 'getTournaments'
   AND (schedule_type IS NULL OR schedule_type = 'manual')`)
      statements.push(`UPDATE scheduled_jobs
   SET schedule_type = 'weekly',
       schedule_time = '18:00:00',
       schedule_day_of_week = 0,
       schedule_day_of_month = NULL,
       schedule_label = 'Weekly Sunday 18:00 MT'
 WHERE id = 'cancelled-tournament-cleanup'
   AND (schedule_type IS NULL OR schedule_type = 'manual')`)
      if (!(await indexExists(db, 'scheduled_jobs', 'idx_scheduled_jobs_schedule_type'))) {
        statements.push('CREATE INDEX idx_scheduled_jobs_schedule_type ON scheduled_jobs (schedule_type)')
      }
      return statements.join(';\n')
    },
  },
  {
    version: '20260804_066',
    name: 'golf_course_public_pages',
    filename: '20260804_066_golf_course_public_pages.sql',
    async isSatisfied(db) {
      return (
        await columnExists(db, 'host_accounts', 'golf_course_id') &&
        await columnExists(db, 'host_account_requests', 'golf_course_id') &&
        await tableExists(db, 'golf_course_public_pages') &&
        await columnExists(db, 'golf_course_public_pages', 'slug') &&
        await columnExists(db, 'golf_course_public_pages', 'summary') &&
        await columnExists(db, 'golf_course_public_pages', 'banner_image_url') &&
        await columnExists(db, 'golf_course_public_pages', 'source_website_url') &&
        await indexExists(db, 'golf_course_public_pages', 'uq_golf_course_public_pages_host') &&
        await indexExists(db, 'golf_course_public_pages', 'uq_golf_course_public_pages_slug') &&
        await indexExists(db, 'host_accounts', 'idx_host_accounts_golf_course_id') &&
        await indexExists(db, 'host_account_requests', 'idx_host_account_requests_golf_course_id')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'host_accounts', 'golf_course_id'))) {
        statements.push('ALTER TABLE host_accounts ADD COLUMN golf_course_id VARCHAR(64) NULL AFTER auth_user_id')
      }
      if (!(await columnExists(db, 'host_account_requests', 'golf_course_id'))) {
        statements.push('ALTER TABLE host_account_requests ADD COLUMN golf_course_id VARCHAR(64) NULL AFTER golf_course_name')
      }
      if (!(await tableExists(db, 'golf_course_public_pages'))) {
        statements.push(`CREATE TABLE golf_course_public_pages (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  host_account_id VARCHAR(191) NOT NULL,
  golf_course_id VARCHAR(64) NULL,
  slug VARCHAR(191) NOT NULL,
  golf_course_name VARCHAR(191) NOT NULL,
  summary TEXT NULL,
  banner_image_url VARCHAR(1024) NULL,
  website_url VARCHAR(1024) NULL,
  contact_phone VARCHAR(64) NULL,
  address_line1 VARCHAR(255) NULL,
  city VARCHAR(128) NULL,
  state_code VARCHAR(8) NOT NULL,
  postal_code VARCHAR(32) NULL,
  source_website_url VARCHAR(1024) NULL,
  source_last_synced_at DATETIME NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_golf_course_public_pages_host (host_account_id),
  UNIQUE KEY uq_golf_course_public_pages_slug (slug),
  KEY idx_golf_course_public_pages_course (golf_course_id),
  KEY idx_golf_course_public_pages_state (state_code, golf_course_name),
  KEY idx_golf_course_public_pages_published (is_published, slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
      } else {
        const columns = [
          ['host_account_id', 'VARCHAR(191) NOT NULL'],
          ['golf_course_id', 'VARCHAR(64) NULL'],
          ['slug', 'VARCHAR(191) NOT NULL'],
          ['golf_course_name', "VARCHAR(191) NOT NULL DEFAULT 'Golf course'"],
          ['summary', 'TEXT NULL'],
          ['banner_image_url', 'VARCHAR(1024) NULL'],
          ['website_url', 'VARCHAR(1024) NULL'],
          ['contact_phone', 'VARCHAR(64) NULL'],
          ['address_line1', 'VARCHAR(255) NULL'],
          ['city', 'VARCHAR(128) NULL'],
          ['state_code', "VARCHAR(8) NOT NULL DEFAULT ''"],
          ['postal_code', 'VARCHAR(32) NULL'],
          ['source_website_url', 'VARCHAR(1024) NULL'],
          ['source_last_synced_at', 'DATETIME NULL'],
          ['is_published', 'TINYINT(1) NOT NULL DEFAULT 1'],
          ['created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
          ['updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
        ]
        for (const [columnName, definition] of columns) {
          if (!(await columnExists(db, 'golf_course_public_pages', columnName))) {
            statements.push(`ALTER TABLE golf_course_public_pages ADD COLUMN ${columnName} ${definition}`)
          }
        }
        if (!(await indexExists(db, 'golf_course_public_pages', 'uq_golf_course_public_pages_host'))) statements.push('CREATE UNIQUE INDEX uq_golf_course_public_pages_host ON golf_course_public_pages (host_account_id)')
        if (!(await indexExists(db, 'golf_course_public_pages', 'uq_golf_course_public_pages_slug'))) statements.push('CREATE UNIQUE INDEX uq_golf_course_public_pages_slug ON golf_course_public_pages (slug)')
        if (!(await indexExists(db, 'golf_course_public_pages', 'idx_golf_course_public_pages_course'))) statements.push('CREATE INDEX idx_golf_course_public_pages_course ON golf_course_public_pages (golf_course_id)')
        if (!(await indexExists(db, 'golf_course_public_pages', 'idx_golf_course_public_pages_state'))) statements.push('CREATE INDEX idx_golf_course_public_pages_state ON golf_course_public_pages (state_code, golf_course_name)')
        if (!(await indexExists(db, 'golf_course_public_pages', 'idx_golf_course_public_pages_published'))) statements.push('CREATE INDEX idx_golf_course_public_pages_published ON golf_course_public_pages (is_published, slug)')
      }
      if (!(await indexExists(db, 'host_accounts', 'idx_host_accounts_golf_course_id'))) {
        statements.push('CREATE INDEX idx_host_accounts_golf_course_id ON host_accounts (golf_course_id)')
      }
      if (!(await indexExists(db, 'host_account_requests', 'idx_host_account_requests_golf_course_id'))) {
        statements.push('CREATE INDEX idx_host_account_requests_golf_course_id ON host_account_requests (golf_course_id)')
      }
      return statements.join(';\n')
    },
  },
  {
    version: '20260806_067',
    name: 'golfhomiez_tournament_search_records',
    filename: '20260806_067_golfhomiez_tournament_search_records.sql',
    async isSatisfied(db) {
      return (
        await columnExists(db, 'golf_course_tournaments', 'source_type') &&
        await columnExists(db, 'golf_course_tournaments', 'golfhomiez_tournament_id') &&
        await indexExists(db, 'golf_course_tournaments', 'uq_golf_course_tournaments_golfhomiez_id') &&
        await indexExists(db, 'golf_course_tournaments', 'idx_golf_course_tournaments_source_active_date')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'golf_course_tournaments', 'source_type'))) {
        statements.push("ALTER TABLE golf_course_tournaments ADD COLUMN source_type VARCHAR(32) NOT NULL DEFAULT 'external' AFTER correlation_id")
      }
      if (!(await columnExists(db, 'golf_course_tournaments', 'golfhomiez_tournament_id'))) {
        statements.push('ALTER TABLE golf_course_tournaments ADD COLUMN golfhomiez_tournament_id VARCHAR(191) NULL AFTER source_type')
      }
      statements.push("UPDATE golf_course_tournaments SET source_type = 'external' WHERE source_type IS NULL OR TRIM(source_type) = ''")
      if (!(await indexExists(db, 'golf_course_tournaments', 'uq_golf_course_tournaments_golfhomiez_id'))) {
        statements.push('CREATE UNIQUE INDEX uq_golf_course_tournaments_golfhomiez_id ON golf_course_tournaments (golfhomiez_tournament_id)')
      }
      if (!(await indexExists(db, 'golf_course_tournaments', 'idx_golf_course_tournaments_source_active_date'))) {
        statements.push('CREATE INDEX idx_golf_course_tournaments_source_active_date ON golf_course_tournaments (source_type, active, tournament_date)')
      }
      statements.push(`INSERT INTO golf_course_tournaments
  (id, discovery_key, golf_course_id, golf_course_name, tournament_name, state_code, city, zip_code,
   tournament_date, tournament_website, source_url, discovered_text, active, first_seen_at, last_seen_at,
   correlation_id, source_type, golfhomiez_tournament_id)
SELECT
  LOWER(REPLACE(UUID(), '-', '')),
  SHA2(CONCAT('golfhomiez:', t.id), 256),
  COALESCE(gc.id, gcpp.golf_course_id, ha.golf_course_id),
  COALESCE(NULLIF(TRIM(gc.name), ''), NULLIF(TRIM(gcpp.golf_course_name), ''), NULLIF(TRIM(ha.golf_course_name), ''), NULLIF(TRIM(hra.golf_course_name), ''), 'Golf course'),
  t.name,
  COALESCE(NULLIF(TRIM(gc.state_code), ''), NULLIF(TRIM(gcpp.state_code), ''), ''),
  COALESCE(NULLIF(TRIM(gc.city), ''), NULLIF(TRIM(gcpp.city), '')),
  COALESCE(NULLIF(TRIM(gc.postal_code), ''), NULLIF(TRIM(gcpp.postal_code), '')),
  t.start_date,
  CONCAT('/tournaments/', COALESCE(NULLIF(TRIM(t.tournament_identifier), ''), t.id)),
  CONCAT('/tournaments/', COALESCE(NULLIF(TRIM(t.tournament_identifier), ''), t.id)),
  CONCAT_WS(' ', t.name, t.description),
  1,
  COALESCE(t.created_at, UTC_TIMESTAMP()),
  UTC_TIMESTAMP(),
  'migration-20260806-067',
  'golfhomiez',
  t.id
FROM tournaments t
LEFT JOIN host_role_accounts hra ON BINARY hra.id = BINARY t.host_account_id
LEFT JOIN host_accounts ha ON BINARY ha.id = BINARY t.host_account_id
LEFT JOIN golf_course_public_pages gcpp ON BINARY gcpp.host_account_id = BINARY t.host_account_id
LEFT JOIN golf_courses gc ON BINARY gc.id = BINARY COALESCE(ha.golf_course_id, gcpp.golf_course_id)
WHERE LOWER(TRIM(COALESCE(t.status, ''))) = 'published'
  AND t.start_date IS NOT NULL
ON DUPLICATE KEY UPDATE
  golf_course_id = VALUES(golf_course_id),
  golf_course_name = VALUES(golf_course_name),
  tournament_name = VALUES(tournament_name),
  state_code = VALUES(state_code),
  city = VALUES(city),
  zip_code = VALUES(zip_code),
  tournament_date = VALUES(tournament_date),
  tournament_website = VALUES(tournament_website),
  source_url = VALUES(source_url),
  discovered_text = VALUES(discovered_text),
  active = 1,
  last_seen_at = UTC_TIMESTAMP(),
  correlation_id = VALUES(correlation_id),
  source_type = 'golfhomiez',
  golfhomiez_tournament_id = VALUES(golfhomiez_tournament_id)`)
      return statements.join(';\n')
    },
  },
  {
    version: '20260806_068',
    name: 'host_course_profile_banner',
    filename: '20260806_068_host_course_profile_banner.sql',
    async isSatisfied(db) {
      return await columnExists(db, 'golf_course_public_pages', 'banner_image_data')
    },
    async getSql(db) {
      if (await columnExists(db, 'golf_course_public_pages', 'banner_image_data')) return ''
      return 'ALTER TABLE golf_course_public_pages ADD COLUMN banner_image_data MEDIUMTEXT NULL AFTER banner_image_url'
    },
  },
  {
    version: '20260806_069',
    name: 'tournament_team_start_assignments',
    filename: '20260806_069_tournament_team_start_assignments.sql',
    async isSatisfied(db) {
      if (!(await tableExists(db, 'tournament_team_start_assignments'))) return false
      const requiredColumns = [
        'tournament_id',
        'team_key',
        'registration_id',
        'team_id',
        'team_name',
        'start_type',
        'start_time',
        'starting_hole',
        'sort_order',
        'notes',
        'updated_by_auth_user_id',
        'correlation_id',
        'created_at',
        'updated_at',
      ]
      for (const columnName of requiredColumns) {
        if (!(await columnExists(db, 'tournament_team_start_assignments', columnName))) return false
      }

      const [assignmentTournamentIdRows] = await db.execute(
        `SELECT COLUMN_TYPE AS column_type, CHARACTER_SET_NAME AS character_set_name, COLLATION_NAME AS collation_name
           FROM information_schema.COLUMNS
          WHERE table_schema = DATABASE()
            AND table_name = 'tournament_team_start_assignments'
            AND column_name = 'tournament_id'
          LIMIT 1`,
      )
      const [tournamentIdRows] = await db.execute(
        `SELECT COLUMN_TYPE AS column_type, CHARACTER_SET_NAME AS character_set_name, COLLATION_NAME AS collation_name
           FROM information_schema.COLUMNS
          WHERE table_schema = DATABASE()
            AND table_name = 'tournaments'
            AND column_name = 'id'
          LIMIT 1`,
      )
      const assignmentTournamentId = assignmentTournamentIdRows[0]
      const tournamentId = tournamentIdRows[0]
      const tournamentIdCompatible = Boolean(
        assignmentTournamentId &&
          tournamentId &&
          String(assignmentTournamentId.column_type).toLowerCase() === String(tournamentId.column_type).toLowerCase() &&
          String(assignmentTournamentId.character_set_name || '').toLowerCase() === String(tournamentId.character_set_name || '').toLowerCase() &&
          String(assignmentTournamentId.collation_name || '').toLowerCase() === String(tournamentId.collation_name || '').toLowerCase()
      )

      return (
        tournamentIdCompatible &&
        await indexExists(db, 'tournament_team_start_assignments', 'uq_tournament_team_start_assignment') &&
        await indexExists(db, 'tournament_team_start_assignments', 'idx_tournament_team_start_schedule') &&
        await indexExists(db, 'tournament_team_start_assignments', 'idx_tournament_team_start_registration') &&
        await indexExists(db, 'tournament_team_start_assignments', 'idx_tournament_team_start_correlation') &&
        await foreignKeyExists(db, 'tournament_team_start_assignments', 'fk_tournament_team_start_tournament')
      )
    },
    async getSql(db) {
      const quoteIdentifier = (value) => `\`${String(value).replaceAll('`', '``')}\``
      const [tournamentIdRows] = await db.execute(
        `SELECT COLUMN_TYPE AS column_type, CHARACTER_SET_NAME AS character_set_name, COLLATION_NAME AS collation_name
           FROM information_schema.COLUMNS
          WHERE table_schema = DATABASE()
            AND table_name = 'tournaments'
            AND column_name = 'id'
          LIMIT 1`,
      )
      const tournamentId = tournamentIdRows[0]
      const tournamentColumnType = String(tournamentId?.column_type || '').trim()
      if (!tournamentColumnType) {
        throw new Error('Cannot build tournament_team_start_assignments migration: tournaments.id column type could not be detected')
      }
      const tournamentIdDefinition = [
        tournamentColumnType.toUpperCase(),
        tournamentId.character_set_name ? `CHARACTER SET ${quoteIdentifier(tournamentId.character_set_name)}` : '',
        tournamentId.collation_name ? `COLLATE ${quoteIdentifier(tournamentId.collation_name)}` : '',
        'NOT NULL',
      ].filter(Boolean).join(' ')

      const statements = []
      if (!(await tableExists(db, 'tournament_team_start_assignments'))) {
        statements.push(`CREATE TABLE tournament_team_start_assignments (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  tournament_id ${tournamentIdDefinition},
  team_key VARCHAR(255) NOT NULL,
  registration_id VARCHAR(191) NULL,
  team_id VARCHAR(191) NULL,
  team_name VARCHAR(191) NOT NULL,
  start_type VARCHAR(32) NOT NULL DEFAULT 'shotgun',
  start_time TIME NOT NULL,
  starting_hole VARCHAR(12) NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  notes VARCHAR(500) NULL,
  updated_by_auth_user_id VARCHAR(191) NULL,
  correlation_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tournament_team_start_assignment (tournament_id, team_key),
  KEY idx_tournament_team_start_schedule (tournament_id, sort_order, start_time),
  KEY idx_tournament_team_start_registration (registration_id),
  KEY idx_tournament_team_start_correlation (correlation_id),
  CONSTRAINT fk_tournament_team_start_tournament
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
      } else {
        const columns = [
          ['team_key', "VARCHAR(255) NOT NULL DEFAULT ''"],
          ['registration_id', 'VARCHAR(191) NULL'],
          ['team_id', 'VARCHAR(191) NULL'],
          ['team_name', "VARCHAR(191) NOT NULL DEFAULT 'Tournament team'"],
          ['start_type', "VARCHAR(32) NOT NULL DEFAULT 'shotgun'"],
          ['start_time', "TIME NOT NULL DEFAULT '08:30:00'"],
          ['starting_hole', 'VARCHAR(12) NULL'],
          ['sort_order', 'INT UNSIGNED NOT NULL DEFAULT 0'],
          ['notes', 'VARCHAR(500) NULL'],
          ['updated_by_auth_user_id', 'VARCHAR(191) NULL'],
          ['correlation_id', 'VARCHAR(191) NULL'],
          ['created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
          ['updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
        ]
        for (const [columnName, definition] of columns) {
          if (!(await columnExists(db, 'tournament_team_start_assignments', columnName))) {
            statements.push(`ALTER TABLE tournament_team_start_assignments ADD COLUMN ${columnName} ${definition}`)
          }
        }

        if (await foreignKeyExists(db, 'tournament_team_start_assignments', 'fk_tournament_team_start_tournament')) {
          statements.push('ALTER TABLE tournament_team_start_assignments DROP FOREIGN KEY fk_tournament_team_start_tournament')
        }
        statements.push(`ALTER TABLE tournament_team_start_assignments MODIFY COLUMN tournament_id ${tournamentIdDefinition}`)
        if (!(await indexExists(db, 'tournament_team_start_assignments', 'uq_tournament_team_start_assignment'))) statements.push('CREATE UNIQUE INDEX uq_tournament_team_start_assignment ON tournament_team_start_assignments (tournament_id, team_key)')
        if (!(await indexExists(db, 'tournament_team_start_assignments', 'idx_tournament_team_start_schedule'))) statements.push('CREATE INDEX idx_tournament_team_start_schedule ON tournament_team_start_assignments (tournament_id, sort_order, start_time)')
        if (!(await indexExists(db, 'tournament_team_start_assignments', 'idx_tournament_team_start_registration'))) statements.push('CREATE INDEX idx_tournament_team_start_registration ON tournament_team_start_assignments (registration_id)')
        if (!(await indexExists(db, 'tournament_team_start_assignments', 'idx_tournament_team_start_correlation'))) statements.push('CREATE INDEX idx_tournament_team_start_correlation ON tournament_team_start_assignments (correlation_id)')
        statements.push('ALTER TABLE tournament_team_start_assignments ADD CONSTRAINT fk_tournament_team_start_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE')
      }
      return statements.join(';\n')
    },
  },


  {
    version: '20260810_070',
    name: 'tournament_archiving',
    filename: '20260810_070_tournament_archiving.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'tournaments') &&
        await columnExists(db, 'tournaments', 'archived_at') &&
        await indexExists(db, 'tournaments', 'idx_tournaments_archived_at')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await tableExists(db, 'tournaments'))) return ''
      if (!(await columnExists(db, 'tournaments', 'archived_at'))) {
        statements.push('ALTER TABLE tournaments ADD COLUMN archived_at DATETIME NULL AFTER status')
      }
      if (!(await indexExists(db, 'tournaments', 'idx_tournaments_archived_at'))) {
        statements.push('CREATE INDEX idx_tournaments_archived_at ON tournaments (archived_at)')
      }
      return statements.join(';\n')
    },
  },

  {
    version: '20260810_071',
    name: 'cross_table_identifier_collation_repair',
    filename: '20260810_071_cross_table_identifier_collation_repair.sql',
    async isSatisfied(db) {
      const metadata = async (tableName, columnName) => {
        const [rows] = await db.execute(
          `SELECT COLUMN_TYPE AS column_type, CHARACTER_SET_NAME AS character_set_name, COLLATION_NAME AS collation_name
             FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
            LIMIT 1`,
          [tableName, columnName],
        )
        return rows[0] || null
      }
      const compatible = (left, right) => Boolean(
        left &&
          right &&
          String(left.column_type || '').toLowerCase() === String(right.column_type || '').toLowerCase() &&
          String(left.character_set_name || '').toLowerCase() === String(right.character_set_name || '').toLowerCase() &&
          String(left.collation_name || '').toLowerCase() === String(right.collation_name || '').toLowerCase()
      )

      const golfCourseId = await metadata('golf_courses', 'id')
      const hostAccountId = await metadata('host_accounts', 'id')
      const tournamentId = await metadata('tournaments', 'id')
      const pairs = [
        [await metadata('host_accounts', 'golf_course_id'), golfCourseId],
        [await metadata('host_account_requests', 'golf_course_id'), golfCourseId],
        [await metadata('golf_course_public_pages', 'golf_course_id'), golfCourseId],
        [await metadata('golf_course_public_pages', 'host_account_id'), hostAccountId],
        [await metadata('golf_course_tournaments', 'golfhomiez_tournament_id'), tournamentId],
        [await metadata('tournament_team_start_assignments', 'tournament_id'), tournamentId],
      ]
      if (pairs.some(([left, right]) => !compatible(left, right))) return false
      if (!(await foreignKeyExists(db, 'tournament_team_start_assignments', 'fk_tournament_team_start_tournament'))) return false

      const [[pending = {}] = []] = await db.query(`
        SELECT COUNT(*) AS pending_count
          FROM tournaments t
          LEFT JOIN golf_course_tournaments gct
            ON BINARY gct.golfhomiez_tournament_id = BINARY t.id
           AND gct.source_type = 'golfhomiez'
           AND gct.active = 1
         WHERE LOWER(TRIM(COALESCE(t.status, ''))) = 'published'
           AND t.start_date IS NOT NULL
           AND t.archived_at IS NULL
           AND gct.id IS NULL
      `)
      return Number(pending.pending_count || 0) === 0
    },
    async getSql(db) {
      const quoteIdentifier = (value) => `\`${String(value).replaceAll('`', '``')}\``
      const metadata = async (tableName, columnName) => {
        const [rows] = await db.execute(
          `SELECT COLUMN_TYPE AS column_type, CHARACTER_SET_NAME AS character_set_name, COLLATION_NAME AS collation_name
             FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
            LIMIT 1`,
          [tableName, columnName],
        )
        return rows[0] || null
      }
      const compatible = (left, right) => Boolean(
        left &&
          right &&
          String(left.column_type || '').toLowerCase() === String(right.column_type || '').toLowerCase() &&
          String(left.character_set_name || '').toLowerCase() === String(right.character_set_name || '').toLowerCase() &&
          String(left.collation_name || '').toLowerCase() === String(right.collation_name || '').toLowerCase()
      )
      const definitionFrom = (column, nullable) => {
        const columnType = String(column?.column_type || '').trim()
        if (!columnType) throw new Error('Cannot repair cross-table identifier collations because a reference column type could not be detected')
        return [
          columnType.toUpperCase(),
          column.character_set_name ? `CHARACTER SET ${quoteIdentifier(column.character_set_name)}` : '',
          column.collation_name ? `COLLATE ${quoteIdentifier(column.collation_name)}` : '',
          nullable ? 'NULL' : 'NOT NULL',
        ].filter(Boolean).join(' ')
      }

      const golfCourseId = await metadata('golf_courses', 'id')
      const hostAccountId = await metadata('host_accounts', 'id')
      const tournamentId = await metadata('tournaments', 'id')
      if (!golfCourseId || !hostAccountId || !tournamentId) {
        throw new Error('Cannot repair cross-table identifier collations because golf_courses.id, host_accounts.id, or tournaments.id is missing')
      }

      const statements = []
      const maybeModify = async (tableName, columnName, reference, nullable) => {
        const current = await metadata(tableName, columnName)
        if (!current) throw new Error(`Cannot repair ${tableName}.${columnName}: column is missing`)
        if (!compatible(current, reference)) {
          statements.push(`ALTER TABLE ${tableName} MODIFY COLUMN ${columnName} ${definitionFrom(reference, nullable)}`)
          return true
        }
        return false
      }

      await maybeModify('host_accounts', 'golf_course_id', golfCourseId, true)
      await maybeModify('host_account_requests', 'golf_course_id', golfCourseId, true)
      await maybeModify('golf_course_public_pages', 'golf_course_id', golfCourseId, true)
      await maybeModify('golf_course_public_pages', 'host_account_id', hostAccountId, false)
      await maybeModify('golf_course_tournaments', 'golfhomiez_tournament_id', tournamentId, true)

      const assignmentNeedsModify = !compatible(
        await metadata('tournament_team_start_assignments', 'tournament_id'),
        tournamentId,
      )
      const assignmentHasFk = await foreignKeyExists(db, 'tournament_team_start_assignments', 'fk_tournament_team_start_tournament')
      if (assignmentNeedsModify && assignmentHasFk) {
        statements.push('ALTER TABLE tournament_team_start_assignments DROP FOREIGN KEY fk_tournament_team_start_tournament')
      }
      if (assignmentNeedsModify) {
        statements.push(`ALTER TABLE tournament_team_start_assignments MODIFY COLUMN tournament_id ${definitionFrom(tournamentId, false)}`)
      }
      if (assignmentNeedsModify || !assignmentHasFk) {
        statements.push('ALTER TABLE tournament_team_start_assignments ADD CONSTRAINT fk_tournament_team_start_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE')
      }

      statements.push(`INSERT INTO golf_course_tournaments
  (id, discovery_key, golf_course_id, golf_course_name, tournament_name, state_code, city, zip_code,
   tournament_date, tournament_website, source_url, discovered_text, active, first_seen_at, last_seen_at,
   correlation_id, source_type, golfhomiez_tournament_id)
SELECT
  LOWER(REPLACE(UUID(), '-', '')),
  SHA2(CONCAT('golfhomiez:', t.id), 256),
  COALESCE(gc.id, gcpp.golf_course_id, ha.golf_course_id),
  COALESCE(NULLIF(TRIM(gc.name), ''), NULLIF(TRIM(gcpp.golf_course_name), ''), NULLIF(TRIM(ha.golf_course_name), ''), NULLIF(TRIM(hra.golf_course_name), ''), 'Golf course'),
  t.name,
  COALESCE(NULLIF(TRIM(gc.state_code), ''), NULLIF(TRIM(gcpp.state_code), ''), ''),
  COALESCE(NULLIF(TRIM(gc.city), ''), NULLIF(TRIM(gcpp.city), '')),
  COALESCE(NULLIF(TRIM(gc.postal_code), ''), NULLIF(TRIM(gcpp.postal_code), '')),
  t.start_date,
  CONCAT('/tournaments/', COALESCE(NULLIF(TRIM(t.tournament_identifier), ''), t.id)),
  CONCAT('/tournaments/', COALESCE(NULLIF(TRIM(t.tournament_identifier), ''), t.id)),
  CONCAT_WS(' ', t.name, t.description),
  1,
  COALESCE(t.created_at, UTC_TIMESTAMP()),
  UTC_TIMESTAMP(),
  'migration-20260810-071',
  'golfhomiez',
  t.id
FROM tournaments t
LEFT JOIN host_role_accounts hra ON BINARY hra.id = BINARY t.host_account_id
LEFT JOIN host_accounts ha ON BINARY ha.id = BINARY t.host_account_id
LEFT JOIN golf_course_public_pages gcpp ON BINARY gcpp.host_account_id = BINARY t.host_account_id
LEFT JOIN golf_courses gc ON BINARY gc.id = BINARY COALESCE(ha.golf_course_id, gcpp.golf_course_id)
WHERE LOWER(TRIM(COALESCE(t.status, ''))) = 'published'
  AND t.start_date IS NOT NULL
  AND t.archived_at IS NULL
ON DUPLICATE KEY UPDATE
  golf_course_id = VALUES(golf_course_id),
  golf_course_name = VALUES(golf_course_name),
  tournament_name = VALUES(tournament_name),
  state_code = VALUES(state_code),
  city = VALUES(city),
  zip_code = VALUES(zip_code),
  tournament_date = VALUES(tournament_date),
  tournament_website = VALUES(tournament_website),
  source_url = VALUES(source_url),
  discovered_text = VALUES(discovered_text),
  active = 1,
  last_seen_at = UTC_TIMESTAMP(),
  correlation_id = VALUES(correlation_id),
  source_type = 'golfhomiez',
  golfhomiez_tournament_id = VALUES(golfhomiez_tournament_id)`)
      statements.push(`UPDATE golf_course_tournaments gct
JOIN tournaments t ON BINARY t.id = BINARY gct.golfhomiez_tournament_id
   SET gct.active = 0,
       gct.last_seen_at = UTC_TIMESTAMP(),
       gct.correlation_id = 'migration-20260810-071'
 WHERE gct.source_type = 'golfhomiez'
   AND t.archived_at IS NOT NULL`)
      return statements.join(';\n')
    },
  },


  {
    version: '20260811_072',
    name: 'golf_course_data_import_support',
    filename: '20260811_072_golf_course_data_import_support.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'golf_courses') &&
        await tableExists(db, 'golf_course_holes') &&
        await columnExists(db, 'golf_courses', 'raw_holes_payload') &&
        await columnExists(db, 'golf_courses', 'raw_tees_payload') &&
        await columnExists(db, 'golf_course_holes', 'tee_latitude') &&
        await columnExists(db, 'golf_course_holes', 'tee_longitude') &&
        await columnExists(db, 'golf_course_holes', 'front_latitude') &&
        await columnExists(db, 'golf_course_holes', 'front_longitude') &&
        await columnExists(db, 'golf_course_holes', 'center_latitude') &&
        await columnExists(db, 'golf_course_holes', 'center_longitude') &&
        await columnExists(db, 'golf_course_holes', 'back_latitude') &&
        await columnExists(db, 'golf_course_holes', 'back_longitude')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await tableExists(db, 'golf_courses')) || !(await tableExists(db, 'golf_course_holes'))) {
        throw new Error('OpenGolfAPI golf course catalog tables are missing; migration 20260630_059 must be applied first')
      }
      if (!(await columnExists(db, 'golf_courses', 'raw_holes_payload'))) {
        statements.push('ALTER TABLE golf_courses ADD COLUMN raw_holes_payload JSON NULL AFTER raw_detail_payload')
      }
      if (!(await columnExists(db, 'golf_courses', 'raw_tees_payload'))) {
        statements.push('ALTER TABLE golf_courses ADD COLUMN raw_tees_payload JSON NULL AFTER raw_holes_payload')
      }
      if (!(await columnExists(db, 'golf_course_holes', 'tee_latitude'))) {
        statements.push('ALTER TABLE golf_course_holes ADD COLUMN tee_latitude DECIMAL(10,7) NULL AFTER stroke_index')
      }
      if (!(await columnExists(db, 'golf_course_holes', 'tee_longitude'))) {
        statements.push('ALTER TABLE golf_course_holes ADD COLUMN tee_longitude DECIMAL(10,7) NULL AFTER tee_latitude')
      }
      if (!(await columnExists(db, 'golf_course_holes', 'front_latitude'))) {
        statements.push('ALTER TABLE golf_course_holes ADD COLUMN front_latitude DECIMAL(10,7) NULL AFTER tee_longitude')
      }
      if (!(await columnExists(db, 'golf_course_holes', 'front_longitude'))) {
        statements.push('ALTER TABLE golf_course_holes ADD COLUMN front_longitude DECIMAL(10,7) NULL AFTER front_latitude')
      }
      if (!(await columnExists(db, 'golf_course_holes', 'center_latitude'))) {
        statements.push('ALTER TABLE golf_course_holes ADD COLUMN center_latitude DECIMAL(10,7) NULL AFTER front_longitude')
      }
      if (!(await columnExists(db, 'golf_course_holes', 'center_longitude'))) {
        statements.push('ALTER TABLE golf_course_holes ADD COLUMN center_longitude DECIMAL(10,7) NULL AFTER center_latitude')
      }
      if (!(await columnExists(db, 'golf_course_holes', 'back_latitude'))) {
        statements.push('ALTER TABLE golf_course_holes ADD COLUMN back_latitude DECIMAL(10,7) NULL AFTER center_longitude')
      }
      if (!(await columnExists(db, 'golf_course_holes', 'back_longitude'))) {
        statements.push('ALTER TABLE golf_course_holes ADD COLUMN back_longitude DECIMAL(10,7) NULL AFTER back_latitude')
      }
      return statements.join(';\n') || '-- getGolfCourseData import schema already exists'
    },
  },


  {
    version: '20260819_073',
    name: 'host_course_account_admin',
    filename: '20260819_073_host_course_account_admin.sql',
    async isSatisfied(db) {
      return (
        await columnExists(db, 'host_accounts', 'is_course_admin') &&
        await columnExists(db, 'host_accounts', 'created_by_host_account_id') &&
        await indexExists(db, 'host_accounts', 'idx_host_accounts_course_admin')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'host_accounts', 'is_course_admin'))) {
        statements.push('ALTER TABLE host_accounts ADD COLUMN is_course_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER notes')
      }
      if (!(await columnExists(db, 'host_accounts', 'created_by_host_account_id'))) {
        statements.push('ALTER TABLE host_accounts ADD COLUMN created_by_host_account_id VARCHAR(191) NULL AFTER is_course_admin')
      }
      if (!(await indexExists(db, 'host_accounts', 'idx_host_accounts_course_admin'))) {
        statements.push('CREATE INDEX idx_host_accounts_course_admin ON host_accounts (golf_course_id, is_course_admin)')
      }
      statements.push(`UPDATE host_accounts target
JOIN (
  SELECT first_hosts.id
  FROM (
    SELECT candidate.id,
           COALESCE(NULLIF(TRIM(candidate.golf_course_id), ''), CONCAT('name:', LOWER(TRIM(COALESCE(NULLIF(candidate.account_name, ''), candidate.id))))) AS course_key
      FROM host_accounts candidate
     WHERE candidate.is_validated = 1
       AND NOT EXISTS (
         SELECT 1
           FROM host_accounts earlier
          WHERE earlier.is_validated = 1
            AND COALESCE(NULLIF(TRIM(earlier.golf_course_id), ''), CONCAT('name:', LOWER(TRIM(COALESCE(NULLIF(earlier.account_name, ''), earlier.id))))) =
                COALESCE(NULLIF(TRIM(candidate.golf_course_id), ''), CONCAT('name:', LOWER(TRIM(COALESCE(NULLIF(candidate.account_name, ''), candidate.id)))))
            AND (earlier.created_at < candidate.created_at OR (earlier.created_at = candidate.created_at AND earlier.id < candidate.id))
       )
  ) first_hosts
  LEFT JOIN host_accounts existing_admin
    ON existing_admin.is_course_admin = 1
   AND COALESCE(NULLIF(TRIM(existing_admin.golf_course_id), ''), CONCAT('name:', LOWER(TRIM(COALESCE(NULLIF(existing_admin.account_name, ''), existing_admin.id))))) = first_hosts.course_key
 WHERE existing_admin.id IS NULL
) admins_to_seed ON admins_to_seed.id = target.id
SET target.is_course_admin = 1, target.updated_at = CURRENT_TIMESTAMP`)
      return statements.join(';\n')
    },
  },

  {
    version: '20260819_074',
    name: 'find_course_profile_schema_repair',
    filename: '20260819_074_find_course_profile_schema_repair.sql',
    async isSatisfied(db) {
      return (
        await columnExists(db, 'scores', 'golf_course_id') &&
        await columnExists(db, 'scores', 'course_rating') &&
        await columnExists(db, 'scores', 'slope_rating') &&
        await columnExists(db, 'scores', 'course_par') &&
        await indexExists(db, 'scores', 'idx_scores_golf_course_id')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'scores', 'golf_course_id'))) {
        statements.push('ALTER TABLE scores ADD COLUMN golf_course_id VARCHAR(191) NULL AFTER course')
      }
      if (!(await columnExists(db, 'scores', 'course_rating'))) {
        statements.push('ALTER TABLE scores ADD COLUMN course_rating DECIMAL(4,1) NULL AFTER golf_course_id')
      }
      if (!(await columnExists(db, 'scores', 'slope_rating'))) {
        statements.push('ALTER TABLE scores ADD COLUMN slope_rating INT NULL AFTER course_rating')
      }
      if (!(await columnExists(db, 'scores', 'course_par'))) {
        statements.push('ALTER TABLE scores ADD COLUMN course_par INT NULL AFTER slope_rating')
      }
      if (!(await indexExists(db, 'scores', 'idx_scores_golf_course_id'))) {
        statements.push('CREATE INDEX idx_scores_golf_course_id ON scores (golf_course_id)')
      }
      return statements.join(';\n')
    },
  },



  {
    version: '20260820_075',
    name: 'notifications_groups_and_tournament_messaging',
    filename: '20260820_075_notifications_groups_and_tournament_messaging.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'inbox_thread_user_state') &&
        await tableExists(db, 'message_groups') &&
        await tableExists(db, 'message_group_members') &&
        await columnExists(db, 'inbox_messages', 'sender_role') &&
        await columnExists(db, 'inbox_messages', 'group_id') &&
        await columnExists(db, 'inbox_messages', 'tournament_id') &&
        await columnExists(db, 'inbox_messages', 'tournament_name') &&
        await columnExists(db, 'inbox_messages', 'event_date') &&
        await columnExists(db, 'inbox_messages', 'action_url') &&
        await columnExists(db, 'inbox_messages', 'correlation_id') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_group_created') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_tournament_created') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_correlation') &&
        await indexExists(db, 'message_group_members', 'idx_message_group_members_email')
      )
    },
    async getSql() {
      return loadMigrationSql('20260820_075_notifications_groups_and_tournament_messaging.sql')
    },
  },


  {
    version: '20260820_076',
    name: 'tournament_message_dialogue',
    filename: '20260820_076_tournament_message_dialogue.sql',
    async isSatisfied(db) {
      return (
        await columnExists(db, 'inbox_messages', 'tournament_conversation_id') &&
        await indexExists(db, 'inbox_messages', 'idx_inbox_messages_tournament_conversation') &&
        await tableExists(db, 'tournament_message_threads') &&
        await tableExists(db, 'tournament_message_thread_members') &&
        await tableExists(db, 'tournament_message_entries') &&
        await tableExists(db, 'tournament_message_portal_state') &&
        await indexExists(db, 'tournament_message_thread_members', 'idx_tournament_message_thread_members_email') &&
        await indexExists(db, 'tournament_message_entries', 'idx_tournament_message_entries_thread_created')
      )
    },
    async getSql() {
      return loadMigrationSql('20260820_076_tournament_message_dialogue.sql')
    },
  },



  {
    version: '20260822_077',
    name: 'individual_challenge_date_range',
    filename: '20260822_077_individual_challenge_date_range.sql',
    async isSatisfied(db) {
      return await columnExists(db, 'inbox_messages', 'challenge_end_date')
    },
    async getSql(db) {
      if (await columnExists(db, 'inbox_messages', 'challenge_end_date')) return '-- Individual Challenge date range schema already exists'
      return 'ALTER TABLE inbox_messages ADD COLUMN challenge_end_date DATE NULL AFTER challenge_date'
    },
  },


  {
    version: '20260824_078',
    name: 'message_group_soft_delete',
    filename: '20260824_078_message_group_soft_delete.sql',
    async isSatisfied(db) {
      return (
        await columnExists(db, 'message_groups', 'deleted_at') &&
        await indexExists(db, 'message_groups', 'idx_message_groups_deleted_at')
      )
    },
    async getSql(db) {
      const statements = []
      if (!(await columnExists(db, 'message_groups', 'deleted_at'))) {
        statements.push('ALTER TABLE message_groups ADD COLUMN deleted_at DATETIME(6) NULL AFTER updated_at')
      }
      if (!(await indexExists(db, 'message_groups', 'idx_message_groups_deleted_at'))) {
        statements.push('CREATE INDEX idx_message_groups_deleted_at ON message_groups (deleted_at)')
      }
      return statements.join(';\n')
    },
  },


  {
    version: '20260825_079',
    name: 'home_marketing_settings',
    filename: '20260825_079_home_marketing_settings.sql',
    async isSatisfied(db) {
      return (
        await tableExists(db, 'marketing_settings') &&
        await columnExists(db, 'marketing_settings', 'setting_key') &&
        await columnExists(db, 'marketing_settings', 'setting_value') &&
        await columnExists(db, 'marketing_settings', 'updated_by_admin_user_id') &&
        await columnExists(db, 'marketing_settings', 'correlation_id') &&
        await columnExists(db, 'marketing_settings', 'created_at') &&
        await columnExists(db, 'marketing_settings', 'updated_at') &&
        await indexExists(db, 'marketing_settings', 'idx_marketing_settings_updated_at') &&
        await indexExists(db, 'marketing_settings', 'idx_marketing_settings_correlation')
      )
    },
    async getSql(db) {
      if (!(await tableExists(db, 'marketing_settings'))) {
        return loadMigrationSql('20260825_079_home_marketing_settings.sql')
      }

      const statements = []
      if (!(await columnExists(db, 'marketing_settings', 'setting_key'))) {
        statements.push('ALTER TABLE marketing_settings ADD COLUMN setting_key VARCHAR(128) NOT NULL PRIMARY KEY FIRST')
      }
      if (!(await columnExists(db, 'marketing_settings', 'setting_value'))) {
        statements.push('ALTER TABLE marketing_settings ADD COLUMN setting_value TEXT NOT NULL AFTER setting_key')
      }
      if (!(await columnExists(db, 'marketing_settings', 'updated_by_admin_user_id'))) {
        statements.push('ALTER TABLE marketing_settings ADD COLUMN updated_by_admin_user_id VARCHAR(191) NULL AFTER setting_value')
      }
      if (!(await columnExists(db, 'marketing_settings', 'correlation_id'))) {
        statements.push('ALTER TABLE marketing_settings ADD COLUMN correlation_id VARCHAR(191) NULL AFTER updated_by_admin_user_id')
      }
      if (!(await columnExists(db, 'marketing_settings', 'created_at'))) {
        statements.push('ALTER TABLE marketing_settings ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP')
      }
      if (!(await columnExists(db, 'marketing_settings', 'updated_at'))) {
        statements.push('ALTER TABLE marketing_settings ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
      if (!(await indexExists(db, 'marketing_settings', 'idx_marketing_settings_updated_at'))) {
        statements.push('CREATE INDEX idx_marketing_settings_updated_at ON marketing_settings (updated_at)')
      }
      if (!(await indexExists(db, 'marketing_settings', 'idx_marketing_settings_correlation'))) {
        statements.push('CREATE INDEX idx_marketing_settings_correlation ON marketing_settings (correlation_id)')
      }
      statements.push(`INSERT INTO marketing_settings (setting_key, setting_value)
        VALUES
          ('home.golf_homiez_video_url', 'https://youtu.be/F9CrUZWAZJA'),
          ('home.golf_homiez_courses_video_url', 'https://youtu.be/F9CrUZWAZJA')
        ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key)`)
      return statements.join(';\n')
    },
  },
  {
    version: '20260825_080',
    name: 'remove_homepage_demo_data',
    filename: '20260825_080_remove_homepage_demo_data.sql',
    async isSatisfied(db) {
      let remaining = 0

      if (await tableExists(db, 'scores') && await columnExists(db, 'scores', 'created_by_email')) {
        const [[row = {}] = []] = await db.execute(
          `SELECT COUNT(*) AS count FROM scores WHERE LOWER(created_by_email) = ?`,
          ['thegolfhomie@example.com'],
        )
        remaining += Number(row.count || 0)
      }

      if (await tableExists(db, 'team_members') && await tableExists(db, 'teams') && await columnExists(db, 'team_members', 'email')) {
        const [[row = {}] = []] = await db.execute(
          `SELECT COUNT(*) AS count
             FROM team_members tm
             INNER JOIN teams t ON t.id = tm.team_id
            WHERE LOWER(tm.email) = ?
              AND t.name = ?`,
          ['thegolfhomie@example.com', 'Homie Hustlers'],
        )
        remaining += Number(row.count || 0)

        const [[orphanTeam = {}] = []] = await db.execute(
          `SELECT COUNT(*) AS count
             FROM teams t
            WHERE t.name = ?
              AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = t.id)`,
          ['Homie Hustlers'],
        )
        remaining += Number(orphanTeam.count || 0)
      }

      if (await tableExists(db, 'user') && await columnExists(db, 'user', 'email')) {
        const [[row = {}] = []] = await db.execute(
          `SELECT COUNT(*) AS count FROM \`user\` WHERE LOWER(email) = ?`,
          ['thegolfhomie@example.com'],
        )
        remaining += Number(row.count || 0)
      }

      return remaining === 0
    },
    async getSql(db) {
      const statements = []
      if (await tableExists(db, 'scores') && await columnExists(db, 'scores', 'created_by_email')) {
        statements.push(`DELETE FROM scores WHERE LOWER(created_by_email) = 'thegolfhomie@example.com'`)
      }
      if (await tableExists(db, 'team_members') && await tableExists(db, 'teams') && await columnExists(db, 'team_members', 'email')) {
        statements.push(`DELETE tm FROM team_members tm INNER JOIN teams t ON t.id = tm.team_id WHERE LOWER(tm.email) = 'thegolfhomie@example.com' AND t.name = 'Homie Hustlers'`)
        statements.push(`DELETE FROM teams WHERE name = 'Homie Hustlers' AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = teams.id)`)
      }
      if (await tableExists(db, 'user') && await columnExists(db, 'user', 'email')) {
        statements.push(`DELETE FROM \`user\` WHERE LOWER(email) = 'thegolfhomie@example.com'`)
      }
      return statements.join(';\n')
    },
  },

]

export function sortMigrations(migrations) {
  return [...migrations].sort((a, b) => a.version.localeCompare(b.version))
}
