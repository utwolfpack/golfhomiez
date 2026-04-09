import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPool } from '../db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pkgPath = path.resolve(__dirname, '../../package.json')
const rollbackSqlPath = path.resolve(__dirname, '../../migration_scripts/20260402_005_rollback_chat_schema_to_baseline.sql')

async function run() {
  if (!fs.existsSync(rollbackSqlPath)) return
  const db = getPool()
  const sql = fs.readFileSync(rollbackSqlPath, 'utf8')
  if (sql.trim()) {
    await db.query(sql)
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const selfInvocationPrefix = 'node server/scripts/run-one-time-chat-schema-rollback.js && '
  const currentPostinstall = String(pkg?.scripts?.postinstall || '')
  const cleanedPostinstall = currentPostinstall.replace(selfInvocationPrefix, '')
  pkg.scripts.postinstall = cleanedPostinstall
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
