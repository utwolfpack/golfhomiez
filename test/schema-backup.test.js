import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { MAX_SCHEMA_BACKUPS, MYSQL_DUMPS_DIR, buildTimestamp, getSchemaBackupFileName } from '../server/scripts/mysql-schema-backup.js'

test('schema backups live in mysql_dumps at the project root and use timestamped names', () => {
  const backupScript = fs.readFileSync(new URL('../server/scripts/mysql-schema-backup.js', import.meta.url), 'utf8')
  const gitignore = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8')
  const timestamp = buildTimestamp(new Date('2026-04-03T12:34:56Z'))
  const filename = getSchemaBackupFileName({ databaseName: 'golf_homiez', date: new Date('2026-04-03T12:34:56Z') })

  assert.equal(timestamp, '20260403_123456')
  assert.equal(filename, 'golf_homiez_schema_20260403_123456.sql')
  assert.equal(MYSQL_DUMPS_DIR.endsWith('/mysql_dumps'), true)
  assert.equal(MAX_SCHEMA_BACKUPS, 5)
  assert.match(backupScript, /path\.join\(projectRoot, 'mysql_dumps'\)/)
  assert.match(backupScript, /const gitkeepPath = path\.join\(MYSQL_DUMPS_DIR, '\.gitkeep'\)/)
  assert.match(backupScript, /createSchemaBackup\(\{ reason: 'manual', force: true \}\)/)
  assert.match(gitignore, /mysql_dumps\/\*\.sql/)
  assert.match(gitignore, /!mysql_dumps\/\.gitkeep/)
})

test('schema backup script exports startup backup helpers and retention management', () => {
  const backupScript = fs.readFileSync(new URL('../server/scripts/mysql-schema-backup.js', import.meta.url), 'utf8')

  assert.match(backupScript, /export async function ensureInitialSchemaBackup\(\)/)
  assert.match(backupScript, /return createSchemaBackup\(\{ reason: 'startup', force: false \}\)/)
  assert.match(backupScript, /pruneOldSchemaBackups\(MAX_SCHEMA_BACKUPS\)/)
})

