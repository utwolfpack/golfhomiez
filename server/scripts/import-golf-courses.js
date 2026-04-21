import 'dotenv/config'
import { initDb, closeDb } from '../db.js'
import { importGolfCoursesFromCsv } from '../lib/golf-course-service.js'

async function main() {
  await initDb()
  const result = await importGolfCoursesFromCsv()
  console.log(`Imported ${result.imported} golf courses from ${result.filePath}`)
}

main()
  .catch((error) => {
    console.error('Golf courses import failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb().catch(() => {})
  })
