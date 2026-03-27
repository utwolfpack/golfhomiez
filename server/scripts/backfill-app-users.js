import 'dotenv/config'
import { initDb, closeDb } from '../db.js'
import { backfillAppUsers } from '../lib/app-user-sync.js'

async function main() {
  await initDb()
  const result = await backfillAppUsers()
  console.log(`App user backfill complete. source=${result.sourceTable || 'none'} synced=${result.synced} inserted=${result.inserted} updated=${result.updated} repairedScores=${result.repairedScores || 0}`)
}

main().catch((error) => {
  console.error('App user backfill failed:', error)
  process.exitCode = 1
}).finally(async () => {
  await closeDb()
})
