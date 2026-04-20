import 'dotenv/config'
import { initDb, getPool } from './db.js'
import { runAuthMigrations } from './auth-migrations.js'
import { runAppMigrations } from './migrations/runner.js'

async function main() {
  await initDb()
  await runAuthMigrations()
  await runAppMigrations(getPool())
  console.log('MySQL database ready')
}

main().catch((error) => {
  console.error('Database bootstrap failed:', error)
  process.exit(1)
})
