import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '../..')
export const MYSQL_DUMPS_DIR = path.join(projectRoot, 'mysql_dumps')
export const MAX_SCHEMA_BACKUPS = 5

function pad(value) {
  return String(value).padStart(2, '0')
}

export function buildTimestamp(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

export function getSchemaBackupFileName({ databaseName, date = new Date() }) {
  const safeDbName = String(databaseName || process.env.DB_NAME || 'database')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_') || 'database'
  return `${safeDbName}_schema_${buildTimestamp(date)}.sql`
}

export function ensureMysqlDumpsDir() {
  fs.mkdirSync(MYSQL_DUMPS_DIR, { recursive: true })
  const gitkeepPath = path.join(MYSQL_DUMPS_DIR, '.gitkeep')
  if (!fs.existsSync(gitkeepPath)) {
    fs.writeFileSync(gitkeepPath, '')
  }
  return MYSQL_DUMPS_DIR
}

export function listSchemaBackups() {
  ensureMysqlDumpsDir()
  return fs.readdirSync(MYSQL_DUMPS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => {
      const fullPath = path.join(MYSQL_DUMPS_DIR, name)
      const stats = fs.statSync(fullPath)
      return { name, fullPath, mtimeMs: stats.mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export function pruneOldSchemaBackups(maxBackups = MAX_SCHEMA_BACKUPS) {
  const backups = listSchemaBackups()
  const toDelete = backups.slice(maxBackups)
  for (const backup of toDelete) {
    fs.rmSync(backup.fullPath, { force: true })
  }
  return {
    kept: backups.slice(0, maxBackups).map((entry) => entry.fullPath),
    removed: toDelete.map((entry) => entry.fullPath),
  }
}

function buildMysqlDumpArgs(databaseName) {
  const port = Number(process.env.DB_PORT || '3306')
  return [
    '--no-data',
    '--routines',
    '--triggers',
    '--single-transaction',
    '--skip-comments',
    '--host', process.env.DB_HOST || '127.0.0.1',
    '--port', String(port),
    '--user', process.env.DB_USER || 'root',
    databaseName,
  ]
}

function runMysqlDump(outputPath, databaseName) {
  return new Promise((resolve, reject) => {
    const args = buildMysqlDumpArgs(databaseName)
    const env = { ...process.env }
    if (process.env.DB_PASSWORD) env.MYSQL_PWD = process.env.DB_PASSWORD

    const child = spawn('mysqldump', args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    const writeStream = fs.createWriteStream(outputPath, { flags: 'w' })
    let stderr = ''

    child.stdout.pipe(writeStream)
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', (error) => {
      writeStream.destroy()
      reject(error)
    })

    child.on('close', (code) => {
      writeStream.end()
      if (code === 0) {
        resolve({ outputPath, stderr: stderr.trim() || null })
        return
      }
      reject(new Error(stderr.trim() || `mysqldump exited with code ${code}`))
    })
  })
}

export async function createSchemaBackup({ reason = 'manual', force = false, date = new Date() } = {}) {
  const databaseName = process.env.DB_NAME || 'golf_homiez'
  ensureMysqlDumpsDir()

  if (!force) {
    const backups = listSchemaBackups()
    if (reason === 'startup' && backups.length > 0) {
      return { created: false, reason, skipped: 'existing_backup_present', backups: backups.map((entry) => entry.fullPath) }
    }
  }

  const fileName = getSchemaBackupFileName({ databaseName, date })
  const outputPath = path.join(MYSQL_DUMPS_DIR, fileName)
  const result = await runMysqlDump(outputPath, databaseName)
  const retention = pruneOldSchemaBackups(MAX_SCHEMA_BACKUPS)

  return {
    created: true,
    reason,
    outputPath: result.outputPath,
    warning: result.stderr,
    kept: retention.kept,
    removed: retention.removed,
  }
}

export async function ensureInitialSchemaBackup() {
  return createSchemaBackup({ reason: 'startup', force: false })
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  createSchemaBackup({ reason: 'manual', force: true })
    .then((result) => {
      const target = result.outputPath || 'no backup created'
      console.log(`[db:backup:schema] ${result.created ? 'created' : 'skipped'} ${target}`)
      if (result.removed?.length) {
        console.log(`[db:backup:schema] pruned ${result.removed.length} old backup(s)`)
      }
    })
    .catch((error) => {
      console.error('[db:backup:schema] backup failed:', error)
      process.exitCode = 1
    })
}
