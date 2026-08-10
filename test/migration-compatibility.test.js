import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { APP_MIGRATIONS } from '../server/migrations/index.js'

function makeDb(existingColumns = [], invitationsExists = false, primaryKeyColumns = ['id'], existingIndexes = []) {
  const columnSet = new Set(existingColumns)
  return {
    async execute(sql, params = []) {
      if (sql.includes('information_schema.columns')) {
        const [, columnName] = params
        return [columnSet.has(columnName) ? [{}] : []]
      }
      if (sql.includes('information_schema.key_column_usage')) {
        return [primaryKeyColumns.map((column_name) => ({ column_name }))]
      }
      if (sql.includes('information_schema.statistics')) {
        const [tableName, indexName] = params
        if (tableName === 'team_members' && existingIndexes.includes(indexName)) return [[{}]]
        return [[]]
      }
      if (sql.includes('information_schema.tables')) {
        const [tableName] = params
        if (tableName === 'invitations' && invitationsExists) return [[{}]]
        if (tableName === 'team_members') return [[{}]]
        return [[]]
      }
      throw new Error(`Unexpected execute call: ${sql}`)
    },
    async query() {
      throw new Error('Unexpected query call')
    },
  }
}

test('team member invites migration creates the invitations table with MySQL-compatible SQL', async () => {
  const migration = APP_MIGRATIONS.find((entry) => entry.version === '20260403_006')
  const sql = await migration.getSql(makeDb())

  assert.match(sql, /CREATE TABLE IF NOT EXISTS invitations/)
  assert.match(sql, /invited_by_user_id VARCHAR\(191\) NULL/)
  assert.match(sql, /invited_by_email VARCHAR\(191\) NOT NULL/)
  assert.match(sql, /INDEX idx_invitations_email \(email\)/)
  assert.match(sql, /INDEX idx_invitations_team_id \(team_id\)/)
  assert.doesNotMatch(sql, /ADD COLUMN IF NOT EXISTS/)
})

test('team member invites migration is satisfied once the invitations table exists', async () => {
  const migration = APP_MIGRATIONS.find((entry) => entry.version === '20260403_006')

  assert.equal(await migration.isSatisfied(makeDb([], false)), false)
  assert.equal(await migration.isSatisfied(makeDb([], true)), true)
})


test('team member primary key scope migration runs when team_members still uses a global id primary key', async () => {
  const migration = APP_MIGRATIONS.find((entry) => entry.version === '20260409_009')
  assert.equal(await migration.isSatisfied(makeDb([], false, ['id'], [])), false)

  const sql = await migration.getSql()
  assert.match(sql, /ALTER TABLE team_members DROP PRIMARY KEY;/)
  assert.match(sql, /ALTER TABLE team_members ADD PRIMARY KEY \(team_id, id\);/)
  assert.match(sql, /CREATE INDEX idx_team_members_member_id ON team_members\(id\);/)
})

test('team member primary key scope migration is satisfied once the composite key and member index exist', async () => {
  const migration = APP_MIGRATIONS.find((entry) => entry.version === '20260409_009')
  assert.equal(await migration.isSatisfied(makeDb([], false, ['team_id', 'id'], ['idx_team_members_member_id'])), true)
})

test('host account request migration is registered for production deployments', async () => {
  const migrations = await readFile(new URL('../server/migrations/index.js', import.meta.url), 'utf8')
  const sql = await readFile(new URL('../migration_scripts/20260422_017_host_account_requests.sql', import.meta.url), 'utf8')

  assert.match(migrations, /20260422_017/)
  assert.match(migrations, /host_account_requests/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS host_account_requests/)
  assert.match(sql, /idx_host_account_requests_status_created/)
})

