import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('one-time schema rollback is wired into postinstall and removes itself afterward', () => {
  const pkg = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  const script = fs.readFileSync(new URL('../server/scripts/run-one-time-chat-schema-rollback.js', import.meta.url), 'utf8')

  assert.match(pkg, /"postinstall": "npm run db:migrate && npm run build"/)
  assert.match(script, /currentPostinstall\.replace\(selfInvocationPrefix, ''\)/)
  assert.match(script, /pkg\.scripts\.postinstall = cleanedPostinstall/)
})

test('rollback migration removes chat-added schema tables and migration records', () => {
  const migrations = fs.readFileSync(new URL('../server/migrations/index.js', import.meta.url), 'utf8')
  const rollbackSql = fs.readFileSync(new URL('../migration_scripts/20260402_005_rollback_chat_schema_to_baseline.sql', import.meta.url), 'utf8')

  assert.doesNotMatch(migrations, /create_verification_links_table/)
  assert.doesNotMatch(migrations, /create_invitations_table/)
  assert.match(rollbackSql, /DROP TABLE IF EXISTS verification_links;/)
  assert.match(rollbackSql, /DROP TABLE IF EXISTS invitations;/)
  assert.match(rollbackSql, /DELETE FROM app_schema_migrations/)
})
