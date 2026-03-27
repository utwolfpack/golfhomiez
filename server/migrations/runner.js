import crypto from 'node:crypto'
import { APP_MIGRATIONS, MIGRATIONS_TABLE, sortMigrations } from './index.js'

export function checksumSql(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex')
}

export function shouldSkipAheadDatabase(appliedVersions, availableVersions) {
  if (!appliedVersions.length || !availableVersions.length) return false
  const latestApplied = [...appliedVersions].sort().at(-1)
  const latestAvailable = [...availableVersions].sort().at(-1)
  return latestApplied.localeCompare(latestAvailable) > 0
}

export async function ensureMigrationsTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version VARCHAR(32) NOT NULL PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      execution_mode ENUM('executed','detected_existing_schema') NOT NULL DEFAULT 'executed'
    )
  `)
}

export async function getAppliedMigrations(db) {
  const [rows] = await db.query(`SELECT version, checksum FROM ${MIGRATIONS_TABLE} ORDER BY version ASC`)
  return rows
}

export async function recordAppliedMigration(db, migration, checksum, executionMode) {
  await db.execute(
    `INSERT INTO ${MIGRATIONS_TABLE} (version, name, filename, checksum, execution_mode)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       filename = VALUES(filename),
       checksum = VALUES(checksum),
       execution_mode = VALUES(execution_mode)`,
    [migration.version, migration.name, migration.filename, checksum, executionMode]
  )
}

export async function applyMigration(db, migration) {
  const sql = await migration.getSql()
  const checksum = checksumSql(sql)

  if (await migration.isSatisfied(db)) {
    await recordAppliedMigration(db, migration, checksum, 'detected_existing_schema')
    return { version: migration.version, status: 'already_satisfied' }
  }

  await db.query(sql)
  await recordAppliedMigration(db, migration, checksum, 'executed')
  return { version: migration.version, status: 'executed' }
}

export async function runAppMigrations(db, logger = console) {
  await ensureMigrationsTable(db)

  const migrations = sortMigrations(APP_MIGRATIONS)
  const availableVersions = migrations.map((migration) => migration.version)
  const appliedRows = await getAppliedMigrations(db)
  const appliedVersions = appliedRows.map((row) => row.version)
  const appliedVersionSet = new Set(appliedVersions)

  if (shouldSkipAheadDatabase(appliedVersions, availableVersions)) {
    logger.warn?.('[db:migrate] database schema is ahead of this app build; skipping app migrations')
    return { status: 'skipped_ahead', applied: [] }
  }

  const results = []
  for (const migration of migrations) {
    if (appliedVersionSet.has(migration.version)) continue
    const result = await applyMigration(db, migration)
    results.push(result)
    logger.info?.(`[db:migrate] ${migration.version} ${result.status}`)
  }

  if (results.length === 0) {
    logger.info?.('[db:migrate] app schema already up to date')
  }

  return { status: 'ok', applied: results }
}