test('app feature flags migration is registered with the profile social preferences flag disabled by default', async () => {
  const migrations = await readFile(new URL('../server/migrations/index.js', import.meta.url), 'utf8')
  const sql = await readFile(new URL('../migration_scripts/20260622_056_app_feature_flags.sql', import.meta.url), 'utf8')

  assert.match(migrations, /20260622_056/)
  assert.match(migrations, /app_feature_flags/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS app_feature_flags/)
  assert.match(sql, /profileSocialPreferences/)
  assert.match(sql, /VALUES \(\s*'profileSocialPreferences',\s*0,/)
})

test('tournament team score migration is registered with per-tournament team uniqueness and cascading cleanup', async () => {
  const migrations = await readFile(new URL('../server/migrations/index.js', import.meta.url), 'utf8')
  const sql = await readFile(new URL('../migration_scripts/20260728_063_tournament_team_scores.sql', import.meta.url), 'utf8')

  assert.match(migrations, /20260728_063/)
  assert.match(migrations, /tournament_team_scores/)
  assert.match(migrations, /uniq_tournament_team_scores_team/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tournament_team_scores/)
  assert.match(sql, /holes_json JSON NULL/)
  assert.match(sql, /UNIQUE KEY uniq_tournament_team_scores_team \(tournament_id, team_key\)/)
  assert.match(sql, /correlation_id VARCHAR\(191\) NULL/)
  assert.match(sql, /ON DELETE CASCADE/)
})

test('GolfHomiez tournament search migration uses collation-safe identifier joins', async () => {
  const migration = APP_MIGRATIONS.find((entry) => entry.version === '20260806_067')
  assert.ok(migration)
  const db = {
    async execute() {
      return [[]]
    },
  }

  const sql = await migration.getSql(db)
  assert.match(sql, /BINARY hra\.id = BINARY t\.host_account_id/)
  assert.match(sql, /BINARY ha\.id = BINARY t\.host_account_id/)
  assert.match(sql, /BINARY gcpp\.host_account_id = BINARY t\.host_account_id/)
  assert.match(sql, /BINARY gc\.id = BINARY COALESCE\(ha\.golf_course_id, gcpp\.golf_course_id\)/)
})

test('team start assignment migration inherits tournaments.id charset and collation', async () => {
  const migration = APP_MIGRATIONS.find((entry) => entry.version === '20260806_069')
  assert.ok(migration)
  const db = {
    async execute(sql) {
      if (/table_name = 'tournaments'/i.test(sql) && /column_name = 'id'/i.test(sql)) {
        return [[{
          column_type: 'varchar(191)',
          character_set_name: 'utf8mb4',
          collation_name: 'utf8mb4_bin',
        }]]
      }
      if (/information_schema\.tables/i.test(sql)) return [[]]
      throw new Error(`Unexpected execute call: ${sql}`)
    },
  }

  const sql = await migration.getSql(db)
  assert.match(sql, /tournament_id VARCHAR\(191\) CHARACTER SET `utf8mb4` COLLATE `utf8mb4_bin` NOT NULL/)
  assert.match(sql, /FOREIGN KEY \(tournament_id\) REFERENCES tournaments\(id\)/)
})

test('cross-table collation repair migration and migration failure diagnostics are registered', async () => {
  const repairMigration = APP_MIGRATIONS.find((entry) => entry.version === '20260810_071')
  assert.ok(repairMigration)
  assert.equal(repairMigration.name, 'cross_table_identifier_collation_repair')

  const migrationSql = await readFile(new URL('../migration_scripts/20260810_071_cross_table_identifier_collation_repair.sql', import.meta.url), 'utf8')
  const runnerSource = await readFile(new URL('../server/migrations/runner.js', import.meta.url), 'utf8')
  assert.match(migrationSql, /golf_course_tournaments MODIFY COLUMN golfhomiez_tournament_id/i)
  assert.match(migrationSql, /tournament_team_start_assignments MODIFY COLUMN tournament_id/i)
  assert.match(migrationSql, /BINARY gc\.id = BINARY COALESCE/i)
  assert.match(migrationSql, /migration-20260810-071/)
  assert.match(runnerSource, /\$\{migration\.version\} starting/)
  assert.match(runnerSource, /migrationFilename: migration\.filename/)
  assert.match(runnerSource, /logger\.error\?\./)
})
