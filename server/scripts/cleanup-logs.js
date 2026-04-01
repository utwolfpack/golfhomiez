
import fs from 'fs'
import path from 'path'
import process from 'process'

const LOG_DIR = path.resolve(process.cwd(), 'logging')
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const now = Date.now()

if (!fs.existsSync(LOG_DIR)) process.exit(0)

for (const entry of fs.readdirSync(LOG_DIR, { withFileTypes: true })) {
  if (!entry.isFile()) continue
  if (!entry.name.endsWith('.log')) continue
  const filePath = path.join(LOG_DIR, entry.name)
  const stats = fs.statSync(filePath)
  if (now - stats.mtimeMs <= MAX_AGE_MS) continue
  fs.rmSync(filePath, { force: true })
  console.log(`[log-cleanup] removed ${entry.name}`)
}
