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
]

export function sortMigrations(migrations) {
  return [...migrations].sort((a, b) => a.version.localeCompare(b.version))
}
