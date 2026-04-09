import test from 'node:test'
import assert from 'node:assert/strict'

import { APP_MIGRATIONS } from '../server/migrations/index.js'

function makeDb(existingColumns = [], invitationsExists = false, primaryKeyColumns = ['id'], existingIndexes = []) {
  const columnSet = new Set(existingColumns)
  return {
    async execute(sql, params) {
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

test('team member invites migration builds MySQL-compatible ALTER statements without IF NOT EXISTS', async () => {
  const migration = APP_MIGRATIONS.find((entry) => entry.version === '20260403_006')
  const sql = await migration.getSql(makeDb())

  assert.match(sql, /ALTER TABLE team_members ADD COLUMN user_id/)
  assert.match(sql, /CREATE TABLE invitations/)
  assert.doesNotMatch(sql, /ADD COLUMN IF NOT EXISTS/)
})

test('team member invites migration only includes missing schema changes', async () => {
  const migration = APP_MIGRATIONS.find((entry) => entry.version === '20260403_006')
  const sql = await migration.getSql(
    makeDb(['user_id', 'invite_status', 'is_verified', 'invited_by_email', 'last_invited_at'], true)
  )

  assert.equal(sql, '')
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
