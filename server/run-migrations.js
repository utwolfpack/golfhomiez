let dotenvLoaded = false
try {
  await import('dotenv/config')
  dotenvLoaded = true
} catch {}

import { runAuthMigrations } from './auth-migrations.js'
import { getPool, closeDb } from './db.js'
import { runAppMigrations } from './migrations/runner.js'
import { createSchemaBackup } from './scripts/mysql-schema-backup.js'

function shouldRequireDatabase() {
  return String(process.env.REQUIRE_DB_MIGRATIONS || '').toLowerCase() === 'true'
}

async function main() {
  const db = getPool()

  try {
    await db.query('SELECT 1')
  } catch (error) {
    if (shouldRequireDatabase()) throw error
    console.warn('[db:migrate] database unavailable; skipping migrations during build/startup')
    return
  }

  if (!dotenvLoaded) {
    console.warn('[db:migrate] dotenv package unavailable; using existing process environment only')
  }

  await runAuthMigrations()
  await runAppMigrations(db, console, { createBackup: createSchemaBackup })
}

main()
  .catch((error) => {
    console.error('[db:migrate] migration run failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb()
  })
