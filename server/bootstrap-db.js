import 'dotenv/config'
import { runAuthMigrations } from './auth-migrations.js'
import { initDb } from './db.js'

async function main() {
  await runAuthMigrations()
  await initDb()
  console.log('MySQL database ready')
}

main().catch((error) => {
  console.error('Database bootstrap failed:', error)
  process.exit(1)
})
