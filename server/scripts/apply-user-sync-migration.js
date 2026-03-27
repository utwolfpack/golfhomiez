import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getPool, closeDb } from '../db.js'
import { ensureAppUserSchemaAndBackfill } from '../lib/app-user-sync.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const migrationPath = path.join(__dirname, '..', '..', 'migration_scripts', '20260327_001_app_users_auth_sync.sql')

async function main() {
  const db = getPool()
  const sql = fs.readFileSync(migrationPath, 'utf8')
  await db.query(sql)
  const result = await ensureAppUserSchemaAndBackfill()
  console.log(`Applied app-user sync migration from ${migrationPath}`)
  console.log(`Backfill source=${result.sourceTable || 'none'} synced=${result.synced} inserted=${result.inserted} updated=${result.updated} repairedScores=${result.repairedScores || 0}`)
}

main().catch((error) => {
  console.error('User sync migration failed:', error)
  process.exitCode = 1
}).finally(async () => {
  await closeDb()
})
