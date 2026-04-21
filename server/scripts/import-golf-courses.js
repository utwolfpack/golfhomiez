import 'dotenv/config'
import { closeDb } from '../db.js'
import { importGolfCoursesFromCsv } from '../lib/golf-course-service.js'
import { logError, logInfo } from '../lib/logger.js'

async function main() {
  try {
    const result = await importGolfCoursesFromCsv()
    logInfo('Golf courses import completed', result)
    console.log(`Imported ${result.imported} golf courses.`)
  } catch (error) {
    logError('Golf courses import failed', { error })
    console.error('Golf courses import failed:', error)
    process.exitCode = 1
  } finally {
    await closeDb()
  }
}

main()
