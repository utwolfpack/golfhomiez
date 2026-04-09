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
  }
]

export function sortMigrations(migrations) {
  return [...migrations].sort((a, b) => a.version.localeCompare(b.version))
}
