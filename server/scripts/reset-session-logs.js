import fs from 'fs'
import path from 'path'
import process from 'process'

const LOG_DIR = path.resolve(process.cwd(), 'logging')
const SESSION_LOGS = ['access.log', 'api.log', 'error.log', 'frontend.log', 'smtp.log']
const RESET_FLAG = String(process.env.RESET_APP_LOGS_ON_START || 'true').trim().toLowerCase()
const shouldReset = !['0', 'false', 'no', 'off'].includes(RESET_FLAG)

if (!shouldReset) {
  console.log('[log-session-reset] skipped')
  process.exit(0)
}

fs.mkdirSync(LOG_DIR, { recursive: true })

for (const fileName of SESSION_LOGS) {
  const filePath = path.join(LOG_DIR, fileName)
  fs.writeFileSync(filePath, '')
  console.log(`[log-session-reset] cleared ${fileName}`)
}
